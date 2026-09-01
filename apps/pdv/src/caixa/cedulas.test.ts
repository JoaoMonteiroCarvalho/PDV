import { describe, expect, it } from 'vitest';
import {
  DENOMINACOES,
  classificarDivergencia,
  contagemVazia,
  somarContagem,
  totalDePecas,
} from './cedulas.js';

describe('DENOMINACOES', () => {
  it('vem da maior para a menor, como a operadora empilha', () => {
    const valores = DENOMINACOES.map((d) => d.valorCentavos);
    expect([...valores].sort((a, b) => b - a)).toEqual(valores);
  });

  it('inclui a nota de R$ 200, por rara que seja', () => {
    // Sem linha para ela, a operadora joga o valor em outra e a conferência
    // por cédula perde o sentido.
    expect(valores()).toContain(20_000);
  });

  it('não tem moeda de 1 centavo, que só atrasaria a contagem', () => {
    expect(valores()).not.toContain(1);
  });

  it('todo valor é inteiro em centavos', () => {
    for (const denominacao of DENOMINACOES) {
      expect(Number.isInteger(denominacao.valorCentavos)).toBe(true);
    }
  });

  function valores() {
    return DENOMINACOES.map((d) => d.valorCentavos);
  }
});

describe('somarContagem()', () => {
  it('multiplica cada denominação pela quantidade', () => {
    // 2 notas de 50 + 3 de 10 + 4 moedas de 25 = 100 + 30 + 1 = R$ 131,00
    expect(somarContagem({ 5_000: 2, 1_000: 3, 25: 4 })).toBe(13_100);
  });

  it('gaveta vazia é zero, não NaN', () => {
    expect(somarContagem({})).toBe(0);
  });

  it('ignora lixo em vez de lançar no meio da digitação', () => {
    /*
     * Este total aparece ao vivo enquanto a operadora digita. Uma exceção aqui
     * apagaria a tela de conferência inteira por causa de um caractere.
     */
    expect(somarContagem({ 5_000: Number.NaN, 1_000: 2 })).toBe(2_000);
    expect(somarContagem({ 5_000: -3, 1_000: 2 })).toBe(2_000);
    expect(somarContagem({ 5_000: 1.5, 1_000: 2 })).toBe(2_000);
  });

  it('ignora denominação que não existe na lista', () => {
    // Um valor de 3 centavos não é dinheiro brasileiro; somá-lo produziria um
    // total que a gaveta não pode ter.
    expect(somarContagem({ 3: 100, 1_000: 1 })).toBe(1_000);
  });

  it('gaveta cheia continua inteiro exato', () => {
    const total = somarContagem({ 20_000: 50, 10_000: 100, 5: 999 });
    expect(total).toBe(50 * 20_000 + 100 * 10_000 + 999 * 5);
    expect(Number.isSafeInteger(total)).toBe(true);
  });
});

describe('totalDePecas() e contagemVazia()', () => {
  it('conta quantas cédulas e moedas foram lançadas', () => {
    expect(totalDePecas({ 5_000: 2, 25: 4 })).toBe(6);
  });

  it('reconhece contagem vazia, inclusive com zeros digitados', () => {
    expect(contagemVazia({})).toBe(true);
    expect(contagemVazia({ 5_000: 0, 1_000: 0 })).toBe(true);
    expect(contagemVazia({ 5_000: 1 })).toBe(false);
  });
});

describe('classificarDivergencia()', () => {
  it('bate exato é "confere"', () => {
    expect(classificarDivergencia(0)).toEqual({ tipo: 'confere', valorAbsolutoCentavos: 0 });
  });

  it('mais na gaveta do que o esperado é sobra', () => {
    expect(classificarDivergencia(1_500)).toEqual({ tipo: 'sobra', valorAbsolutoCentavos: 1_500 });
  });

  it('menos na gaveta é falta, com valor positivo', () => {
    /*
     * No balcão ninguém pensa em "diferença de -1500", pensa em "faltou
     * quinze reais". E as duas coisas têm peso diferente: falta levanta
     * suspeita, sobra costuma ser troco que não saiu.
     */
    expect(classificarDivergencia(-1_500)).toEqual({ tipo: 'falta', valorAbsolutoCentavos: 1_500 });
  });
});
