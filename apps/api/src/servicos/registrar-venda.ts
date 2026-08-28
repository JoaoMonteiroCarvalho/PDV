/**
 * Registro de venda vinda do caixa.
 *
 * DECISÃO CENTRAL — a venda já aconteceu.
 *
 * O caixa é offline-first: a venda fecha, imprime o comprovante e entrega a
 * sacola SEM falar com este servidor. Quando o payload chega aqui, o dinheiro
 * já entrou na gaveta e a cliente já saiu da loja. Portanto o servidor NÃO
 * pode rejeitar a venda porque o preço do catálogo mudou desde então — isso
 * criaria uma venda que existe no mundo real e não existe no sistema, que é o
 * pior estado possível para um PDV.
 *
 * O que o servidor faz:
 *   - REJEITA incoerência interna (totais que não fecham, pagamento que não
 *     bate). Isso é bug de cliente, não fato do mundo, e precisa estourar.
 *   - ACEITA e REGISTRA EM AUDITORIA divergência entre o preço praticado e o
 *     preço atual do catálogo. Vira relatório para o gerente, não erro 400.
 *
 * IDEMPOTÊNCIA: o `id` é um UUID gerado no caixa antes de qualquer rede. A
 * fila de sincronização pode reenviar a mesma venda quantas vezes quiser — só
 * a primeira cria registro.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { centavos, pontosBase, somar, type Centavos } from '@pdv/shared';
import {
  ErroVenda,
  calcularParcelas,
  calcularVenda,
  movimentosDaVenda,
  validarAlcadaDesconto,
  validarPagamentos,
  type ItemEntrada,
  type PagamentoEntrada,
} from '@pdv/shared';
import type { EntradaRegistrarVenda } from '../esquemas/venda.js';

export interface ResultadoRegistroVenda {
  readonly vendaId: string;
  readonly numero: number;
  readonly totalCentavos: number;
  /** true quando a venda já estava registrada — retry da fila offline. */
  readonly jaEstavaRegistrada: boolean;
}

