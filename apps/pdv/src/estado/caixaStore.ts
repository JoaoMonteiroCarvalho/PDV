/**
 * Sessão de caixa aberta neste terminal.
 *
 * Sem caixa aberto não existe venda — não há onde lançar o dinheiro. O
 * roteador usa este store para bloquear a rota de venda, em vez de deixar a
 * operadora lançar itens e só descobrir o problema ao finalizar.
 */

import { create } from 'zustand';
import { clienteApi, type SessaoCaixaAberta } from '../api/cliente.js';

const CHAVE_TERMINAL = 'pdv.terminalId';

/** O terminal é configurado uma vez por computador da loja. */
export function terminalConfigurado(): string | null {
  try {
    return localStorage.getItem(CHAVE_TERMINAL);
  } catch {
    return null;
  }
}

export function definirTerminal(terminalId: string): void {
  localStorage.setItem(CHAVE_TERMINAL, terminalId.trim());
}

interface EstadoCaixa {
  sessao: SessaoCaixaAberta | null;
  carregando: boolean;
  /**
   * Distingue "não há caixa aberto" de "ainda não perguntei ao servidor".
   * Sem isso, o guard de rota manda a operadora para a tela de abertura no
   * primeiro render — antes da consulta voltar — mesmo com caixa já aberto.
   */
  jaConsultou: boolean;
  erro: string | null;
  /** Consulta o servidor para saber se o terminal já tem caixa aberto. */
  sincronizar: () => Promise<SessaoCaixaAberta | null>;
  abrir: (fundoTrocoCentavos: number) => Promise<void>;
  /** Chamado após fechar o caixa: limpa o estado local. */
  encerrar: () => void;
}

export const useCaixa = create<EstadoCaixa>((set) => ({
  sessao: null,
  carregando: false,
  jaConsultou: false,
  erro: null,

  sincronizar: async () => {
    const terminalId = terminalConfigurado();
    if (!terminalId) {
      set({ sessao: null, carregando: false, jaConsultou: true });
      return null;
    }
    set({ carregando: true, erro: null });
    try {
      const sessao = await clienteApi.buscarSessaoAberta(terminalId);
      set({ sessao, carregando: false, jaConsultou: true });
      return sessao;
    } catch (falha) {
      set({
        carregando: false,
        jaConsultou: true,
        erro: falha instanceof Error ? falha.message : 'Não foi possível consultar o caixa.',
      });
      return null;
    }
  },

  abrir: async (fundoTrocoCentavos) => {
    const terminalId = terminalConfigurado();
    if (!terminalId) {
      set({ erro: 'Terminal não configurado neste computador.' });
      throw new Error('Terminal não configurado.');
    }
    set({ carregando: true, erro: null });
    try {
      await clienteApi.abrirSessao(terminalId, fundoTrocoCentavos);
      const sessao = await clienteApi.buscarSessaoAberta(terminalId);
      set({ sessao, carregando: false });
    } catch (falha) {
      set({
        carregando: false,
        erro: falha instanceof Error ? falha.message : 'Não foi possível abrir o caixa.',
      });
      throw falha;
    }
  },

  encerrar: () => set({ sessao: null, erro: null, jaConsultou: true }),
}));
