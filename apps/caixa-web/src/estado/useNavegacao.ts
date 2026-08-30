import { create } from 'zustand';

/**
 * Qual tela mostrar dentro do "modo caixa aberto": venda ou gestão de caixa
 * (sangria, suprimento, fechamento).
 *
 * Não é uma rota de URL de propósito: ainda são só duas telas alternando no
 * mesmo espaço, não destinos que fazem sentido favoritar ou compartilhar
 * link. Quando existirem várias telas de navegação de verdade (produtos,
 * clientes, relatórios — fases seguintes), aí sim entra o React Router.
 */
type TelaPrincipal = 'venda' | 'gestao-caixa';

interface EstadoNavegacao {
  readonly tela: TelaPrincipal;
  irParaVenda: () => void;
  irParaGestaoCaixa: () => void;
}

export const useNavegacao = create<EstadoNavegacao>()((set) => ({
  tela: 'venda',
  irParaVenda: () => set({ tela: 'venda' }),
  irParaGestaoCaixa: () => set({ tela: 'gestao-caixa' }),
}));