export async function registrarVenda(
  prisma: PrismaClient,
  entrada: EntradaRegistrarVenda,
  contexto: { operadorId: string },
): Promise<ResultadoRegistroVenda> {
  // --- Caminho de idempotência: barato e antes de qualquer trabalho ---------
  const jaRegistrada = await prisma.venda.findUnique({
    where: { id: entrada.id },
    select: { id: true, numero: true, totalCentavos: true },
  });
  if (jaRegistrada) {
    return {
      vendaId: jaRegistrada.id,
      numero: jaRegistrada.numero,
      totalCentavos: jaRegistrada.totalCentavos,
      jaEstavaRegistrada: true,
    };
  }

  // --- Contexto: sessão, operador, autorizador, cliente ---------------------
  const sessao = await prisma.sessaoCaixa.findUnique({
    where: { id: entrada.sessaoCaixaId },
    select: { id: true, status: true, terminalId: true },
  });
  if (!sessao) {
    throw new ErroVenda('SESSAO_INEXISTENTE', 'Sessão de caixa não encontrada.');
  }
  if (sessao.status !== 'ABERTA') {
    throw new ErroVenda(
      'SESSAO_FECHADA',
      'A sessão de caixa já foi fechada. Abra o caixa antes de sincronizar vendas novas.',
    );
  }

  const operador = await prisma.usuario.findUnique({
    where: { id: contexto.operadorId },
    select: { id: true, limiteDescontoBps: true, ativo: true },
  });
  if (!operador || !operador.ativo) {
    throw new ErroVenda('OPERADOR_INVALIDO', 'Operador não encontrado ou inativo.');
  }

  const autorizadorId = entrada.autorizadoPorId;
  let autorizadorEhGerente = false;
  if (autorizadorId) {
    const autorizador = await prisma.usuario.findUnique({
      where: { id: autorizadorId },
      select: { papel: true, ativo: true },
    });
    autorizadorEhGerente =
      !!autorizador && autorizador.ativo && (autorizador.papel === 'GERENTE' || autorizador.papel === 'ADMIN');
  }

  // --- Cálculo do domínio (puro, já testado isoladamente) ------------------
  const itens: ItemEntrada[] = entrada.itens.map((item) => ({
    varianteId: item.varianteId,
    quantidade: item.quantidade,
    precoUnitarioCentavos: centavos(item.precoUnitarioCentavos),
    descontoCentavos: centavos(item.descontoCentavos),
  }));

  const venda = calcularVenda(itens, centavos(entrada.descontoSobreTotalCentavos));

  const alcada = validarAlcadaDesconto(venda, {
    limiteOperadorBps: pontosBase(operador.limiteDescontoBps),
    autorizadoPorId: autorizadorId,
    autorizadorEhGerente,
  });

  const pagamentos: PagamentoEntrada[] = entrada.pagamentos.map((pagamento) => ({
    forma: pagamento.forma,
    valorCentavos: centavos(pagamento.valorCentavos),
    trocoCentavos: centavos(pagamento.trocoCentavos),
  }));

  const limiteDisponivel = entrada.clienteId
    ? await calcularLimiteCrediarioDisponivel(prisma, entrada.clienteId)
    : undefined;

  validarPagamentos(venda, pagamentos, {
    clienteId: entrada.clienteId,
    limiteCrediarioDisponivelCentavos: limiteDisponivel,
  });

  // --- Snapshot do catálogo + detecção de divergência de preço -------------
  const variantes = await prisma.variante.findMany({
    where: { id: { in: [...new Set(entrada.itens.map((item) => item.varianteId))] } },
    select: {
      id: true,
      sku: true,
      tamanho: true,
      cor: true,
      precoCentavos: true,
      custoCentavos: true,
      produto: { select: { nome: true } },
    },
  });
  const porId = new Map(variantes.map((variante) => [variante.id, variante]));

  const faltantes = entrada.itens.filter((item) => !porId.has(item.varianteId));
  if (faltantes.length > 0) {
    throw new ErroVenda(
      'VARIANTE_INEXISTENTE',
      `Produto não encontrado no catálogo: ${faltantes.map((item) => item.varianteId).join(', ')}.`,
    );
  }

  const divergencias = venda.itens
    .map((item) => {
      const variante = porId.get(item.varianteId)!;
      return variante.precoCentavos === item.precoUnitarioCentavos
        ? null
        : {
            varianteId: item.varianteId,
            sku: variante.sku,
            precoPraticadoCentavos: item.precoUnitarioCentavos,
            precoAtualDoCatalogoCentavos: variante.precoCentavos,
          };
    })
    .filter((divergencia) => divergencia !== null);

  // --- Persistência: tudo ou nada -----------------------------------------
  const movimentos = movimentosDaVenda(venda);
  const dinheiroLiquido = calcularDinheiroLiquido(pagamentos);

  try {
    const criada = await prisma.$transaction(async (tx) => {
      const registro = await tx.venda.create({
        data: {
          id: entrada.id,
          sessaoCaixaId: entrada.sessaoCaixaId,
          operadorId: operador.id,
          clienteId: entrada.clienteId ?? null,
          subtotalCentavos: venda.subtotalCentavos,
          descontoCentavos: venda.descontoCentavos,
          totalCentavos: venda.totalCentavos,
          criadaEmCliente: entrada.criadaEmCliente,
          itens: {
            create: venda.itens.map((item, indice) => {
              const variante = porId.get(item.varianteId)!;
              return {
                varianteId: item.varianteId,
                sequencia: indice + 1,
                // Cópia congelada: a venda de hoje não muda se o catálogo mudar amanhã.
                descricao: variante.produto.nome,
                sku: variante.sku,
                tamanho: variante.tamanho,
                cor: variante.cor,
                quantidade: item.quantidade,
                precoUnitarioCentavos: item.precoUnitarioCentavos,
                descontoCentavos: item.descontoTotalCentavos,
                totalCentavos: item.totalCentavos,
                autorizadoPorId: entrada.itens[indice]?.autorizadoPorId ?? null,
              };
            }),
          },
          pagamentos: {
            create: entrada.pagamentos.map((pagamento) => ({
              forma: pagamento.forma,
              valorCentavos: pagamento.valorCentavos,
              trocoCentavos: pagamento.trocoCentavos,
              bandeira: pagamento.bandeira ?? null,
              autorizacao: pagamento.autorizacao ?? null,
              parcelasCartao: pagamento.parcelasCartao ?? null,
            })),
          },
          movimentos: {
            create: movimentos.map((movimento) => {
              const variante = porId.get(movimento.varianteId)!;
              return {
                varianteId: movimento.varianteId,
                tipo: movimento.tipo,
                quantidade: movimento.quantidade,
                custoUnitarioCentavos: variante.custoCentavos,
                documentoTipo: 'VENDA',
                documentoId: entrada.id,
                usuarioId: operador.id,
              };
            }),
          },
        },
        select: { id: true, numero: true, totalCentavos: true },
      });

      // Dinheiro que efetivamente ficou na gaveta (já descontado o troco).
      if (dinheiroLiquido > 0) {
        await tx.movimentoCaixa.create({
          data: {
            sessaoCaixaId: entrada.sessaoCaixaId,
            tipo: 'VENDA_DINHEIRO',
            valorCentavos: dinheiroLiquido,
            usuarioId: operador.id,
            documentoTipo: 'VENDA',
            documentoId: entrada.id,
          },
        });
      }

      // Crediário: título + parcelas com soma exata do valor financiado.
      const valorCrediario = somar(
        ...pagamentos
          .filter((pagamento) => pagamento.forma === 'CREDIARIO')
          .map((pagamento) => pagamento.valorCentavos),
      );
      if (valorCrediario > 0) {
        const plano = entrada.crediario!;
        const parcelas = calcularParcelas(
          valorCrediario,
          plano.quantidadeParcelas,
          plano.primeiroVencimento,
        );
        await tx.tituloCrediario.create({
          data: {
            vendaId: entrada.id,
            clienteId: entrada.clienteId!,
            valorTotalCentavos: valorCrediario,
            parcelas: {
              create: parcelas.map((parcela) => ({
                numero: parcela.numero,
                valorCentavos: parcela.valorCentavos,
                vencimento: parcela.vencimento,
              })),
            },
          },
        });
      }

      // Auditoria: desconto acima da alçada é evento de dinheiro.
      if (alcada.exigiuAutorizacao) {
        await tx.registroAuditoria.create({
          data: {
            acao: 'DESCONTO_ACIMA_DA_ALCADA',
            entidade: 'Venda',
            entidadeId: entrada.id,
            usuarioId: operador.id,
            autorizadoPorId: autorizadorId ?? null,
            terminalId: sessao.terminalId,
            valorAntes: { subtotalCentavos: venda.subtotalCentavos },
            valorDepois: {
              totalCentavos: venda.totalCentavos,
              descontoCentavos: venda.descontoCentavos,
              descontoBps: alcada.descontoBps,
              limiteOperadorBps: operador.limiteDescontoBps,
            },
          },
        });
      }

      // Auditoria: preço praticado difere do catálogo atual. Não é erro — a
      // venda offline pode ser anterior à mudança de preço. Vira relatório.
      if (divergencias.length > 0) {
        await tx.registroAuditoria.create({
          data: {
            acao: 'DIVERGENCIA_DE_PRECO',
            entidade: 'Venda',
            entidadeId: entrada.id,
            usuarioId: operador.id,
            terminalId: sessao.terminalId,
            valorAntes: { itens: divergencias },
            valorDepois: { criadaEmCliente: entrada.criadaEmCliente.toISOString() },
          },
        });
      }

      return registro;
    });

    return {
      vendaId: criada.id,
      numero: criada.numero,
      totalCentavos: criada.totalCentavos,
      jaEstavaRegistrada: false,
    };
  } catch (erro) {
    // Corrida entre dois retries simultâneos da mesma venda: o segundo bate na
    // chave primária. Isso é sucesso do ponto de vista da fila, não falha.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      const existente = await prisma.venda.findUnique({
        where: { id: entrada.id },
        select: { id: true, numero: true, totalCentavos: true },
      });
      if (existente) {
        return {
          vendaId: existente.id,
          numero: existente.numero,
          totalCentavos: existente.totalCentavos,
          jaEstavaRegistrada: true,
        };
      }
    }
    throw erro;
  }
}

