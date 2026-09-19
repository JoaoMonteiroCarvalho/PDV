/**
 * Desconto: a ponte entre o que a operadora digita e o que o domínio aceita.
 *
 * O domínio só conhece desconto em CENTAVOS. Mas no balcão se fala em
 * porcentagem ("faz 10% pra ela"), e converter à mão na calculadora do celular
 * é como nasce divergência entre o que foi combinado e o que foi cobrado.
 *
 * Nenhuma conta aqui cria float. O percentual digitado vira PONTOS-BASE
 * inteiros ainda no parse — nunca `Number("10,5")` — e o desconto sai de
 * multiplicação e divisão inteiras. É a mesma disciplina de `dinheiro.ts`, pelo
 * mesmo motivo: 0,1 + 0,2 não é 0,3, e num sistema de dinheiro isso vira
 * centavo perdido que ninguém consegue explicar no fechamento.
 */

import { type Centavos, type PontosBase, centavos, pontosBase } from '@pdv/shared';

/** Como a operadora está informando o desconto. */
export type ModoDesconto = 'VALOR' | 'PERCENTUAL';

/** 100% em pontos-base. Desconto maior que o item inteiro não existe. */
export const MAXIMO_BPS = 10_000;

/**
 * Lê o percentual digitado e devolve pontos-base inteiros.
 *
 * Aceita vírgula ou ponto e no máximo duas casas — `10`, `10,5` e `10.55` viram
 * 1000, 1050 e 1055. Devolve `null` para qualquer coisa que não seja um
 * percentual utilizável, e é o chamador que decide o que dizer à operadora.
 *
 * O parse é feito sobre a STRING, dígito a dígito. `Math.round(10.55 * 100)`
 * funcionaria hoje e falharia em algum valor que ninguém testou.
 */
export function percentualParaBps(texto: string): PontosBase | null {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpo)) return null;

  const [inteiro = '0', decimal = ''] = limpo.split('.');
  // Duas casas sempre: "5" → "00", "5" → "50", "55" → "55".
  const centesimos = decimal.padEnd(2, '0');
  const bps = Number(inteiro) * 100 + Number(centesimos);

  if (bps > MAXIMO_BPS) return null;
  return pontosBase(bps);
}

/** Pontos-base como a operadora lê: 1050 → "10,5%". */
export function formatarPercentual(bps: PontosBase): string {
  const inteiro = Math.floor(bps / 100);
  const centesimos = bps % 100;
  if (centesimos === 0) return `${inteiro}%`;
  // Sem zero à direita: "10,5%" e não "10,50%".
  const fracao = centesimos % 10 === 0 ? String(centesimos / 10) : String(centesimos).padStart(2, '0');
  return `${inteiro},${fracao}%`;
}

/**
 * Quanto vale, em centavos, um percentual sobre uma base.
 *
 * Arredonda para baixo: entre cobrar um centavo a mais e conceder um a mais, o
 * erro que se aceita é o que favorece a cliente — é ela quem está olhando o
 * visor.
 */
export function descontoPorPercentual(baseCentavos: Centavos, bps: PontosBase): Centavos {
  if (baseCentavos <= 0 || bps <= 0) return centavos(0);
  return centavos(Math.min(baseCentavos, Math.floor((baseCentavos * bps) / MAXIMO_BPS)));
}

/**
 * O desconto cabe na alçada de quem está operando?
 *
 * Espelha `validarAlcadaDesconto` do `@pdv/shared`, que é quem de fato decide
 * no servidor. Aqui a pergunta é feita em forma de booleano porque a tela
 * precisa DECIDIR se mostra o campo da gerente — e não pode fazer isso
 * capturando uma exceção a cada tecla digitada.
 */
export function exigeAutorizacao(descontoBps: PontosBase, limiteOperadorBps: PontosBase): boolean {
  return descontoBps > limiteOperadorBps;
}
