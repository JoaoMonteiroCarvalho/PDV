/**
 * Dinheiro no PDV.
 *
 * REGRA INEGOCIÁVEL: valor monetário é SEMPRE inteiro em centavos.
 * Não existe float em nenhum ponto do caminho — nem no parse da entrada,
 * nem no cálculo, nem na formatação. A conversão para "R$" acontece
 * exclusivamente em `formatarBRL`, que é camada de exibição.
 *
 * O tipo `Centavos` é "branded": um `number` cru não é aceito onde se espera
 * dinheiro. Isso faz o compilador barrar o erro clássico de passar reais
 * (12.5) onde o código espera centavos (1250).
 */

declare const marcaCentavos: unique symbol;
declare const marcaBps: unique symbol;

/** Valor monetário inteiro, em centavos. Construa via `centavos()` ou `deReais()`. */
export type Centavos = number & { readonly [marcaCentavos]: true };

/** Percentual em pontos-base (bps). 1% = 100 bps. Inteiro, para não usar float. */
export type PontosBase = number & { readonly [marcaBps]: true };

export class ErroDinheiro extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDinheiro';
  }
}

/**
 * Fronteira de entrada: transforma um `number` cru em `Centavos`.
 * Use ao ler do banco (o Prisma devolve Int como number) ou de uma API já
 * validada. Rejeita qualquer coisa que não seja inteiro seguro.
 */
export function centavos(valor: number): Centavos {
  if (!Number.isFinite(valor)) {
    throw new ErroDinheiro(`Valor monetário não finito: ${valor}`);
  }
  if (!Number.isInteger(valor)) {
    throw new ErroDinheiro(
      `Valor monetário deve ser inteiro em centavos, recebido ${valor}. ` +
        `Se isso veio de reais, use deReais().`,
    );
  }
  if (!Number.isSafeInteger(valor)) {
    throw new ErroDinheiro(`Valor monetário fora do intervalo seguro: ${valor}`);
  }
  return valor as Centavos;
}

export const ZERO: Centavos = 0 as Centavos;

export function pontosBase(valor: number): PontosBase {
  if (!Number.isInteger(valor)) {
    throw new ErroDinheiro(`Percentual em bps deve ser inteiro, recebido ${valor}`);
  }
  if (valor < 0 || valor > 10_000) {
    throw new ErroDinheiro(`Percentual em bps fora do intervalo 0..10000: ${valor}`);
  }
  return valor as PontosBase;
}

/** Converte percentual digitado ("12,5" ou 12.5) para bps inteiro (1250). */
export function percentualParaBps(percentual: string | number): PontosBase {
  const texto = typeof percentual === 'number' ? String(percentual) : percentual;
  return pontosBase(Number(analisarDecimal(texto, 2)));
}

/**
 * Lê um valor digitado em reais e devolve centavos, sem passar por float.
 * Aceita "12", "12,5", "12,50", "1.234,56", "1234.56", " R$ 9,90 ".
 * Rejeita mais de 2 casas decimais — imprecisão de digitação deve estourar,
 * não ser silenciosamente arredondada.
 */
export function deReais(entrada: string): Centavos {
  return centavos(Number(analisarDecimal(entrada, 2)));
}

/**
 * Núcleo do parse: devolve o valor como string de inteiro na escala pedida.
 * Trabalha só com strings; nenhum float é criado no processo.
 */
function analisarDecimal(entrada: string, casas: number): string {
  let texto = entrada.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (texto === '') throw new ErroDinheiro('Valor monetário vazio');

  let negativo = false;
  if (texto.startsWith('-')) {
    negativo = true;
    texto = texto.slice(1);
  } else if (texto.startsWith('+')) {
    texto = texto.slice(1);
  }

  // Descobre qual caractere é o separador decimal.
  // "1.234,56" -> vírgula decimal | "1234.56" -> ponto decimal | "1.234" -> milhar.
  const ultimaVirgula = texto.lastIndexOf(',');
  const ultimoPonto = texto.lastIndexOf('.');
  let separador = -1;
  if (ultimaVirgula >= 0 && ultimaVirgula > ultimoPonto) {
    separador = ultimaVirgula;
  } else if (ultimoPonto >= 0 && ultimaVirgula < 0) {
    // Sem vírgula: ponto só é decimal se não sobrar exatamente 3 dígitos depois
    // dele (senão é separador de milhar, como em "1.234").
    const digitosDepois = texto.length - ultimoPonto - 1;
    if (digitosDepois !== 3) separador = ultimoPonto;
  }

  let inteiro: string;
  let decimal: string;
  if (separador >= 0) {
    inteiro = texto.slice(0, separador);
    decimal = texto.slice(separador + 1);
  } else {
    inteiro = texto;
    decimal = '';
  }

  inteiro = inteiro.replace(/[.,]/g, '');
  if (inteiro === '') inteiro = '0';

  if (!/^\d+$/.test(inteiro) || !/^\d*$/.test(decimal)) {
    throw new ErroDinheiro(`Valor monetário inválido: "${entrada}"`);
  }
  if (decimal.length > casas) {
    throw new ErroDinheiro(
      `Valor "${entrada}" tem ${decimal.length} casas decimais; o máximo é ${casas}.`,
    );
  }

  const escalado = inteiro + decimal.padEnd(casas, '0');
  const semZerosAEsquerda = escalado.replace(/^0+(?=\d)/, '');
  return (negativo ? '-' : '') + semZerosAEsquerda;
}

