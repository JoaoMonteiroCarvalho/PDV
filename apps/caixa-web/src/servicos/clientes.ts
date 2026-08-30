import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export interface Cliente {
  readonly id: string;
  readonly nome: string;
  readonly cpf: string | null;
  readonly telefone: string | null;
  readonly ativo: boolean;
  readonly limiteCrediarioCentavos: number;
}

export function useBuscarClientes(busca: string) {
  return useQuery({
    queryKey: ['clientes', busca],
    queryFn: () => api<{ itens: readonly Cliente[] }>(`/clientes?busca=${encodeURIComponent(busca)}`),
    enabled: busca.trim().length > 0,
  });
}

export interface EntradaCriarCliente {
  readonly nome: string;
  readonly telefone?: string;
  readonly cpf?: string;
  readonly limiteCrediarioCentavos: number;
}

export function useCriarCliente() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaCriarCliente) => api<{ id: string }>('/clientes', { metodo: 'POST', corpo: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clientes'] });
    },
  });
}

export interface ParcelaEmAberto {
  readonly id: string;
  readonly tituloId: string;
  readonly vendaId: string;
  readonly numero: number;
  readonly valorCentavos: number;
  readonly vencimento: string;
  readonly status: string;
}

export interface CrediarioCliente {
  readonly clienteId: string;
  readonly limiteCrediarioCentavos: number;
  readonly emAbertoCentavos: number;
  readonly limiteDisponivelCentavos: number;
  readonly parcelas: readonly ParcelaEmAberto[];
}

/**
 * Parcelas em aberto + limite disponível — usado tanto no `ModalFinalizarVenda`
 * (checar limite antes de fechar em crediário) quanto na `TelaCrediario`
 * (cobrança).
 *
 * `staleTime: 0`, sobrescrevendo o padrão global de 30s: quando a
 * `TelaCrediario` seleciona um cliente que acabou de comprar fiado, ela só
 * troca o `clienteId` — o observer do `useQuery` não desmonta, então
 * `refetchOnMount` nunca dispara de novo (só vale na primeira montagem, que
 * aconteceu com a query desabilitada). Sem `staleTime: 0`, a tela herdava o
 * cache "antes da venda" que o `ModalFinalizarVenda` tinha acabado de gravar
 * para o mesmo cliente, mostrando o limite de antes da compra em fiado que
 * tinha acabado de fechar. Achado ao vivo, ponta a ponta: um teste de
 * componente isolado (QueryClient novo por teste) nunca reproduziria isso.
 */
export function useCrediarioCliente(clienteId: string | null) {
  return useQuery({
    queryKey: ['crediario-cliente', clienteId],
    queryFn: () => api<CrediarioCliente>(`/clientes/${clienteId}/crediario`),
    enabled: clienteId !== null,
    staleTime: 0,
  });
}

export interface EntradaReceberParcela {
  readonly sessaoCaixaId: string;
  readonly valorCentavos: number;
  readonly forma: 'DINHEIRO' | 'DEBITO' | 'CREDITO' | 'PIX';
}

/** Não invalida nada no sucesso — mesma disciplina das Fases 5/7: quem chama decide quando sair da tela de resultado. */
export function useReceberParcela(parcelaId: string) {
  return useMutation({
    mutationFn: (entrada: EntradaReceberParcela) =>
      api<{ id: string }>(`/parcelas/${parcelaId}/receber`, { metodo: 'POST', corpo: entrada }),
  });
}
