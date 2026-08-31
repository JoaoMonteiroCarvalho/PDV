/**
 * Decide se a cena 3D deve carregar.
 *
 * Duas condições independentes, e as duas precisam passar:
 *
 *   1. O computador CONSEGUE (WebGL disponível). Mini-PC de loja com driver
 *      antigo ou máquina virtual às vezes não tem — e nesse caso a tela
 *      mostra o palco estático, nunca um erro.
 *   2. A operadora QUER. Existe um interruptor em Configurações: quem prefere
 *      velocidade a estética desliga o 3D do sistema inteiro.
 *
 * A checagem de WebGL cria um canvas descartável uma única vez e guarda o
 * resultado — repetir isso a cada render custaria caro à toa.
 */

const CHAVE_PREFERENCIA = 'pdv.efeitos3d';

let webglSuportadoCache: boolean | null = null;

/**
 * Testa WebGL criando um contexto descartável.
 *
 * Envolvido em try/catch porque alguns navegadores LANÇAM em vez de devolver
 * null quando o WebGL está bloqueado por política — e uma exceção aqui
 * derrubaria a tela de login inteira.
 */
export function webglDisponivel(): boolean {
  if (webglSuportadoCache !== null) return webglSuportadoCache;

  try {
    const canvas = document.createElement('canvas');
    const contexto =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    webglSuportadoCache = contexto !== null;
  } catch {
    webglSuportadoCache = false;
  }
  return webglSuportadoCache;
}

/** Preferência manual. Ligado por padrão; desligar é escolha consciente. */
export function efeitos3dLigados(): boolean {
  try {
    return localStorage.getItem(CHAVE_PREFERENCIA) !== 'off';
  } catch {
    return true;
  }
}

export function definirEfeitos3d(ligados: boolean): void {
  try {
    localStorage.setItem(CHAVE_PREFERENCIA, ligados ? 'on' : 'off');
  } catch {
    // Sem persistência a escolha vale só para esta sessão — aceitável.
  }
}

/**
 * Também respeita quem pediu menos movimento no sistema operacional. Aqui
 * seguir o SO é correto: é preferência de acessibilidade declarada pela
 * pessoa, diferente do tema escuro, que vinha por acidente.
 */
export function preferereduzirMovimento(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function podeRenderizar3d(): boolean {
  return efeitos3dLigados() && webglDisponivel();
}

/** Exposto só para teste: limpa o cache da detecção. */
export function limparCacheWebgl(): void {
  webglSuportadoCache = null;
}
