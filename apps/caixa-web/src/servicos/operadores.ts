import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export type Papel = 'OPERADOR' | 'GERENTE' | 'ADMIN';

export interface OperadorListado {
  readonly id: string;
  readonly nome: string;
  readonly login: string;
  readonly papel: Papel;
  readonly limiteDescontoBps: number;
  readonly ativo: boolean;
}

export function useOperadores(todos: boolean) {
  return useQuery({
    queryKey: ['operadores', todos],
    queryFn: () => api<{ operadores: readonly OperadorListado[] }>(`/operadores?todos=${todos}`),
  });
}

export interface EntradaCriarOperador {
  readonly nome: string;
  readonly login: string;
  readonly senha: string;
  readonly papel: Papel;
  readonly limiteDescontoBps: number;
}

export function useCriarOperador() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaCriarOperador) => api<{ id: string }>('/operadores', { metodo: 'POST', corpo: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operadores'] });
    },
  });
}

export interface EntradaAtualizarOperador {
  readonly nome?: string;
  readonly papel?: Papel;
  readonly limiteDescontoBps?: number;
  readonly ativo?: boolean;
  readonly novaSenha?: string;
}

export function useAtualizarOperador(operadorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaAtualizarOperador) =>
      api<{ id: string }>(`/operadores/${operadorId}`, { metodo: 'PATCH', corpo: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operadores'] });
    },
  });
}
