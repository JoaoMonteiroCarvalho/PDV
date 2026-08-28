/**
 * Autenticação do operador.
 *
 * Existe porque a auditoria é inegociável: sangria, cancelamento e desconto
 * acima da alçada precisam registrar QUEM fez. Sem identidade confiável, o
 * registro de auditoria é decoração.
 *
 * Hash de senha com scrypt do `node:crypto` — deliberadamente sem dependência
 * nativa (argon2/bcrypt exigem compilação, o que é atrito num PC de loja).
 * scrypt é resistente a hardware dedicado e faz parte da biblioteca padrão.
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * `promisify` perde a sobrecarga do scrypt que aceita opções de custo, então
 * o wrapper é explícito — preferível a um cast que desligaria a checagem.
 */
function derivarChave(
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
): Promise<Buffer> {
  // O scrypt do Node limita a memoria em 32 MB por padrao, e o custo abaixo
  // precisa de exatamente 128*N*r bytes. Sem folga explicita, N=32768 e r=8
  // estoura o teto por um fio e o hash falha em tempo de execucao.
  const memoriaNecessaria = 128 * Number(opcoes.N) * Number(opcoes.r);
  const opcoesComMemoria: ScryptOptions = { ...opcoes, maxmem: memoriaNecessaria * 2 };

  return new Promise((resolver, rejeitar) => {
    scrypt(senha, sal, tamanho, opcoesComMemoria, (erro, chave) => {
      if (erro) rejeitar(erro);
      else resolver(chave);
    });
  });
}

/** Parâmetros de custo. N=2^15 leva ~100ms num PC de loja — caro para atacar, imperceptível no login. */
const CUSTO_N = 32_768;
const TAMANHO_BLOCO = 8;
const PARALELISMO = 1;
const TAMANHO_CHAVE = 32;
const TAMANHO_SAL = 16;

/** Formato: scrypt$N$r$p$sal$hash — o próprio hash carrega seus parâmetros. */
export async function gerarHashSenha(senha: string): Promise<string> {
  if (senha.length < 4) {
    throw new Error('Senha do operador precisa de ao menos 4 caracteres.');
  }
  const sal = randomBytes(TAMANHO_SAL);
  const derivada = await derivarChave(senha, sal, TAMANHO_CHAVE, {
    N: CUSTO_N,
    r: TAMANHO_BLOCO,
    p: PARALELISMO,
  });

  return [
    'scrypt',
    CUSTO_N,
    TAMANHO_BLOCO,
    PARALELISMO,
    sal.toString('base64'),
    derivada.toString('base64'),
  ].join('$');
}

/**
 * Compara em tempo constante. Nunca use `===` aqui: a diferença de tempo entre
 * um hash que erra no primeiro byte e um que erra no último vaza informação.
 */
export async function verificarSenha(senha: string, hashArmazenado: string): Promise<boolean> {
  const partes = hashArmazenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const [, custoN, bloco, paralelismo, salBase64, hashBase64] = partes;
  const sal = Buffer.from(salBase64!, 'base64');
  const esperado = Buffer.from(hashBase64!, 'base64');

  const derivada = await derivarChave(senha, sal, esperado.length, {
    N: Number(custoN),
    r: Number(bloco),
    p: Number(paralelismo),
  });

  return derivada.length === esperado.length && timingSafeEqual(derivada, esperado);
}

/** Conteúdo do token. Fica pequeno de propósito: o resto se consulta no banco. */
export interface TokenOperador {
  readonly sub: string;
  readonly nome: string;
  readonly papel: 'OPERADOR' | 'GERENTE' | 'ADMIN';
}
