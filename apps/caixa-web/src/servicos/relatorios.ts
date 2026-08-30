import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export interface PontoPorDia {
  readonly data: string;
  readonly quantidadeVendas: number;
  readonly totalCentavos: number;
}

export interface LinhaPorFormaPagamento {
  readonly forma: string;
  readonly quantidade: number;
  readonly totalCentavos: number;
}

export interface LinhaPorOperador {
  readonly operadorId: string;
  readonly nome: string;
  readonly quantidadeVendas: number;
  readonly totalCentavos: number;
  readonly ticketMedioCentavos: number;
}

export interface LinhaProdutoMaisVendido {
  readonly varianteId: string;
  readonly descricao: string;
  readonly sku: string;
  readonly quantidadeVendida: number;
  readonly totalCentavos: number;
}

export interface LinhaDevolucaoPorForma {
  readonly formaEstorno: string;
  readonly quantidade: number;
  readonly valorCentavos: number;
}

export interface RelatorioResumo {
  readonly periodo: { readonly desde: string; readonly ate: string };
  readonly quantidadeVendas: number;
  readonly totalVendidoCentavos: number;
  readonly totalDevolvidoCentavos: number;
  readonly totalLiquidoCentavos: number;
  readonly ticketMedioCentavos: number;
  readonly totalItensVendidos: number;
  readonly quantidadeDevolucoes: number;
  readonly porDia: readonly PontoPorDia[];
  readonly porFormaPagamento: readonly LinhaPorFormaPagamento[];
  readonly porOperador: readonly LinhaPorOperador[];
  readonly produtosMaisVendidos: readonly LinhaProdutoMaisVendido[];
  readonly devolucoesPorFormaEstorno: readonly LinhaDevolucaoPorForma[];
}

export interface FiltroRelatorio {
  readonly desde?: string;
  readonly ate?: string;
  readonly operadorId?: string;
}

export function useRelatorioResumo(filtro: FiltroRelatorio) {
  return useQuery({
    queryKey: ['relatorio-resumo', filtro],
    queryFn: () => {
      const parametros = new URLSearchParams();
      if (filtro.desde) parametros.set('desde', filtro.desde);
      if (filtro.ate) parametros.set('ate', filtro.ate);
      if (filtro.operadorId) parametros.set('operadorId', filtro.operadorId);
      const query = parametros.toString();
      return api<RelatorioResumo>(`/relatorios/resumo${query ? `?${query}` : ''}`);
    },
  });
}

export interface Operador {
  readonly id: string;
  readonly nome: string;
}

export function useOperadores() {
  return useQuery({
    queryKey: ['operadores'],
    queryFn: () => api<{ operadores: readonly Operador[] }>('/operadores'),
    staleTime: 5 * 60 * 1000,
  });
}
