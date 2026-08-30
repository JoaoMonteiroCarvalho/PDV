import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Estado de sessão do CLIENTE — quem está logado e em qual terminal.
 *
 * Deliberadamente NÃO guarda a sessão de caixa aberta aqui: isso é estado do
 * SERVIDOR (pode mudar por outra ação, precisa de refetch), e vive em
 * TanStack Query (`servicos/caixa.ts`), não em Zustand.
 *
 * Persistido em localStorage: um PDV recarrega a página (F5, queda de
 * energia, atualização do navegador) sem deslogar o operador nem esquecer
 * qual terminal físico esta máquina é.
 */

export interface Operador {
  readonly id: string;
  readonly nome: string;
  readonly papel: 'OPERADOR' | 'GERENTE' | 'ADMIN';
  readonly limiteDescontoBps: number;
}

interface EstadoSessao {
  readonly token: string | null;
  readonly operador: Operador | null;
  readonly terminalId: string | null;

  entrar: (token: string, operador: Operador) => void;
  sair: () => void;
  definirTerminal: (terminalId: string) => void;
}

export const useSessao = create<EstadoSessao>()(
  persist(
    (set) => ({
      token: null,
      operador: null,
      terminalId: null,

      entrar: (token, operador) => set({ token, operador }),
      // Sair NÃO apaga terminalId — o terminal continua sendo esta máquina
      // física mesmo depois que o operador desloga.
      sair: () => set({ token: null, operador: null }),
      definirTerminal: (terminalId) => set({ terminalId }),
    }),
    { name: 'pdv.sessao' },
  ),
);
