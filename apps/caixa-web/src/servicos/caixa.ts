import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErroApi } from './api.js';

export interface SessaoCaixaAberta {
  readonly id: string;
  readonly terminalId: string;
  readonly fundoTrocoCentavos: number;
  readonly abertaEm: string;
  readonly saldoEsperadoCentavos: number;
}

/**
 * Sessão de caixa aberta do terminal — estado do SERVIDOR, por isso vive em
 * TanStack Query, nunca em Zustand. `null` quando não há sessão aberta (404
 * é resposta esperada, não erro de rede — tratado aqui, não vaza pra tela).
 */
export function useSessaoCaixaAberta(terminalId: string | null) {
  return useQuery({
    queryKey: ['sessao-caixa-aberta', terminalId],
    queryFn: async (): Promise<SessaoCaixaAberta | null> => {
      try {
        return await api<SessaoCaixaAberta>(`/sessoes-caixa/aberta?terminalId=${terminalId}`);
      } catch (erro) {
        if (erro instanceof ErroApi && erro.status === 404) return null;
        throw erro;
      }
    },
    enabled: terminalId !== null,
  });
}

export function useAbrirSessaoCaixa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { terminalId: string; fundoTrocoCentavos: number }) =>
      api<{ id: string }>('/sessoes-caixa', { metodo: 'POST', corpo: entrada }),
    onSuccess: (_dados, variaveis) => {
      void queryClient.invalidateQueries({ queryKey: ['sessao-caixa-aberta', variaveis.terminalId] });
    },
  });
}
