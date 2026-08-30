import { create } from 'zustand';

/**
 * Qual tela mostrar dentro do "modo caixa aberto": venda, gestão de caixa
 * (sangria, suprimento, fechamento) ou produtos/estoque.
 *
 * Não é uma rota de URL de propósito: ainda são telas alternando no mesmo
 * espaço, não destinos que fazem sentido favoritar ou compartilhar link —
 * nenhuma delas precisa de estado próprio na URL (uma busca de produto
 * digitada de novo não é fricção real numa loja de um caixa só). Quando
 * existirem destinos que precisam disso de verdade (clientes, relatórios —
 * fases seguintes), aí sim entra o React Router.
 */
type TelaPrincipal = 'venda' | 'gestao-caixa' | 'produtos' | 'devolucao';

interface EstadoNavegacao {
  readonly tela: TelaPrincipal;
  irParaVenda: () => void;
  irParaGestaoCaixa: () => void;
  irParaProdutos: () => void;
  irParaDevolucao: () => void;
}

export const useNavegacao = create<EstadoNavegacao>()((set) => ({
  tela: 'venda',
  irParaVenda: () => set({ tela: 'venda' }),
  irParaGestaoCaixa: () => set({ tela: 'gestao-caixa' }),
  irParaProdutos: () => set({ tela: 'produtos' }),
  irParaDevolucao: () => set({ tela: 'devolucao' }),
}));
