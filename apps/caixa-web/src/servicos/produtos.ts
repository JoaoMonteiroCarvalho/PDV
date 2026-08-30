import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export interface VarianteListada {
  readonly id: string;
  readonly sku: string;
  readonly codigoBarras: string | null;
  readonly tamanho: string | null;
  readonly cor: string | null;
  readonly precoCentavos: number;
  readonly custoCentavos: number;
  readonly ativo: boolean;
  readonly saldoEstoque: number;
}

export interface ProdutoListado {
  readonly id: string;
  readonly nome: string;
  readonly descricao: string | null;
  readonly marca: string | null;
  readonly ativo: boolean;
  readonly categoria: string | null;
  readonly variantes: readonly VarianteListada[];
}

interface ListaProdutos {
  readonly itens: readonly ProdutoListado[];
  readonly proximoCursor: string | null;
}

export interface FiltroProdutos {
  readonly busca?: string;
  readonly cursor?: string;
}

/** Catálogo de produtos — estado do SERVIDOR, sempre via TanStack Query. */
export function useProdutos(filtro: FiltroProdutos) {
  return useQuery({
    queryKey: ['produtos', filtro.busca ?? '', filtro.cursor ?? null],
    queryFn: () => {
      const parametros = new URLSearchParams();
      if (filtro.busca) parametros.set('busca', filtro.busca);
      if (filtro.cursor) parametros.set('cursor', filtro.cursor);
      const query = parametros.toString();
      return api<ListaProdutos>(`/produtos${query ? `?${query}` : ''}`);
    },
  });
}

export interface EntradaCriarProduto {
  readonly nome: string;
  readonly descricao?: string;
  readonly marca?: string;
}

export function useCriarProduto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaCriarProduto) => api<{ id: string }>('/produtos', { metodo: 'POST', corpo: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['produtos'] });
    },
  });
}

export interface EntradaCriarVariante {
  readonly sku: string;
  readonly codigoBarras?: string;
  readonly tamanho?: string;
  readonly cor?: string;
  readonly precoCentavos: number;
  readonly custoCentavos?: number;
}

export function useCriarVariante(produtoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaCriarVariante) =>
      api<{ id: string }>(`/produtos/${produtoId}/variantes`, { metodo: 'POST', corpo: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['produtos'] });
    },
  });
}
