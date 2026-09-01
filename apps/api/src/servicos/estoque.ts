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
