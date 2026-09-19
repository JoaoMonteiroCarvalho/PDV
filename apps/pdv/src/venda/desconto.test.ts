import { describe, expect, it } from 'vitest';
import { centavos, pontosBase } from '@pdv/shared';
import {
  descontoPorPercentual,
  exigeAutorizacao,
  formatarPercentual,
  percentualParaBps,
} from './desconto.js';

describe('percentualParaBps', () => {
  it('lê inteiro, uma casa e duas casas', () => {
    expect(percentualParaBps('10')).toBe(1000);
    expect(percentualParaBps('10,5')).toBe(1050);
    expect(percentualParaBps('10.55')).toBe(1055);
  });

  it('trata vírgula e ponto como o mesmo separador', () => {
    expect(percentualParaBps('7,25')).toBe(percentualParaBps('7.25'));
  });

  it('recusa o que não é percentual utilizável', () => {
    expect(percentualParaBps('')).toBeNull();
    expect(percentualParaBps('abc')).toBeNull();
    expect(percentualParaBps('-5')).toBeNull();
    expect(percentualParaBps('10,555')).toBeNull();
  });

  it('recusa acima de 100%', () => {
    expect(percentualParaBps('100')).toBe(10_000);
    expect(percentualParaBps('100,01')).toBeNull();
  });

  it('não cria float em valor que quebraria a multiplicação direta', () => {
    // Math.round(10.55 * 100) é 1055 por sorte; 8,29 é o caso em que a
    // multiplicação float chega a 828.9999999999999.
    expect(percentualParaBps('8,29')).toBe(829);
  });
});

describe('formatarPercentual', () => {
  it('omite a fração quando ela é zero', () => {
    expect(formatarPercentual(pontosBase(1000))).toBe('10%');
  });

  it('mostra uma casa quando basta', () => {
    expect(formatarPercentual(pontosBase(1050))).toBe('10,5%');
  });

  it('mostra duas casas quando precisa', () => {
    expect(formatarPercentual(pontosBase(1055))).toBe('10,55%');
  });
});

describe('descontoPorPercentual', () => {
  it('calcula sobre a base em centavos', () => {
    expect(descontoPorPercentual(centavos(10_000), pontosBase(1000))).toBe(1_000);
  });

  it('arredonda para baixo — o centavo da dúvida fica com a cliente', () => {
    // 10% de R$ 9,99 = 99,9 centavos.
    expect(descontoPorPercentual(centavos(999), pontosBase(1000))).toBe(99);
  });

  it('nunca passa da base, nem a 100%', () => {
    expect(descontoPorPercentual(centavos(5_000), pontosBase(10_000))).toBe(5_000);
  });

  it('devolve zero para base ou percentual não positivos', () => {
    expect(descontoPorPercentual(centavos(0), pontosBase(1000))).toBe(0);
    expect(descontoPorPercentual(centavos(10_000), pontosBase(0))).toBe(0);
  });
});

describe('exigeAutorizacao', () => {
  it('não exige quando o desconto cabe na alçada', () => {
    expect(exigeAutorizacao(pontosBase(500), pontosBase(500))).toBe(false);
  });

  it('exige assim que passa do limite', () => {
    expect(exigeAutorizacao(pontosBase(501), pontosBase(500))).toBe(true);
  });

  it('exige qualquer desconto de quem tem alçada zero', () => {
    expect(exigeAutorizacao(pontosBase(1), pontosBase(0))).toBe(true);
  });
});
