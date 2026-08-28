/**
 * Serviço de devolução/cancelamento de venda, por item e quantidade parcial.
 *
 * Segue o mesmo desenho de `registrar-venda.ts` e `sessao-caixa.ts`: todo o
 * cálculo de negócio vem de `@pdv/shared` (`devolucao.ts`); este arquivo só
 * traduz para consultas Prisma e a transação de persistência.
 *
 * A Venda original NUNCA é alterada — nem uma coluna. Cancelamento é um
 * documento novo, imposto pelo banco (trigger de imutabilidade na migration
 * de devolução, igual às demais tabelas financeiras).
 */

import type { PrismaClient } from '@prisma/client';
import {
  ErroDevolucao,
  calcularDevolucao,
  centavos,
  movimentoDeCaixaDaDevolucao,
  movimentosDeEstoqueDaDevolucao,
  validarAutorizacaoDevolucao,
  type FormaEstorno,
  type ItemDisponivelParaDevolucao,
  type ItemParaDevolver,
} from '@pdv/shared';

async function autorizadorEhGerente(
  prisma: PrismaClient,
  autorizadoPorId: string | undefined,
): Promise<boolean> {
  if (!autorizadoPorId) return false;
  const usuario = await prisma.usuario.findUnique({
    where: { id: autorizadoPorId },
    select: { papel: true, ativo: true },
  });
  return !!usuario && usuario.ativo && (usuario.papel === 'GERENTE' || usuario.papel === 'ADMIN');
}

export interface RegistrarDevolucaoEntrada {
  readonly vendaId: string;
  readonly motivo: string;
  readonly formaEstorno: FormaEstorno;
  readonly itens: readonly ItemParaDevolver[];
  readonly autorizadoPorId?: string | undefined;
}

export interface ResultadoDevolucao {
  readonly cancelamentoId: string;
  readonly totalCentavos: number;
}

