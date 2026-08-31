/**
 * Sessão da operadora (quem está logada agora).
 *
 * O token continua vivendo dentro do `ClienteApi` — este store é a fonte de
 * verdade para a INTERFACE reagir (mostrar nome, liberar rotas), não um
 * segundo lugar guardando credencial. Duas cópias do token divergiriam.
 */

import { create } from 'zustand';
import { clienteApi, type Operador } from '../api/cliente.js';

interface EstadoSessao {
  operadora: Operador | null;
  entrando: boolean;
  erro: string | null;
  entrar: (login: string, senha: string) => Promise<void>;
  sair: () => void;
  limparErro: () => void;
}

export const useSessao = create<EstadoSessao>((set) => ({
  // Ao recarregar a página no meio do expediente, a operadora continua logada.
  operadora: clienteApi.temToken() ? clienteApi.operadorSalvo() : null,
  entrando: false,
  erro: null,

  entrar: async (login, senha) => {
    set({ entrando: true, erro: null });
    try {
      const { operador } = await clienteApi.entrar(login, senha);
      set({ operadora: operador, entrando: false });
    } catch (falha) {
      set({
        entrando: false,
        erro: falha instanceof Error ? falha.message : 'Não foi possível entrar.',
      });
      throw falha;
    }
  },

  sair: () => {
    clienteApi.sair();
    set({ operadora: null, erro: null });
  },

  limparErro: () => set({ erro: null }),
}));

/** Só GERENTE e ADMIN liberam sangria, devolução e desconto acima da alçada. */
export function ehGerente(operadora: Operador | null): boolean {
  return operadora?.papel === 'GERENTE' || operadora?.papel === 'ADMIN';
}
