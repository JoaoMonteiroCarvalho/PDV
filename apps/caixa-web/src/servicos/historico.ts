import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export interface LinhaHistoricoVenda {
  readonly id: string;
  readonly numero: number;
  readonly registradaEm: string;
  readonly criadaEmCliente: string;
  readonly operador: { readonly id: string; readonly nome: string };
  readonly totalCentavos: number;
  readonly quantidadeItens: number;
  readonly formasPagamento: readonly string[];
  readonly totalDevolvidoCentavos: number;
}

interface PaginaHistoricoVendas {
  readonly itens: readonly LinhaHistoricoVenda[];
  readonly proximoAntesDe: string | null;
  readonly proximoUltimoId: string | null;
  readonly temMais: boolean;
}

export interface FiltroHistorico {
  readonly desde?: string;
  readonly ate?: string;
  readonly operadorId?: string;
  readonly antesDe?: string;
  readonly ultimoId?: string;
}

/** Histórico é sempre estado do SERVIDOR — leitura pura, nenhum cálculo aqui. */
export function useHistoricoVendas(filtro: FiltroHistorico) {
  return useQuery({
    queryKey: ['historico-vendas', filtro],
    queryFn: () => {
      const parametros = new URLSearchParams();
      if (filtro.desde) parametros.set('desde', filtro.desde);
      if (filtro.ate) parametros.set('ate', filtro.ate);
      if (filtro.operadorId) parametros.set('operadorId', filtro.operadorId);
      if (filtro.antesDe) parametros.set('antesDe', filtro.antesDe);
      if (filtro.ultimoId) parametros.set('ultimoId', filtro.ultimoId);
      const query = parametros.toString();
      return api<PaginaHistoricoVendas>(`/vendas${query ? `?${query}` : ''}`);
    },
  });
}

export interface DetalheVenda {
  readonly id: string;
  readonly numero: number;
  readonly registradaEm: string;
  readonly operador: { readonly id: string; readonly nome: string };
  readonly cliente: { readonly id: string; readonly nome: string } | null;
  readonly subtotalCentavos: number;
  readonly descontoCentavos: number;
  readonly totalCentavos: number;
  readonly itens: readonly {
    readonly id: string;
    readonly descricao: string;
    readonly sku: string;
    readonly tamanho: string | null;
    readonly cor: string | null;
    readonly quantidade: number;
    readonly precoUnitarioCentavos: number;
    readonly descontoCentavos: number;
    readonly totalCentavos: number;
  }[];
  readonly pagamentos: readonly {
    readonly forma: string;
    readonly valorCentavos: number;
    readonly trocoCentavos: number;
  }[];
  readonly devolucoes: readonly {
    readonly id: string;
    readonly motivo: string;
    readonly formaEstorno: string;
    readonly valorCentavos: number;
    readonly criadoEm: string;
    readonly autorizadoPor: { readonly nome: string };
    readonly itens: readonly { itemVendaId: string; quantidade: number; valorCentavos: number }[];
  }[];
}

export function useDetalheVenda(vendaId: string | null) {
  return useQuery({
    queryKey: ['detalhe-venda', vendaId],
    queryFn: () => api<DetalheVenda>(`/vendas/${vendaId}`),
    enabled: vendaId !== null,
  });
}
