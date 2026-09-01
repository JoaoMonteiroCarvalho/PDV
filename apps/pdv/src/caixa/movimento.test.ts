import { describe, expect, it } from 'vitest';
import {
  efeitoNoSaldo,
  ehPapelAutorizador,
  impedimentosDoMovimento,
  podeRegistrar,
  type DadosMovimento,
} from './movimento.js';

function dados(parcial: Partial<DadosMovimento> = {}): DadosMovimento {
  return {
    tipo: 'SANGRIA',
    valorCentavos: 10_000,
    observacao: 'Levado ao cofre',
    saldoEsperadoCentavos: 50_000,
    gerenteAutenticada: true,
    ...parcial,
  };
}

describe('impedimentosDoMovimento()', () => {
  it('movimento completo e autorizado não tem impedimento', () => {
    expect(impedimentosDoMovimento(dados())).toEqual([]);
    expect(podeRegistrar(dados())).toBe(true);
  });

  it('sem gerente identificada, nada passa — nem valor pequeno', () => {
    /*
     * Sangria e suprimento não têm alçada de operador, ao contrário do
     * desconto. Mexer na gaveta fora do fluxo de venda é o ponto clássico de
     * fraude interna, e uma exceção "só para valor baixo" seria a brecha.
     */
    const bloqueios = impedimentosDoMovimento(dados({ gerenteAutenticada: false, valorCentavos: 100 }));
    expect(bloqueios).toContain(
      'Sangria e suprimento exigem gerente identificada, sem exceção de valor.',
    );
  });

  it('valor zero ou negativo não passa', () => {
    expect(impedimentosDoMovimento(dados({ valorCentavos: 0 }))).toContain(
      'Informe um valor maior que zero.',
    );
    expect(podeRegistrar(dados({ valorCentavos: -500 }))).toBe(false);
  });

  it('devolve TODOS os impedimentos de uma vez', () => {
    // A operadora corrige tudo junto em vez de descobrir um erro por tentativa.
    const bloqueios = impedimentosDoMovimento(
      dados({ valorCentavos: 0, observacao: '', gerenteAutenticada: false }),
    );
    expect(bloqueios.length).toBe(3);
  });
});

describe('justificativa da sangria', () => {
  it('sangria sem justificativa não passa', () => {
    expect(impedimentosDoMovimento(dados({ observacao: '' }))[0]).toMatch(/para onde o dinheiro foi/);
  });

  it('justificativa curta demais é tecla apertada, não justificativa', () => {
    expect(podeRegistrar(dados({ observacao: 'ok' }))).toBe(false);
    expect(podeRegistrar(dados({ observacao: '    ' }))).toBe(false);
  });

  it('suprimento NÃO exige justificativa', () => {
    // Dinheiro entrando na gaveta não tem o risco de desvio que a saída tem.
    expect(podeRegistrar(dados({ tipo: 'SUPRIMENTO', observacao: '' }))).toBe(true);
  });
});

describe('teto da sangria', () => {
  it('não deixa tirar mais do que a gaveta tem', () => {
    // Deixaria o saldo esperado negativo, e o fechamento acusaria uma "sobra"
    // que é só erro de digitação.
    expect(
      impedimentosDoMovimento(dados({ valorCentavos: 60_000, saldoEsperadoCentavos: 50_000 })),
    ).toContain('A sangria é maior do que o dinheiro que a gaveta tem.');
  });

  it('tirar exatamente tudo é permitido', () => {
    expect(podeRegistrar(dados({ valorCentavos: 50_000, saldoEsperadoCentavos: 50_000 }))).toBe(true);
  });

  it('saldo desconhecido não bloqueia por teto', () => {
    /*
     * Antes de a gerente entrar, o saldo vem nulo de propósito: conferir aqui
     * vazaria o número para a operadora e desfaria a conferência às cegas do
     * fechamento. O impedimento que sobra é a falta de gerente.
     */
    const bloqueios = impedimentosDoMovimento(
      dados({ valorCentavos: 999_999, saldoEsperadoCentavos: null, gerenteAutenticada: false }),
    );
    expect(bloqueios).not.toContain('A sangria é maior do que o dinheiro que a gaveta tem.');
  });

  it('suprimento não tem teto', () => {
    expect(
      podeRegistrar(dados({ tipo: 'SUPRIMENTO', valorCentavos: 999_999, saldoEsperadoCentavos: 100 })),
    ).toBe(true);
  });
});

describe('ehPapelAutorizador()', () => {
  it('gerente e admin autorizam', () => {
    expect(ehPapelAutorizador('GERENTE')).toBe(true);
    expect(ehPapelAutorizador('ADMIN')).toBe(true);
  });

  it('operador não autoriza, nem o próprio movimento', () => {
    expect(ehPapelAutorizador('OPERADOR')).toBe(false);
    expect(ehPapelAutorizador('')).toBe(false);
  });
});

describe('efeitoNoSaldo()', () => {
  it('sangria tira, suprimento põe', () => {
    expect(efeitoNoSaldo('SANGRIA', 10_000)).toBe(-10_000);
    expect(efeitoNoSaldo('SUPRIMENTO', 10_000)).toBe(10_000);
  });
});
