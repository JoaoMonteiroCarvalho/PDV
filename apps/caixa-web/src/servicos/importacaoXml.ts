import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export interface ItemPreviaImportacao {
  readonly codigoBarras: string | null;
  readonly descricao: string;
  readonly ncm: string | null;
  readonly quantidade: number;
  readonly custoUnitarioCentavos: number;
  readonly varianteExistenteId: string | null;
  readonly skuExistente: string | null;
  readonly nomeExistente: string | null;
}

export interface PreviaImportacao {
  readonly numeroNota: string | null;
  readonly itens: readonly ItemPreviaImportacao[];
}

/**
 * Lê o XML e casa por código de barras — NÃO grava nada. A nota nunca traz
 * preço de venda, então todo item novo precisa de revisão humana antes de
 * confirmar (ver `useConfirmarImportacaoXml`).
 */
export function usePreVisualizarImportacaoXml() {
  return useMutation({
    mutationFn: (xml: string) => api<PreviaImportacao>('/produtos/importar-xml', { metodo: 'POST', corpo: { xml } }),
  });
}

export interface ItemConfirmacaoImportacao {
  readonly codigoBarras?: string;
  readonly varianteId?: string;
  readonly produtoNovo?: {
    readonly nome: string;
    readonly sku: string;
    readonly precoCentavos: number;
  };
  readonly quantidade: number;
  readonly custoUnitarioCentavos: number;
}

export interface EntradaConfirmarImportacao {
  readonly numeroNota?: string;
  readonly itens: readonly ItemConfirmacaoImportacao[];
}

export function useConfirmarImportacaoXml() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaConfirmarImportacao) =>
      api<{ movimentosCriados: number }>('/produtos/confirmar-importacao-xml', {
        metodo: 'POST',
        corpo: entrada,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['produtos'] });
    },
  });
}