/**
 * Formatação para exibição. ÚNICO lugar do sistema que produz "R$".
 * Monta a string dígito a dígito — nunca divide por 100 em float.
 */
export function formatarBRL(valor: Centavos, opcoes: { simbolo?: boolean } = {}): string {
  const simbolo = opcoes.simbolo ?? true;
  const negativo = valor < 0;
  const digitos = String(Math.abs(valor)).padStart(3, '0');
  const parteInteira = digitos.slice(0, -2);
  const parteDecimal = digitos.slice(-2);
  const comMilhar = parteInteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefixo = simbolo ? 'R$ ' : '';
  const corpo = prefixo + comMilhar + ',' + parteDecimal;
  return negativo ? '-' + corpo : corpo;
}

export function somar(...valores: Centavos[]): Centavos {
  return centavos(valores.reduce<number>((total, valor) => total + valor, 0));
}

export function subtrair(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b);
}

export function negar(valor: Centavos): Centavos {
  return centavos(-valor);
}

/** Multiplica um preço unitário por uma quantidade inteira de itens. */
export function multiplicar(preco: Centavos, quantidade: number): Centavos {
  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw new ErroDinheiro(`Quantidade deve ser inteiro não negativo, recebido ${quantidade}`);
  }
  return centavos(preco * quantidade);
}

/**
 * Divisão com arredondamento comercial (meio para cima, afastando do zero),
 * feita só com inteiros. É o arredondamento que o varejo brasileiro espera.
 */
function dividirArredondando(numerador: number, denominador: number): number {
  if (denominador === 0) throw new ErroDinheiro('Divisão por zero em cálculo monetário');
  const sinal = numerador < 0 !== denominador < 0 ? -1 : 1;
  const n = Math.abs(numerador);
  const d = Math.abs(denominador);
  return sinal * Math.floor((n * 2 + d) / (2 * d));
}

/** Aplica percentual em bps: `aplicarPercentual(1000, 1050)` = 10,50% de R$ 10,00 = 105. */
export function aplicarPercentual(valor: Centavos, bps: PontosBase): Centavos {
  return centavos(dividirArredondando(valor * bps, 10_000));
}

/**
 * Reparte um valor em N partes sem perder nem criar centavo.
 * A soma das partes é SEMPRE igual ao total. O resto vai para as primeiras
 * parcelas — convenção do varejo (a primeira parcela é a "quebrada").
 * Usado no crediário e no rateio de desconto entre itens.
 */
export function ratear(total: Centavos, partes: number): Centavos[] {
  if (!Number.isInteger(partes) || partes <= 0) {
    throw new ErroDinheiro(`Número de partes deve ser inteiro positivo, recebido ${partes}`);
  }
  const sinal = total < 0 ? -1 : 1;
  const absoluto = Math.abs(total);
  const base = Math.floor(absoluto / partes);
  const resto = absoluto - base * partes;
  return Array.from({ length: partes }, (_, indice) =>
    centavos(sinal * (base + (indice < resto ? 1 : 0))),
  );
}

/**
 * Rateia um valor proporcionalmente a uma lista de pesos, preservando o total.
 * Usado para distribuir o desconto do total entre os itens da venda, de modo
 * que a soma dos itens continue batendo exatamente com o total pago.
 * Método do maior resto: quem tem a maior fração perdida recebe o centavo.
 */
export function ratearProporcional(total: Centavos, pesos: readonly number[]): Centavos[] {
  if (pesos.length === 0) throw new ErroDinheiro('Rateio proporcional sem pesos');
  const somaPesos = pesos.reduce((acumulado, peso) => acumulado + peso, 0);
  if (somaPesos <= 0) return ratear(total, pesos.length);

  const absoluto = Math.abs(total);
  const partes = pesos.map((peso) => Math.floor((absoluto * peso) / somaPesos));
  let distribuido = partes.reduce((acumulado, valor) => acumulado + valor, 0);

  const porMaiorResto = pesos
    .map((peso, indice) => ({
      indice,
      resto: absoluto * peso - partes[indice]! * somaPesos,
    }))
    .sort((a, b) => b.resto - a.resto || a.indice - b.indice);

  let cursor = 0;
  while (distribuido < absoluto) {
    const alvo = porMaiorResto[cursor % porMaiorResto.length]!;
    partes[alvo.indice] = partes[alvo.indice]! + 1;
    distribuido += 1;
    cursor += 1;
  }

  const sinal = total < 0 ? -1 : 1;
  return partes.map((valor) => centavos(sinal * valor));
}

export function maximo(a: Centavos, b: Centavos): Centavos {
  return a > b ? a : b;
}

export function minimo(a: Centavos, b: Centavos): Centavos {
  return a < b ? a : b;
}
