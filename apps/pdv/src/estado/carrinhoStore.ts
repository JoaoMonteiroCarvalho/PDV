/**
 * Carrinho da venda em andamento.
 *
 * Este store é uma CASCA em volta de `venda/carrinho.ts`, que já é lógica
 * pura testada. Nada de cálculo acontece aqui — se um total for computado
 * neste arquivo, ele vai divergir do servidor mais cedo ou mais tarde, que é
 * exatamente o bug que a separação existe para impedir.
 *
 * O que o store adiciona é só o que o React precisa: estado observável,
 * pagamentos lançados e o passo de finalização.
 */

import type { PagamentoEntrada } from '@pdv/shared';
import { create } from 'zustand';
import type { ItemCatalogo } from '../banco/local.js';
import {
  CARRINHO_VAZIO,
  adicionar,
  alterarQuantidade,
  definirDescontoDoTotal,
  remover,
  type EstadoCarrinho,
} from '../venda/carrinho.js';

interface EstadoLoja {
  carrinho: EstadoCarrinho;
  pagamentos: PagamentoEntrada[];
  /** Mensagem da última venda concluída, para o aviso de sucesso. */
  ultimaVenda: string | null;

  adicionarItem: (item: ItemCatalogo, quantidade?: number) => void;
  mudarQuantidade: (varianteId: string, quantidade: number) => void;
  removerItem: (varianteId: string) => void;
  aplicarDesconto: (centavos: number) => void;
  lancarPagamento: (pagamento: PagamentoEntrada) => void;
  removerPagamento: (indice: number) => void;
  limparPagamentos: () => void;
  limparVenda: () => void;
  registrarSucesso: (mensagem: string) => void;
  descartarAviso: () => void;
}

export const useCarrinho = create<EstadoLoja>((set) => ({
  carrinho: CARRINHO_VAZIO,
  pagamentos: [],
  ultimaVenda: null,

  adicionarItem: (item, quantidade = 1) =>
    set((estado) => ({
      carrinho: adicionar(
        estado.carrinho,
        {
          id: item.id,
          sku: item.sku,
          nome: item.nome,
          tamanho: item.tamanho,
          cor: item.cor,
          precoCentavos: item.precoCentavos,
        },
        quantidade,
      ),
    })),

  mudarQuantidade: (varianteId, quantidade) =>
    set((estado) => ({ carrinho: alterarQuantidade(estado.carrinho, varianteId, quantidade) })),

  removerItem: (varianteId) =>
    set((estado) => ({ carrinho: remover(estado.carrinho, varianteId) })),

  aplicarDesconto: (centavos) =>
    set((estado) => ({
      carrinho: definirDescontoDoTotal(estado.carrinho, centavos as never),
    })),

  lancarPagamento: (pagamento) =>
    set((estado) => ({ pagamentos: [...estado.pagamentos, pagamento] })),

  removerPagamento: (indice) =>
    set((estado) => ({ pagamentos: estado.pagamentos.filter((_, i) => i !== indice) })),

  limparPagamentos: () => set({ pagamentos: [] }),

  // Zera tudo depois de finalizar ou cancelar. Os pagamentos vão junto: deixar
  // pagamento de uma venda anterior pendurado é como o dinheiro some do caixa.
  limparVenda: () => set({ carrinho: CARRINHO_VAZIO, pagamentos: [] }),

  registrarSucesso: (mensagem) => set({ ultimaVenda: mensagem }),
  descartarAviso: () => set({ ultimaVenda: null }),
}));
