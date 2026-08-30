import { create } from 'zustand';
import type { ItemCatalogo } from '@/servicos/catalogo.js';

/**
 * Carrinho em andamento — estado do CLIENTE, não persistido entre recargas
 * de propósito: uma venda em progresso que sobrevive a F5 é discutível
 * (o operador pode preferir recomeçar do zero se a página recarregou no
 * meio de um atendimento). Fica só em memória.
 */

export interface ItemCarrinho {
  readonly varianteId: string;
  readonly codigoBarras: string;
  readonly sku: string;
  readonly nome: string;
  readonly tamanho: string | null;
  readonly cor: string | null;
  readonly precoCentavos: number;
  readonly quantidade: number;
}

interface EstadoCarrinho {
  readonly itens: readonly ItemCarrinho[];

  adicionar: (produto: ItemCatalogo, quantidade: number) => void;
  alterarQuantidade: (varianteId: string, quantidade: number) => void;
  removerUltimo: () => void;
  removerVariante: (varianteId: string) => void;
  limpar: () => void;
}

export const useCarrinho = create<EstadoCarrinho>()((set) => ({
  itens: [],

  adicionar: (produto, quantidade) =>
    set((estado) => {
      // Bipar o mesmo produto de novo soma na linha existente, não duplica
      // a linha — é o que o operador espera ao passar o mesmo item duas vezes.
      const existente = estado.itens.find((item) => item.varianteId === produto.id);
      if (existente) {
        return {
          itens: estado.itens.map((item) =>
            item.varianteId === produto.id
              ? { ...item, quantidade: item.quantidade + quantidade }
              : item,
          ),
        };
      }
      return {
        itens: [
          ...estado.itens,
          {
            varianteId: produto.id,
            codigoBarras: produto.codigoBarras,
            sku: produto.sku,
            nome: produto.nome,
            tamanho: produto.tamanho,
            cor: produto.cor,
            precoCentavos: produto.precoCentavos,
            quantidade,
          },
        ],
      };
    }),

  alterarQuantidade: (varianteId, quantidade) =>
    set((estado) => ({
      itens:
        quantidade <= 0
          ? estado.itens.filter((item) => item.varianteId !== varianteId)
          : estado.itens.map((item) => (item.varianteId === varianteId ? { ...item, quantidade } : item)),
    })),

  removerUltimo: () => set((estado) => ({ itens: estado.itens.slice(0, -1) })),

  removerVariante: (varianteId) =>
    set((estado) => ({ itens: estado.itens.filter((item) => item.varianteId !== varianteId) })),

  limpar: () => set({ itens: [] }),
}));

/** Total simples, só para exibição em tempo real — soma preço × quantidade. */
export function totalCarrinhoCentavos(itens: readonly ItemCarrinho[]): number {
  return itens.reduce((soma, item) => soma + item.precoCentavos * item.quantidade, 0);
}

export function totalDePecas(itens: readonly ItemCarrinho[]): number {
  return itens.reduce((soma, item) => soma + item.quantidade, 0);
}