export async function registrarDevolucao(
  prisma: PrismaClient,
  entrada: RegistrarDevolucaoEntrada,
  contexto: { operadorId: string },
): Promise<ResultadoDevolucao> {
  const ehGerente = await autorizadorEhGerente(prisma, entrada.autorizadoPorId);
  validarAutorizacaoDevolucao({
    autorizadoPorId: entrada.autorizadoPorId,
    autorizadorEhGerente: ehGerente,
  });

  const venda = await prisma.venda.findUnique({
    where: { id: entrada.vendaId },
    select: {
      id: true,
      sessaoCaixaId: true,
      itens: {
        select: {
          id: true,
          varianteId: true,
          quantidade: true,
          precoUnitarioCentavos: true,
          descontoCentavos: true,
          totalCentavos: true,
        },
      },
    },
  });
  if (!venda) {
    throw new ErroDevolucao('VENDA_INEXISTENTE', 'Venda não encontrada.');
  }

  const sessao = await prisma.sessaoCaixa.findUnique({
    where: { id: venda.sessaoCaixaId },
    select: { id: true, status: true },
  });
  if (!sessao) {
    throw new ErroDevolucao('SESSAO_INEXISTENTE', 'Sessão de caixa da venda original não encontrada.');
  }

  // A devolução lança o estorno em dinheiro/PIX NESTA sessão de caixa. Se ela
  // já fechou, não há gaveta aberta para lançar a saída — precisa ser feito
  // com o caixa do dia aberto, apontando para a sessão atual seria incorreto
  // (misturaria o caixa de outro dia com uma venda antiga).
  if (sessao.status !== 'ABERTA') {
    throw new ErroDevolucao(
      'SESSAO_FECHADA',
      'A sessão de caixa da venda original já foi fechada. Abra o caixa antes de registrar a devolução.',
    );
  }

  // Quanto de cada item já foi devolvido antes, para não devolver em dobro.
  const jaDevolvido = await prisma.itemCancelamento.groupBy({
    by: ['itemVendaId'],
    where: { itemVenda: { vendaId: entrada.vendaId } },
    _sum: { quantidade: true },
  });
  const devolvidoPorItem = new Map(jaDevolvido.map((linha) => [linha.itemVendaId, linha._sum.quantidade ?? 0]));

  const disponiveis: ItemDisponivelParaDevolucao[] = venda.itens.map((item) => ({
    itemVendaId: item.id,
    varianteId: item.varianteId,
    quantidadeVendida: item.quantidade,
    quantidadeJaDevolvida: devolvidoPorItem.get(item.id) ?? 0,
    // Preço líquido por unidade: total do item (já com desconto) / quantidade.
    // Devolver metade de um item com desconto devolve metade do que foi
    // efetivamente pago, não do preço de tabela.
    precoUnitarioLiquidoCentavos: centavos(Math.round(item.totalCentavos / item.quantidade)),
  }));

  const devolucao = calcularDevolucao(disponiveis, entrada.itens);
  const movimentosEstoque = movimentosDeEstoqueDaDevolucao(devolucao);
  const movimentoCaixa = movimentoDeCaixaDaDevolucao(entrada.formaEstorno, devolucao.totalCentavos);

  const varianteDoItem = new Map(venda.itens.map((item) => [item.id, item.varianteId]));

  const cancelamento = await prisma.$transaction(async (tx) => {
    const registro = await tx.cancelamento.create({
      data: {
        vendaOriginalId: entrada.vendaId,
        motivo: entrada.motivo,
        valorCentavos: devolucao.totalCentavos,
        formaEstorno: entrada.formaEstorno,
        usuarioId: contexto.operadorId,
        autorizadoPorId: entrada.autorizadoPorId!,
        itens: {
          create: devolucao.itens.map((item) => ({
            itemVendaId: item.itemVendaId,
            quantidade: item.quantidade,
            valorCentavos: item.valorCentavos,
          })),
        },
      },
      select: { id: true },
    });

    await tx.movimentoEstoque.createMany({
      data: movimentosEstoque.map((movimento) => ({
        varianteId: movimento.varianteId,
        tipo: movimento.tipo,
        quantidade: movimento.quantidade,
        documentoTipo: 'CANCELAMENTO',
        documentoId: registro.id,
        usuarioId: contexto.operadorId,
      })),
    });

    if (movimentoCaixa) {
      await tx.movimentoCaixa.create({
        data: {
          sessaoCaixaId: venda.sessaoCaixaId,
          tipo: movimentoCaixa.tipo,
          valorCentavos: movimentoCaixa.valorCentavos,
          usuarioId: contexto.operadorId,
          autorizadoPorId: entrada.autorizadoPorId!,
          documentoTipo: 'CANCELAMENTO',
          documentoId: registro.id,
          observacao: `Devolução da venda ${entrada.vendaId}: ${entrada.motivo}`,
        },
      });
    }

    // Devolução mexe em dinheiro fora do fluxo normal de venda — mesma
    // disciplina de sangria/suprimento: sempre auditada, sem exceção de valor.
    await tx.registroAuditoria.create({
      data: {
        acao: 'DEVOLUCAO',
        entidade: 'Venda',
        entidadeId: entrada.vendaId,
        usuarioId: contexto.operadorId,
        autorizadoPorId: entrada.autorizadoPorId!,
        valorDepois: {
          cancelamentoId: registro.id,
          totalCentavos: devolucao.totalCentavos,
          formaEstorno: entrada.formaEstorno,
          itens: devolucao.itens.map((item) => ({
            itemVendaId: item.itemVendaId,
            varianteId: varianteDoItem.get(item.itemVendaId),
            quantidade: item.quantidade,
            valorCentavos: item.valorCentavos,
          })),
        },
      },
    });

    return registro;
  });

  return { cancelamentoId: cancelamento.id, totalCentavos: devolucao.totalCentavos };
}

/** Itens da venda com o disponível para devolução, para a UI montar a tela. */
export async function obterDisponivelParaDevolucao(
  prisma: PrismaClient,
  vendaId: string,
): Promise<
  | {
      readonly vendaId: string;
      readonly itens: readonly (ItemDisponivelParaDevolucao & { readonly descricao: string; readonly sku: string })[];
    }
  | null
> {
  const venda = await prisma.venda.findUnique({
    where: { id: vendaId },
    select: {
      id: true,
      itens: {
        select: {
          id: true,
          varianteId: true,
          descricao: true,
          sku: true,
          quantidade: true,
          totalCentavos: true,
        },
        orderBy: { sequencia: 'asc' },
      },
    },
  });
  if (!venda) return null;

  const jaDevolvido = await prisma.itemCancelamento.groupBy({
    by: ['itemVendaId'],
    where: { itemVenda: { vendaId } },
    _sum: { quantidade: true },
  });
  const devolvidoPorItem = new Map(jaDevolvido.map((linha) => [linha.itemVendaId, linha._sum.quantidade ?? 0]));

  return {
    vendaId: venda.id,
    itens: venda.itens.map((item) => ({
      itemVendaId: item.id,
      varianteId: item.varianteId,
      descricao: item.descricao,
      sku: item.sku,
      quantidadeVendida: item.quantidade,
      quantidadeJaDevolvida: devolvidoPorItem.get(item.id) ?? 0,
      precoUnitarioLiquidoCentavos: centavos(Math.round(item.totalCentavos / item.quantidade)),
    })),
  };
}
