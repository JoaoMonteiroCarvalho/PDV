import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export interface VendaLocalizada {
  readonly id: string;
  readonly numero: number;
  readonly totalCentavos: number;
  readonly registradaEm: string;
}

/** Busca por número sequencial (impresso no comprovante) ou código curto de 8 hex. */
export function useLocalizarVenda() {
  return useMutation({
    mutationFn: (busca: string): Promise<VendaLocalizada> => {
      const valor = busca.trim();
      const ehNumero = /^\d+$/.test(valor);
      return ehNumero
        ? api<VendaLocalizada>(`/vendas/por-numero/${valor}`)
        : api<VendaLocalizada>(`/vendas/por-codigo/${valor.toLowerCase()}`);
    },
  });
}

export interface ItemDisponivelParaDevolucao {
  readonly itemVendaId: string;
  readonly varianteId: string;
  readonly descricao: string;
  readonly sku: string;
  readonly quantidadeVendida: number;
  readonly quantidadeJaDevolvida: number;
  readonly precoUnitarioLiquidoCentavos: number;
}

interface DisponivelParaDevolucao {
  readonly vendaId: string;
  readonly itens: readonly ItemDisponivelParaDevolucao[];
}

export function useDisponivelParaDevolucao(vendaId: string | null) {
  return useQuery({
    queryKey: ['disponivel-para-devolucao', vendaId],
    queryFn: () => api<DisponivelParaDevolucao>(`/vendas/${vendaId}/disponivel-para-devolucao`),
    enabled: vendaId !== null,
  });
}

export type FormaEstorno = 'DINHEIRO' | 'PIX' | 'CARTAO' | 'VALE_TROCA';

export interface EntradaRegistrarDevolucao {
  readonly motivo: string;
  readonly formaEstorno: FormaEstorno;
  readonly itens: readonly { itemVendaId: string; quantidade: number }[];
  readonly autorizadoPorId: string;
}

export interface ResultadoDevolucao {
  readonly cancelamentoId: string;
  readonly totalCentavos: number;
}

/**
 * Não invalida nenhuma query no sucesso — a tela de resultado precisa ficar
 * de pé até o operador clicar em "Concluir" (mesma lição da Fase 5: nunca
 * deixar um efeito colateral derrubar a UI de resultado antes do operador
 * conseguir ler o que aconteceu).
 */
export function useRegistrarDevolucao(vendaId: string) {
  return useMutation({
    mutationFn: (entrada: EntradaRegistrarDevolucao) =>
      api<ResultadoDevolucao>(`/vendas/${vendaId}/devolucao`, { metodo: 'POST', corpo: entrada }),
  });
}

