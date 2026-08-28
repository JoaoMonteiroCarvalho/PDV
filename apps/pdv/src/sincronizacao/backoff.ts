/**
 * Retentativa com espera exponencial.
 *
 * Função pura e determinística (o acaso entra por injeção), para poder ser
 * testada sem relógio nem rede.
 */

export interface OpcoesBackoff {
  /** Espera da 1ª retentativa, em ms. */
  readonly baseMs: number;
  /** Teto: sem ele, 15 tentativas viram horas de espera. */
  readonly tetoMs: number;
  /** Fração de aleatoriedade (0.2 = ±20%). */
  readonly jitter: number;
}

export const BACKOFF_PADRAO: OpcoesBackoff = {
  baseMs: 2_000,
  tetoMs: 5 * 60_000,
  jitter: 0.2,
};

/**
 * Espera antes da próxima tentativa.
 *
 * O jitter não é enfeite: sem ele, várias vendas enfileiradas durante uma queda
 * de internet voltam a bater no servidor exatamente no mesmo milissegundo
 * quando a rede volta. Com um caixa só o efeito é pequeno, mas o custo de
 * incluir é zero e o sistema já nasce pronto para o segundo caixa.
 *
 * @param tentativa  quantas tentativas JÁ falharam (1 = primeira falha)
 * @param aleatorio  gerador em [0,1); injetável para o teste ser determinístico
 */
export function calcularEspera(
  tentativa: number,
  opcoes: OpcoesBackoff = BACKOFF_PADRAO,
  aleatorio: () => number = Math.random,
): number {
  if (!Number.isInteger(tentativa) || tentativa < 1) {
    throw new Error(`Número de tentativas deve ser inteiro >= 1, recebido ${tentativa}`);
  }

  const exponencial = opcoes.baseMs * 2 ** (tentativa - 1);
  const limitado = Math.min(exponencial, opcoes.tetoMs);

  // Jitter simétrico em torno do valor: [limitado*(1-j), limitado*(1+j)).
  const variacao = limitado * opcoes.jitter * (aleatorio() * 2 - 1);
  return Math.max(0, Math.round(limitado + variacao));
}

/**
 * Classifica a falha para decidir se retentar faz sentido.
 *
 * Esta é a decisão mais importante do módulo. Uma venda recusada por regra de
 * negócio (422) NUNCA vai passar numa retentativa — insistir para sempre só
 * esconde o problema. Mas ela também não pode ser descartada: a venda já foi
 * impressa e o dinheiro já entrou. Então vira pendência visível para o gerente.
 */
export type ClassificacaoFalha = 'TRANSITORIA' | 'PERMANENTE';

export function classificarFalha(status: number | null): ClassificacaoFalha {
  // Sem status = não houve resposta: offline, DNS, timeout. Sempre transitório.
  if (status === null) return 'TRANSITORIA';

  // 408 (timeout) e 429 (excesso de requisições) pedem para tentar de novo.
  if (status === 408 || status === 429) return 'TRANSITORIA';

  // 5xx é falha do servidor: pode ser passageira.
  if (status >= 500) return 'TRANSITORIA';

  // 401 é token expirado — o app renova a sessão e a venda volta para a fila.
  if (status === 401) return 'TRANSITORIA';

  // Demais 4xx: o servidor entendeu e recusou. Retentar é inútil.
  if (status >= 400) return 'PERMANENTE';

  return 'TRANSITORIA';
}
