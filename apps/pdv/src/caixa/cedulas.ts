/**
 * Contagem da gaveta por cédula e moeda.
 *
 * Existe porque ninguém confere caixa somando de cabeça. A operadora empilha
 * as notas por valor, conta quantas são de cada, e o sistema multiplica. Pedir
 * só o total obrigaria a fazer a conta antes de digitar — e é exatamente aí
 * que aparece o erro de R$ 100 que vira "divergência" no relatório e uma
 * conversa desagradável no dia seguinte.
 *
 * A contagem detalhada é OPCIONAL: quem prefere digitar o total direto pode.
 * O que não pode é o sistema exigir aritmética mental de quem está com as
 * mãos ocupadas de dinheiro.
 *
 * Tudo em centavos, inteiro, como o resto do sistema.
 */

export interface Denominacao {
  /** Valor unitário em centavos. */
  readonly valorCentavos: number;
  readonly rotulo: string;
  readonly tipo: 'cedula' | 'moeda';
}

/**
 * Papel-moeda e moedas em circulação no Brasil.
 *
 * A nota de R$ 200 está na lista mesmo sendo rara: se aparecer uma na gaveta e
 * não houver linha para ela, a operadora joga o valor em outra linha e a
 * conferência por cédula perde o sentido.
 *
 * Moedas de 1 centavo ficam de fora — saíram de circulação prática e uma
 * linha que nunca é preenchida só atrasa a contagem.
 */
export const DENOMINACOES: readonly Denominacao[] = [
  { valorCentavos: 20_000, rotulo: 'R$ 200', tipo: 'cedula' },
  { valorCentavos: 10_000, rotulo: 'R$ 100', tipo: 'cedula' },
  { valorCentavos: 5_000, rotulo: 'R$ 50', tipo: 'cedula' },
  { valorCentavos: 2_000, rotulo: 'R$ 20', tipo: 'cedula' },
  { valorCentavos: 1_000, rotulo: 'R$ 10', tipo: 'cedula' },
  { valorCentavos: 500, rotulo: 'R$ 5', tipo: 'cedula' },
  { valorCentavos: 200, rotulo: 'R$ 2', tipo: 'cedula' },
  { valorCentavos: 100, rotulo: 'R$ 1', tipo: 'moeda' },
  { valorCentavos: 50, rotulo: '50 centavos', tipo: 'moeda' },
  { valorCentavos: 25, rotulo: '25 centavos', tipo: 'moeda' },
  { valorCentavos: 10, rotulo: '10 centavos', tipo: 'moeda' },
  { valorCentavos: 5, rotulo: '5 centavos', tipo: 'moeda' },
];

/** Quantidade contada por denominação, indexada pelo valor unitário. */
export type ContagemPorDenominacao = Readonly<Record<number, number>>;

/**
 * Soma a contagem detalhada.
 *
 * Ignora quantidade negativa, fracionária ou não numérica em vez de lançar:
 * este total aparece ao vivo enquanto a operadora digita, e uma exceção no
 * meio da digitação apagaria a tela de conferência inteira.
 */
export function somarContagem(contagem: ContagemPorDenominacao): number {
  let total = 0;
  for (const denominacao of DENOMINACOES) {
    const quantidade = contagem[denominacao.valorCentavos];
    if (typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade <= 0) continue;
    total += denominacao.valorCentavos * quantidade;
  }
  return total;
}

/** Quantas cédulas/moedas foram contadas ao todo — serve de conferência grosseira. */
export function totalDePecas(contagem: ContagemPorDenominacao): number {
  let pecas = 0;
  for (const denominacao of DENOMINACOES) {
    const quantidade = contagem[denominacao.valorCentavos];
    if (typeof quantidade === 'number' && Number.isInteger(quantidade) && quantidade > 0) {
      pecas += quantidade;
    }
  }
  return pecas;
}

export function contagemVazia(contagem: ContagemPorDenominacao): boolean {
  return totalDePecas(contagem) === 0;
}

// ---------------------------------------------------------------------------
// Divergência
// ---------------------------------------------------------------------------

export type TipoDivergencia = 'confere' | 'sobra' | 'falta';

export interface Divergencia {
  readonly tipo: TipoDivergencia;
  /** Sempre positivo — o sinal está em `tipo`. */
  readonly valorAbsolutoCentavos: number;
}

/**
 * Classifica a diferença entre contado e esperado.
 *
 * "Sobra" e "falta" em vez de sinal matemático: no balcão ninguém pensa em
 * "diferença de -1500", pensa em "faltou quinze reais". E as duas têm
 * significados diferentes — falta levanta suspeita, sobra costuma ser troco
 * que não saiu.
 */
export function classificarDivergencia(diferencaCentavos: number): Divergencia {
  if (diferencaCentavos === 0) return { tipo: 'confere', valorAbsolutoCentavos: 0 };
  return {
    tipo: diferencaCentavos > 0 ? 'sobra' : 'falta',
    valorAbsolutoCentavos: Math.abs(diferencaCentavos),
  };
}
