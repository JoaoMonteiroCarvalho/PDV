import { useSessao } from '@/estado/useSessao.js';

const BASE = '/api';

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

interface OpcoesRequisicao {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  corpo?: unknown;
  /** Chamadas de login não têm token ainda — todas as outras têm. */
  semAutenticacao?: boolean;
  /**
   * Sem isto, uma conexão que trava (não erra, só nunca responde) prende o
   * `await` para sempre. Pouco importa numa chamada que o operador está
   * olhando e pode cancelar clicando em outro lugar — mas o motor de
   * sincronização (banco-local/motorSincronizacao.ts) roda sozinho, sem
   * ninguém olhando, e uma trava presa ali para a fila inteira até a
   * página ser recarregada. Todo chamador de fundo deve informar isto.
   */
  timeoutMs?: number;
}

/**
 * Requisição tipada à API real.
 *
 * Lança `ErroApi` em qualquer resposta não-2xx, com o código de domínio que
 * o backend manda (`{ codigo, mensagem }`) — é isso que cada tela usa para
 * decidir a mensagem exata a mostrar, nunca "erro genérico".
 */
export async function api<T>(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
  const { metodo = 'GET', corpo, semAutenticacao = false, timeoutMs } = opcoes;

  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!semAutenticacao) {
    const token = useSessao.getState().token;
    if (token) cabecalhos.Authorization = `Bearer ${token}`;
  }

  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo !== undefined ? JSON.stringify(corpo) : null,
    signal: timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : null,
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new ErroApi(
      resposta.status,
      (dados as { codigo?: string }).codigo ?? 'ERRO_DESCONHECIDO',
      (dados as { mensagem?: string }).mensagem ?? `Erro HTTP ${resposta.status}`,
    );
  }

  return dados as T;
}
