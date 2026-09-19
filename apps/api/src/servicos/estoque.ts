/**
 * Entrada de mercadoria no estoque.
 *
 * O estoque é um LIVRO-RAZÃO: nunca se escreve um saldo, só se lança
 * movimento. `EstoqueAtual` é a soma. Isso vale aqui igual vale na venda — dar
 * entrada é somar uma linha, não corrigir um número.
 *
 * Idempotência: a mesma nota enviada duas vezes dobraria o estoque, e é um
 * erro fácil de cometer (a operadora clica de novo achando que não foi). O
 * `documentoId` guarda a chave da nota; um segundo envio do mesmo documento é
 * RECUSADO, não duplicado.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

export class ErroEstoque extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroEstoque';
  }
}

export interface ItemEntradaEstoque {
  readonly varianteId: string;
  readonly quantidade: number;
  readonly custoUnitarioCentavos: number;
}

export interface EntradaEstoqueEntrada {
  readonly itens: readonly ItemEntradaEstoque[];
  readonly documento?: string | undefined;
  readonly observacao?: string | undefined;
}

export interface ResultadoEntrada {
  readonly movimentos: number;
  readonly pecas: number;
}

export async function registrarEntradaEstoque(
  prisma: PrismaClient,
  entrada: EntradaEstoqueEntrada,
  contexto: { operadorId: string },
): Promise<ResultadoEntrada> {
  const ids = [...new Set(entrada.itens.map((item) => item.varianteId))];

  /*
   * Confere TODAS as variantes antes de gravar QUALQUER uma. Entrada pela
   * metade seria pior que entrada nenhuma: a operadora veria "deu erro",
   * mandaria de novo, e as linhas que passaram entrariam em dobro.
   */
  const existentes = await prisma.variante.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (existentes.length !== ids.length) {
    const achadas = new Set(existentes.map((variante) => variante.id));
    const faltando = ids.filter((id) => !achadas.has(id));
    throw new ErroEstoque(
      'VARIANTE_INEXISTENTE',
      `Variante não encontrada: ${faltando.slice(0, 3).join(', ')}.`,
    );
  }

  if (entrada.documento) {
    const jaEntrou = await prisma.movimentoEstoque.findFirst({
      where: { documentoTipo: 'NOTA_ENTRADA', documentoId: entrada.documento },
      select: { id: true },
    });
    if (jaEntrou) {
      throw new ErroEstoque(
        'DOCUMENTO_JA_LANCADO',
        `A nota ${entrada.documento} já teve entrada registrada. Lançar de novo dobraria o estoque.`,
      );
    }
  }

  const pecas = entrada.itens.reduce((soma, item) => soma + item.quantidade, 0);

  await prisma.$transaction(async (tx) => {
    await tx.movimentoEstoque.createMany({
      data: entrada.itens.map((item) => ({
        varianteId: item.varianteId,
        tipo: 'ENTRADA_COMPRA' as const,
        // Positivo: entrada põe no livro-razão.
        quantidade: item.quantidade,
        custoUnitarioCentavos: item.custoUnitarioCentavos,
        documentoTipo: entrada.documento ? 'NOTA_ENTRADA' : null,
        documentoId: entrada.documento ?? null,
        usuarioId: contexto.operadorId,
        observacao: entrada.observacao ?? null,
      })),
    });

    /*
     * O custo da variante passa a ser o da última entrada. É o método que a
     * loja usa na prática ("quanto paguei da última vez"), e o único que dá
     * para sustentar sem um cadastro de lotes que ninguém vai manter.
     */
    for (const item of entrada.itens) {
      if (item.custoUnitarioCentavos > 0) {
        await tx.variante.update({
          where: { id: item.varianteId },
          data: { custoCentavos: item.custoUnitarioCentavos },
        });
      }
    }

    await tx.registroAuditoria.create({
      data: {
        acao: 'ENTRADA_ESTOQUE',
        entidade: 'MovimentoEstoque',
        entidadeId: entrada.documento ?? 'sem-documento',
        usuarioId: contexto.operadorId,
        valorDepois: {
          documento: entrada.documento ?? null,
          itens: entrada.itens.length,
          pecas,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { movimentos: entrada.itens.length, pecas };
}

// ---------------------------------------------------------------------------
// Ajuste de inventário
// ---------------------------------------------------------------------------

export interface ResultadoAjuste {
  readonly saldoAnterior: number;
  readonly saldoNovo: number;
  /** Com sinal: negativo é peça que faltou na arara, positivo é peça a mais. */
  readonly diferenca: number;
  /** false quando a contagem bateu — nada foi lançado, e nada precisava ser. */
  readonly ajustado: boolean;
}

/**
 * Corrige o saldo de uma variação para a quantidade CONTADA na arara.
 *
 * O estoque continua sendo livro-razão: isto não escreve um saldo, lança o
 * movimento que falta para o saldo bater com a contagem. É a única forma de
 * corrigir sem quebrar a regra de que todo saldo é soma de movimentos.
 *
 * Contagem que bate não lança nada. Um movimento de quantidade zero é proibido
 * pelo próprio schema, e gravar linha "nada mudou" só poluiria o histórico que
 * a gerente vai ler quando faltar peça.
 *
 * SEMPRE auditado, inclusive quando bate: a conferência que não achou
 * diferença é informação — é ela que diz desde quando aquele saldo é confiável.
 */
export async function ajustarInventario(
  prisma: PrismaClient,
  entrada: { varianteId: string; quantidadeContada: number; observacao: string },
  contexto: { operadorId: string },
): Promise<ResultadoAjuste> {
  const variante = await prisma.variante.findUnique({
    where: { id: entrada.varianteId },
    select: { id: true, sku: true, produto: { select: { nome: true } } },
  });
  if (!variante) {
    throw new ErroEstoque('VARIANTE_INEXISTENTE', 'Variação não encontrada.');
  }

  const [saldoAtual] = await prisma.$queryRaw<{ saldo: number }[]>`
    SELECT "saldo" FROM "EstoqueAtual" WHERE "varianteId" = ${entrada.varianteId}
  `;
  const saldoAnterior = saldoAtual?.saldo ?? 0;
  const diferenca = entrada.quantidadeContada - saldoAnterior;

  await prisma.$transaction(async (tx) => {
    if (diferenca !== 0) {
      await tx.movimentoEstoque.create({
        data: {
          varianteId: entrada.varianteId,
          tipo: 'AJUSTE_INVENTARIO',
          quantidade: diferenca,
          documentoTipo: 'INVENTARIO',
          usuarioId: contexto.operadorId,
          observacao: entrada.observacao,
        },
      });
    }

    await tx.registroAuditoria.create({
      data: {
        acao: 'AJUSTE_INVENTARIO',
        entidade: 'Variante',
        entidadeId: entrada.varianteId,
        usuarioId: contexto.operadorId,
        valorAntes: {
          produto: variante.produto.nome,
          sku: variante.sku,
          saldo: saldoAnterior,
        } as Prisma.InputJsonValue,
        valorDepois: {
          saldo: entrada.quantidadeContada,
          diferenca,
          observacao: entrada.observacao,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return {
    saldoAnterior,
    saldoNovo: entrada.quantidadeContada,
    diferenca,
    ajustado: diferenca !== 0,
  };
}

// ---------------------------------------------------------------------------
// Histórico de movimentação
// ---------------------------------------------------------------------------

/**
 * Extrato de uma variação: cada linha que compõe o saldo atual.
 *
 * O saldo acumulado é calculado de trás para frente — do saldo de hoje,
 * desfazendo movimento a movimento. É assim que a gerente responde "em que
 * momento esse estoque ficou negativo?", que é a pergunta que traz alguém a
 * esta tela.
 */
export async function historicoMovimentacao(
  prisma: PrismaClient,
  varianteId: string,
  limite: number,
) {
  const variante = await prisma.variante.findUnique({
    where: { id: varianteId },
    select: { id: true, sku: true, tamanho: true, cor: true, produto: { select: { nome: true } } },
  });
  if (!variante) {
    throw new ErroEstoque('VARIANTE_INEXISTENTE', 'Variação não encontrada.');
  }

  const [saldoAtual] = await prisma.$queryRaw<{ saldo: number }[]>`
    SELECT "saldo" FROM "EstoqueAtual" WHERE "varianteId" = ${varianteId}
  `;
  const saldo = saldoAtual?.saldo ?? 0;

  const movimentos = await prisma.movimentoEstoque.findMany({
    where: { varianteId },
    orderBy: { criadoEm: 'desc' },
    take: limite,
    select: {
      id: true,
      tipo: true,
      quantidade: true,
      criadoEm: true,
      observacao: true,
      documentoTipo: true,
      documentoId: true,
      usuario: { select: { nome: true } },
      venda: { select: { numero: true } },
    },
  });

  let acumulado = saldo;
  const linhas = movimentos.map((movimento) => {
    const saldoDepois = acumulado;
    acumulado -= movimento.quantidade;
    return {
      id: movimento.id,
      tipo: movimento.tipo,
      quantidade: movimento.quantidade,
      saldoDepois,
      criadoEm: movimento.criadoEm,
      observacao: movimento.observacao,
      documentoTipo: movimento.documentoTipo,
      documentoId: movimento.documentoId,
      usuario: movimento.usuario?.nome ?? null,
      vendaNumero: movimento.venda?.numero ?? null,
    };
  });

  return {
    variante: {
      id: variante.id,
      sku: variante.sku,
      tamanho: variante.tamanho,
      cor: variante.cor,
      produto: variante.produto.nome,
    },
    saldoAtual: saldo,
    movimentos: linhas,
  };
}
