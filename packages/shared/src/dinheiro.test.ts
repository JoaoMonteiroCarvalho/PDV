import { describe, expect, it } from 'vitest';
import {
  aplicarPercentual,
  centavos,
  deReais,
  ErroDinheiro,
  formatarBRL,
  multiplicar,
  percentualParaBps,
  pontosBase,
  ratear,
  ratearProporcional,
  somar,
  subtrair,
} from './dinheiro.js';

describe('centavos()', () => {
  it('aceita inteiro', () => {
    expect(centavos(1250)).toBe(1250);
    expect(centavos(0)).toBe(0);
    expect(centavos(-500)).toBe(-500);
  });

  it('recusa float — este é o bug que o tipo existe para impedir', () => {
    expect(() => centavos(12.5)).toThrow(ErroDinheiro);
    expect(() => centavos(0.1 + 0.2)).toThrow(ErroDinheiro);
  });

  it('recusa NaN, Infinity e inteiro fora do intervalo seguro', () => {
    expect(() => centavos(Number.NaN)).toThrow(ErroDinheiro);
    expect(() => centavos(Number.POSITIVE_INFINITY)).toThrow(ErroDinheiro);
    expect(() => centavos(Number.MAX_SAFE_INTEGER + 2)).toThrow(ErroDinheiro);
  });
});

describe('deReais()', () => {
  it('lê os formatos que o operador realmente digita', () => {
    expect(deReais('12')).toBe(1200);
    expect(deReais('12,5')).toBe(1250);
    expect(deReais('12,50')).toBe(1250);
    expect(deReais('0,99')).toBe(99);
    expect(deReais('0,05')).toBe(5);
    expect(deReais(' R$ 9,90 ')).toBe(990);
  });

  it('entende ponto como separador de milhar no formato brasileiro', () => {
    expect(deReais('1.234,56')).toBe(123456);
    expect(deReais('1.234')).toBe(123400);
    expect(deReais('10.000,00')).toBe(1000000);
  });

  it('entende ponto como decimal quando não há vírgula (teclado numérico)', () => {
    expect(deReais('1234.56')).toBe(123456);
    expect(deReais('12.5')).toBe(1250);
  });

  it('não perde precisão onde o float perderia', () => {
    // 0.1 + 0.2 === 0.30000000000000004 em float. Aqui não.
    expect(somar(deReais('0,10'), deReais('0,20'))).toBe(30);
    expect(deReais('8,70')).toBe(870);
    expect(deReais('1105,53')).toBe(110553);
  });

  it('recusa entrada ambígua em vez de arredondar escondido', () => {
    expect(() => deReais('12,567')).toThrow(/casas decimais/);
    expect(() => deReais('abc')).toThrow(ErroDinheiro);
    expect(() => deReais('')).toThrow(ErroDinheiro);
  });

  it('aceita valor negativo (devolução, estorno)', () => {
    expect(deReais('-12,50')).toBe(-1250);
  });
});

describe('formatarBRL()', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatarBRL(centavos(1250))).toBe('R$ 12,50');
    expect(formatarBRL(centavos(5))).toBe('R$ 0,05');
    expect(formatarBRL(centavos(0))).toBe('R$ 0,00');
    expect(formatarBRL(centavos(100))).toBe('R$ 1,00');
    expect(formatarBRL(centavos(123456))).toBe('R$ 1.234,56');
    expect(formatarBRL(centavos(100000000))).toBe('R$ 1.000.000,00');
  });

  it('põe o sinal antes do símbolo', () => {
    expect(formatarBRL(centavos(-1250))).toBe('-R$ 12,50');
  });

  it('omite o símbolo quando pedido (campos de input)', () => {
    expect(formatarBRL(centavos(1250), { simbolo: false })).toBe('12,50');
  });

  it('faz ida e volta com deReais sem perder valor', () => {
    for (const valor of [0, 1, 99, 100, 999, 1250, 123456, 99999999]) {
      expect(deReais(formatarBRL(centavos(valor), { simbolo: false }))).toBe(valor);
    }
  });
});

