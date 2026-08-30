import { useMutation } from '@tanstack/react-query';
import { api } from './api.js';
import type { Operador } from '@/estado/useSessao.js';

interface RespostaLogin {
  readonly token: string;
  readonly operador: Operador;
}

async function autenticar(entrada: { login: string; senha: string }): Promise<RespostaLogin> {
  return api<RespostaLogin>('/sessao/login', { metodo: 'POST', corpo: entrada, semAutenticacao: true });
}

/**
 * Mutação de login. Não decide sozinha o que fazer com o resultado — quem
 * chama escolhe entre `entrar()` (troca a sessão ativa) ou só ler
 * `operador` (autorização de gerente por sobreposição, sem trocar a sessão).
 */
export function useAutenticar() {
  return useMutation({ mutationFn: autenticar });
}
