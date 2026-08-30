import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export interface MovimentoManualEntrada {
  readonly tipo: 'SANGRIA' | 'SUPRIMENTO';
  readonly valorCentavos: number;
  readonly observacao: string;
  readonly autorizadoPorId: string;
}

/**
 * Sangria e suprimento. SEMPRE exigem gerente identificado, sem alçada de
 * valor — mesmo R$ 1,00 exige autorização. O `autorizadoPorId` vem de
 * `ModalAutorizarGerente`, não da sessão do operador que está operando.
 */
export function useRegistrarMovimentoCaixa(sessaoCaixaId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: MovimentoManualEntrada) =>
      api<{ id: string }>(`/sessoes-caixa/${sessaoCaixaId}/movimentos`, { metodo: 'POST', corpo: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessao-caixa-aberta'] });
    },
  });
}

export interface ResultadoFecharSessao {
  readonly valorEsperadoCentavos: number;
  readonly valorContadoCentavos: number;
  readonly diferencaCentavos: number;
}

/**
 * Fecha a sessão. O servidor NUNCA bloqueia por divergência — o caixa físico
 * precisa fechar de qualquer jeito — mas audita toda diferença ≠ 0.
 * `valorEsperadoCentavos` só chega aqui DEPOIS que o operador já digitou o
 * que contou: é isso que faz a conferência ser cega de verdade.
 *
 * DELIBERADAMENTE não invalida `sessao-caixa-aberta` no sucesso. Se
 * invalidasse aqui, a árvore de componentes reagiria na hora — o portão de
 * entrada (PortaDeEntrada) veria a sessão sumir e trocaria pra tela de
 * abertura de caixa IMEDIATAMENTE, antes do operador conseguir ver a
 * diferença na tela de resultado. `useMarcarCaixaFechado`, abaixo, é quem
 * dispara essa invalidação — só quando o operador clica em "Concluir".
 */
export function useFecharCaixa(sessaoCaixaId: string) {
  return useMutation({
    mutationFn: (valorContadoCentavos: number) =>
      api<ResultadoFecharSessao>(`/sessoes-caixa/${sessaoCaixaId}/fechar`, {
        metodo: 'POST',
        corpo: { valorContadoCentavos },
      }),
  });
}

/** Dispara a saída da tela de resultado do fechamento — ver comentário acima. */
export function useMarcarCaixaFechado() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['sessao-caixa-aberta'] });
  };
}
