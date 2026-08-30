import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormaPagamento } from '@pdv/shared';
import { api } from './api.js';

export interface ItemVendaEntrada {
  readonly varianteId: string;
  readonly quantidade: number;
  readonly precoUnitarioCentavos: number;
  readonly descontoCentavos: number;
}

export interface PagamentoVendaEntrada {
  readonly forma: FormaPagamento;
  readonly valorCentavos: number;
  readonly trocoCentavos: number;
}

export interface RegistrarVendaEntrada {
  readonly id: string;
  readonly sessaoCaixaId: string;
  readonly criadaEmCliente: string;
  readonly itens: readonly ItemVendaEntrada[];
  readonly descontoSobreTotalCentavos: number;
  readonly pagamentos: readonly PagamentoVendaEntrada[];
}

export interface RespostaVenda {
  readonly vendaId: string;
  readonly numero: number;
  readonly totalCentavos: number;
  readonly jaEstavaRegistrada: boolean;
}

/**
 * Registra a venda já fechada. Idempotente pelo `id` gerado no cliente: um
 * reenvio (retry de rede, duplo clique) devolve a MESMA venda em vez de
 * criar outra — a Fase 4 depende exatamente disso pra fila offline funcionar.
 */
export function useRegistrarVenda() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: RegistrarVendaEntrada) =>
      api<RespostaVenda>('/vendas', { metodo: 'POST', corpo: entrada }),
    onSuccess: () => {
      // O saldo esperado do caixa muda a cada venda em dinheiro.
      void queryClient.invalidateQueries({ queryKey: ['sessao-caixa-aberta'] });
    },
  });
}