/** Dinheiro que sobra na gaveta: recebido em espécie menos o troco devolvido. */
function calcularDinheiroLiquido(pagamentos: readonly PagamentoEntrada[]): number {
  return pagamentos
    .filter((pagamento) => pagamento.forma === 'DINHEIRO')
    .reduce((total, pagamento) => total + pagamento.valorCentavos - pagamento.trocoCentavos, 0);
}

/** Limite do cliente menos o que ele já tem em parcelas abertas. */
async function calcularLimiteCrediarioDisponivel(
  prisma: PrismaClient,
  clienteId: string,
): Promise<Centavos> {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { limiteCrediarioCentavos: true, ativo: true },
  });
  if (!cliente) {
    throw new ErroVenda('CLIENTE_INEXISTENTE', 'Cliente não encontrado.');
  }
  if (!cliente.ativo) {
    throw new ErroVenda('CLIENTE_INATIVO', 'Cliente está inativo e não pode comprar no crediário.');
  }

  const emAberto = await prisma.parcelaCrediario.aggregate({
    where: { status: 'ABERTA', titulo: { clienteId, status: 'ABERTO' } },
    _sum: { valorCentavos: true },
  });

  const usado = emAberto._sum.valorCentavos ?? 0;
  return centavos(Math.max(0, cliente.limiteCrediarioCentavos - usado));
}
