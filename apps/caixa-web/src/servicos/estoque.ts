import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export type TipoMovimentoEstoque = 'ENTRADA_COMPRA' | 'PERDA' | 'AJUSTE_INVENTARIO';

export interface EntradaMovimentoEstoque {
  readonly tipo: TipoMovimentoEstoque;
  readonly quantidade: number;
  readonly custoUnitarioCentavos?: number;
  readonly observacao?: string;
  readonly autorizadoPorId?: string;
}

/**
 * Ajuste manual de estoque: compra avulsa, perda ou correção de inventário.
 * Invalida `produtos` — a lista mostra o saldo, precisa refletir na hora.
 */
export function useRegistrarMovimentoEstoque(varianteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaMovimentoEstoque) =>
      api<{ id: string }>(`/variantes/${varianteId}/movimentos-estoque`, { metodo: 'POST', corpo: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['produtos'] });
    },
  });
}
