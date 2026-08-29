/**
 * Consulta de histórico de vendas — leitura pura, nenhum cálculo de domínio.
 *
 * Fica em `servicos/` pelo mesmo motivo dos demais: mantém `servidor.ts`
 * limitado a validar entrada e traduzir erro, sem montar consulta Prisma ali.
 */

import type { PrismaClient } from '@prisma/client';
import type { EntradaListarVendas } from '../esquemas/historico.js';

export interface LinhaHistoricoVenda {
  readonly id: string;
  readonly numero: number;
  readonly registradaEm: string;
  readonly criadaEmCliente: string;
  readonly operador: { readonly id: string; readonly nome: string };
  readonly totalCentavos: number;
  readonly quantidadeItens: number;
  readonly formasPagamento: readonly string[];
  /** Soma do que já foi devolvido desta venda, em qualquer devolução. */
  readonly totalDevolvidoCentavos: number;
}

export interface PaginaHistoricoVendas {
  readonly itens: readonly LinhaHistoricoVenda[];
  readonly proximoAntesDe: string | null;
  readonly proximoUltimoId: string | null;
  readonly temMais: boolean;
}

/**
 * Lista vendas da mais recente para a mais antiga, paginada por chave
 * (`registradaEm`, `id`) — mesmo motivo do `/catalogo`: com OFFSET, uma venda
 * registrada durante a consulta desloca as páginas seguintes e uma linha
 * pode sumir ou repetir na tela do operador.
 */
export async function listarHistoricoVendas(
  prisma: PrismaClient,
  entrada: EntradaListarVendas,
): Promise<PaginaHistoricoVendas> {
  const { antesDe, ultimoId, limite, desde, ate, operadorId } = entrada;

  const filtroCursor =
    antesDe === undefined
      ? {}
      : ultimoId === undefined
        ? { registradaEm: { lt: antesDe } }
        : {
            OR: [
              { registradaEm: { lt: antesDe } },
              { registradaEm: antesDe, id: { lt: ultimoId } },
            ],
          };

  const filtroPeriodo: Record<string, unknown> = {};
  if (desde !== undefined || ate !== undefined) {
    filtroPeriodo.registradaEm = {
      ...(desde !== undefined ? { gte: desde } : {}),
      ...(ate !== undefined ? { lte: ate } : {}),
    };
  }

  const vendas = await prisma.venda.findMany({
    where: {
      ...filtroCursor,
      ...filtroPeriodo,
      ...(operadorId !== undefined ? { operadorId } : {}),
    },
    orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }],
    // Pede um a mais que o limite para saber se há próxima página sem COUNT.
    take: limite + 1,
    select: {
      id: true,
      numero: true,
      registradaEm: true,
      criadaEmCliente: true,
      totalCentavos: true,
      operador: { select: { id: true, nome: true } },
      itens: { select: { id: true } },
      pagamentos: { select: { forma: true } },
      cancelamentos: { select: { valorCentavos: true } },
    },
  });

  const temMais = vendas.length > limite;
  const pagina = temMais ? vendas.slice(0, limite) : vendas;
  const ultima = pagina.at(-1);

  return {
    itens: pagina.map((venda) => ({
      id: venda.id,
      numero: venda.numero,
      registradaEm: venda.registradaEm.toISOString(),
      criadaEmCliente: venda.criadaEmCliente.toISOString(),
      operador: venda.operador,
      totalCentavos: venda.totalCentavos,
      quantidadeItens: venda.itens.length,
      // Um conjunto: a mesma forma repetida em pagamento dividido conta uma vez.
      formasPagamento: [...new Set(venda.pagamentos.map((p) => p.forma))],
      totalDevolvidoCentavos: venda.cancelamentos.reduce((soma, c) => soma + c.valorCentavos, 0),
    })),
    proximoAntesDe: ultima?.registradaEm.toISOString() ?? null,
    proximoUltimoId: ultima?.id ?? null,
    temMais,
  };
}

export interface DetalheVenda {
  readonly id: string;
  readonly numero: number;
  readonly registradaEm: string;
  readonly criadaEmCliente: string;
  readonly operador: { readonly id: string; readonly nome: string };
  readonly cliente: { readonly id: string; readonly nome: string } | null;
  readonly subtotalCentavos: number;
  readonly descontoCentavos: number;
  readonly totalCentavos: number;
  readonly itens: ReadonlyArray<{
    readonly id: string;
    readonly descricao: string;
    readonly sku: string;
    readonly tamanho: string | null;
    readonly cor: string | null;
    readonly quantidade: number;
    readonly precoUnitarioCentavos: number;
    readonly descontoCentavos: number;
    readonly totalCentavos: number;
  }>;
  readonly pagamentos: ReadonlyArray<{
    readonly forma: string;
    readonly valorCentavos: number;
    readonly trocoCentavos: number;
  }>;
  readonly devolucoes: ReadonlyArray<{
    readonly id: string;
    readonly motivo: string;
    readonly formaEstorno: string;
    readonly valorCentavos: number;
    readonly criadoEm: string;
    readonly autorizadoPor: { readonly nome: string };
    readonly itens: ReadonlyArray<{
      readonly itemVendaId: string;
      readonly quantidade: number;
      readonly valorCentavos: number;
    }>;
  }>;
}

/** Detalhe completo de uma venda para a tela de histórico. Sem alçada de leitura. */
export async function obterDetalheVenda(
  prisma: PrismaClient,
  vendaId: string,
): Promise<DetalheVenda | null> {
  const venda = await prisma.venda.findUnique({
    where: { id: vendaId },
    select: {
      id: true,
      numero: true,
      registradaEm: true,
      criadaEmCliente: true,
      subtotalCentavos: true,
      descontoCentavos: true,
      totalCentavos: true,
      operador: { select: { id: true, nome: true } },
      cliente: { select: { id: true, nome: true } },
      itens: {
        orderBy: { sequencia: 'asc' },
        select: {
          id: true,
          descricao: true,
          sku: true,
          tamanho: true,
          cor: true,
          quantidade: true,
          precoUnitarioCentavos: true,
          descontoCentavos: true,
          totalCentavos: true,
        },
      },
      pagamentos: {
        select: { forma: true, valorCentavos: true, trocoCentavos: true },
      },
      cancelamentos: {
        orderBy: { criadoEm: 'asc' },
        select: {
          id: true,
          motivo: true,
          formaEstorno: true,
          valorCentavos: true,
          criadoEm: true,
          autorizadoPor: { select: { nome: true } },
          itens: { select: { itemVendaId: true, quantidade: true, valorCentavos: true } },
        },
      },
    },
  });
  if (!venda) return null;

  return {
    id: venda.id,
    numero: venda.numero,
    registradaEm: venda.registradaEm.toISOString(),
    criadaEmCliente: venda.criadaEmCliente.toISOString(),
    operador: venda.operador,
    cliente: venda.cliente,
    subtotalCentavos: venda.subtotalCentavos,
    descontoCentavos: venda.descontoCentavos,
    totalCentavos: venda.totalCentavos,
    itens: venda.itens,
    pagamentos: venda.pagamentos,
    devolucoes: venda.cancelamentos.map((c) => ({
      id: c.id,
      motivo: c.motivo,
      formaEstorno: c.formaEstorno,
      valorCentavos: c.valorCentavos,
      criadoEm: c.criadoEm.toISOString(),
      autorizadoPor: c.autorizadoPor,
      itens: c.itens,
    })),
  };
}
