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

import { centavos, type VendaCalculada } from '@pdv/shared';
import { create } from 'zustand';
import type { AutorizacaoGerente } from '../api/cliente.js';
import type { ItemCatalogo } from '../banco/local.js';
import type { DadosComprovante } from '../impressao/comprovante.js';
import {
  CARRINHO_VAZIO,
  adicionar,
  alterarQuantidade,
  definirDescontoDoItem,
  definirDescontoDoTotal,
  remover,
  type EstadoCarrinho,
  type PagamentoLancado,
} from '../venda/carrinho.js';

/**
 * Tudo que a tela de comprovante precisa, capturado no instante em que a venda
 * fechou.
 *
 * Guardado inteiro de propósito, em vez de só o id: o comprovante tem que
 * poder ser mostrado e reimpresso mesmo com a venda ainda na fila, sem rede e
 * sem consultar o servidor. A venda já aconteceu.
 */
export interface VendaConcluida {
  readonly calculo: VendaCalculada;
  readonly dados: DadosComprovante;
}

interface EstadoLoja {
  carrinho: EstadoCarrinho;
  pagamentos: PagamentoLancado[];
  /** Última venda fechada, para a tela de comprovante. */
  ultimaVenda: VendaConcluida | null;
  /**
   * Liberação de gerente para o desconto desta venda, quando ele passou da
   * alçada da operadora.
   *
   * Vive no carrinho, não na tela do desconto, porque quem precisa dela é o
   * FECHAMENTO — que acontece vários passos depois, em outro componente. Morre
   * junto com a venda em `limparVenda`: autorização pendurada de uma venda
   * anterior liberaria um desconto que ninguém aprovou.
   */
  autorizacaoDesconto: AutorizacaoGerente | null;
  /**
   * Quem atendeu esta venda. `null` significa "a operadora logada".
   *
   * Vive no carrinho, e não numa preferência de tela, porque é por VENDA: a
   * próxima cliente pode ser atendida por outra pessoa, e herdar a escolha
   * anterior mandaria comissão para quem não vendeu.
   */
  vendedorId: string | null;

  adicionarItem: (item: ItemCatalogo, quantidade?: number) => void;
  mudarQuantidade: (varianteId: string, quantidade: number) => void;
  removerItem: (varianteId: string) => void;
  aplicarDescontoNoItem: (varianteId: string, descontoCentavos: number) => void;
  aplicarDescontoNoTotal: (descontoCentavos: number) => void;
  definirAutorizacaoDesconto: (autorizacao: AutorizacaoGerente | null) => void;
  definirVendedor: (vendedorId: string | null) => void;
  lancarPagamento: (pagamento: PagamentoLancado) => void;
  removerPagamento: (indice: number) => void;
  limparPagamentos: () => void;
  limparVenda: () => void;
  registrarSucesso: (venda: VendaConcluida) => void;
  descartarAviso: () => void;
}

export const useCarrinho = create<EstadoLoja>((set) => ({
  carrinho: CARRINHO_VAZIO,
  pagamentos: [],
  ultimaVenda: null,
  autorizacaoDesconto: null,
  vendedorId: null,

  adicionarItem: (item, quantidade = 1) =>
    set((estado) => ({
      carrinho: adicionar(
        estado.carrinho,
        {
          id: item.id,
          sku: item.sku,
          nome: item.nome,
          categoria: item.categoria,
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

  aplicarDescontoNoItem: (varianteId, descontoCentavos) =>
    set((estado) => ({
      carrinho: definirDescontoDoItem(estado.carrinho, varianteId, centavos(descontoCentavos)),
    })),

  aplicarDescontoNoTotal: (descontoCentavos) =>
    set((estado) => ({
      carrinho: definirDescontoDoTotal(estado.carrinho, centavos(descontoCentavos)),
    })),

  definirAutorizacaoDesconto: (autorizacao) => set({ autorizacaoDesconto: autorizacao }),

  definirVendedor: (vendedorId) => set({ vendedorId }),

  lancarPagamento: (pagamento) =>
    set((estado) => ({ pagamentos: [...estado.pagamentos, pagamento] })),

  removerPagamento: (indice) =>
    set((estado) => ({ pagamentos: estado.pagamentos.filter((_, i) => i !== indice) })),

  limparPagamentos: () => set({ pagamentos: [] }),

  // Zera tudo depois de finalizar ou cancelar. Os pagamentos vão junto: deixar
  // pagamento de uma venda anterior pendurado é como o dinheiro some do caixa.
  // A autorização de desconto também: ela valeu para aquela venda e só.
  // A vendedora volta ao padrão junto: a próxima cliente pode ser de outra
  // pessoa, e herdar a escolha mandaria comissão para quem não vendeu.
  limparVenda: () =>
    set({ carrinho: CARRINHO_VAZIO, pagamentos: [], autorizacaoDesconto: null, vendedorId: null }),

  registrarSucesso: (venda) => set({ ultimaVenda: venda }),
  descartarAviso: () => set({ ultimaVenda: null }),
}));