describe('aritmética', () => {
  it('soma, subtrai e multiplica mantendo inteiro', () => {
    expect(somar(centavos(1250), centavos(990), centavos(5))).toBe(2245);
    expect(subtrair(centavos(1250), centavos(990))).toBe(260);
    expect(multiplicar(centavos(1990), 3)).toBe(5970);
    expect(multiplicar(centavos(1990), 0)).toBe(0);
  });

  it('recusa quantidade fracionada — esta loja vende por unidade', () => {
    expect(() => multiplicar(centavos(1990), 1.5)).toThrow(ErroDinheiro);
    expect(() => multiplicar(centavos(1990), -1)).toThrow(ErroDinheiro);
  });
});

describe('aplicarPercentual()', () => {
  it('aplica percentual em bps com arredondamento comercial', () => {
    expect(aplicarPercentual(centavos(1000), pontosBase(1000))).toBe(100); // 10% de 10,00
    expect(aplicarPercentual(centavos(1000), pontosBase(1050))).toBe(105); // 10,5%
    expect(aplicarPercentual(centavos(9990), pontosBase(1500))).toBe(1499); // 15% de 99,90 = 1498,5
  });

  it('arredonda meio para cima, como o varejo espera', () => {
    expect(aplicarPercentual(centavos(101), pontosBase(5000))).toBe(51); // 50,5 -> 51
  });

  it('converte percentual digitado para bps', () => {
    expect(percentualParaBps('12,5')).toBe(1250);
    expect(percentualParaBps(10)).toBe(1000);
    expect(() => percentualParaBps('150')).toThrow(ErroDinheiro); // > 100%
  });
});

describe('ratear() — parcelas do crediário', () => {
  it('divide sem perder centavo', () => {
    expect(ratear(centavos(10000), 3)).toEqual([3334, 3333, 3333]);
    expect(ratear(centavos(10000), 4)).toEqual([2500, 2500, 2500, 2500]);
    expect(ratear(centavos(1), 3)).toEqual([1, 0, 0]);
  });

  it('a soma das parcelas é SEMPRE igual ao total', () => {
    for (let total = 0; total <= 2000; total += 7) {
      for (let partes = 1; partes <= 12; partes += 1) {
        const parcelas = ratear(centavos(total), partes);
        expect(parcelas.reduce<number>((a, b) => a + b, 0)).toBe(total);
        expect(parcelas).toHaveLength(partes);
      }
    }
  });

  it('funciona com valor negativo (devolução parcelada)', () => {
    expect(ratear(centavos(-10000), 3)).toEqual([-3334, -3333, -3333]);
  });

  it('recusa número de partes inválido', () => {
    expect(() => ratear(centavos(1000), 0)).toThrow(ErroDinheiro);
    expect(() => ratear(centavos(1000), 2.5)).toThrow(ErroDinheiro);
  });
});

describe('ratearProporcional() — desconto no total distribuído entre itens', () => {
  it('distribui proporcionalmente aos pesos', () => {
    expect(ratearProporcional(centavos(1000), [1, 1])).toEqual([500, 500]);
    expect(ratearProporcional(centavos(1000), [3, 1])).toEqual([750, 250]);
  });

  it('dá o centavo sobrando a quem tem o maior resto', () => {
    // 10,00 de desconto sobre itens de 33,33 / 33,33 / 33,34
    const rateio = ratearProporcional(centavos(1000), [3333, 3333, 3334]);
    expect(rateio.reduce<number>((a, b) => a + b, 0)).toBe(1000);
    expect(rateio).toEqual([333, 333, 334]);
  });

  it('a soma do rateio é SEMPRE igual ao total, para qualquer combinação', () => {
    const combinacoes: number[][] = [
      [1],
      [1, 2, 3],
      [9990, 4990, 12990],
      [1, 1, 1, 1, 1, 1, 1],
      [100, 1, 1],
      [7, 11, 13, 17],
    ];
    for (const pesos of combinacoes) {
      for (let total = 0; total <= 500; total += 3) {
        const rateio = ratearProporcional(centavos(total), pesos);
        expect(rateio.reduce<number>((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('cai para divisão igual quando todos os pesos são zero', () => {
    expect(ratearProporcional(centavos(1000), [0, 0])).toEqual([500, 500]);
  });
});
