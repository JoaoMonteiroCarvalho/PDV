import { QueryClient } from '@tanstack/react-query';

/**
 * Cliente único do TanStack Query.
 *
 * `refetchOnWindowFocus: false` — um PDV não é uma dashboard que o operador
 * alterna de aba o dia todo; refetch automático ao trocar de janela só
 * gastaria rede sem necessidade real. Dados que precisam estar sempre frescos
 * (catálogo, sessão de caixa) invalidam explicitamente após cada mutação.
 */
export const clienteQuery = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});
