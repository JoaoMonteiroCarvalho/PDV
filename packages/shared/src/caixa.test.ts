import { describe, expect, it } from 'vitest';
import { centavos } from './dinheiro.js';
import {
  ErroCaixa,
  calcularFechamento,
  sinalDoMovimentoManual,
  validarAbertura,
  validarMovimentoManual,
} from './caixa.js';

function esperaCodigo(acao: () => unknown, codigo: string): void {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroCaixa);
    expect((erro as ErroCaixa).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Esperava ErroCaixa com código ${codigo}, mas nada foi lançado.`);
}

describe('validarAbertura()', () => {
  it('aceita fundo de troco zero ou positivo', () => {
    expect(() => validarAbertura(centavos(0))).not.toThrow();
    expect(() => validarAbertura(centavos(20_000))).not.toThrow();
  });

  it('recusa fundo de troco negativo', () => {
    esperaCodigo(() => validarAbertura(centavos(-100)), 'FUNDO_TROCO_NEGATIVO');
  });
});

describe('validarMovimentoManual() — sangria e suprimento', () => {
  it('aceita quando há gerente identificado', () => {
    expect(() =>
      validarMovimentoManual('SANGRIA', centavos(5000), {
        autorizadoPorId: 'gerente-1',
        autorizadorEhGerente: true,
      }),
    ).not.toThrow();
  });

  it('recusa valor não positivo', () => {
    esperaCodigo(
      () =>
        validarMovimentoManual('SANGRIA', centavos(0), {
          autorizadoPorId: 'g1',
          autorizadorEhGerente: true,
        }),
      'VALOR_INVALIDO',
    );
    esperaCodigo(
      () =>
        validarMovimentoManual('SUPRIMENTO', centavos(-100), {
          autorizadoPorId: 'g1',
          autorizadorEhGerente: true,
        }),
      'VALOR_INVALIDO',
    );
  });

  it('recusa sem autorizador — ao contrário do desconto, não existe alçada aqui', () => {
    esperaCodigo(
      () => validarMovimentoManual('SANGRIA', centavos(5000), { autorizadorEhGerente: false }),
      'AUTORIZACAO_OBRIGATORIA',
    );
  });

  it('recusa quando o autorizador não é gerente', () => {
    esperaCodigo(
      () =>
        validarMovimentoManual('SUPRIMENTO', centavos(5000), {
          autorizadoPorId: 'operador-1',
          autorizadorEhGerente: false,
        }),
      'AUTORIZADOR_SEM_PERMISSAO',
    );
  });

  it('mesma regra vale para valor pequeno — não existe piso de isenção', () => {
    esperaCodigo(
      () => validarMovimentoManual('SANGRIA', centavos(1), { autorizadorEhGerente: false }),
      'AUTORIZACAO_OBRIGATORIA',
    );
  });
});

describe('sinalDoMovimentoManual()', () => {
  it('sangria é negativa, suprimento é positivo', () => {
    expect(sinalDoMovimentoManual('SANGRIA', centavos(5000))).toBe(-5000);
    expect(sinalDoMovimentoManual('SUPRIMENTO', centavos(5000))).toBe(5000);
  });
});

describe('calcularFechamento()', () => {
  it('sem divergência quando o valor contado bate com o esperado', () => {
    const resultado = calcularFechamento(
      { fundoTrocoCentavos: centavos(20_000), outrosMovimentosCentavos: centavos(50_000) },
      centavos(70_000),
    );
    expect(resultado.valorEsperadoCentavos).toBe(70_000);
    expect(resultado.diferencaCentavos).toBe(0);
    expect(resultado.temDivergencia).toBe(false);
  });

  it('detecta sobra na gaveta', () => {
    const resultado = calcularFechamento(
      { fundoTrocoCentavos: centavos(20_000), outrosMovimentosCentavos: centavos(50_000) },
      centavos(72_000),
    );
    expect(resultado.diferencaCentavos).toBe(2000);
    expect(resultado.temDivergencia).toBe(true);
  });

  it('detecta falta na gaveta', () => {
    const resultado = calcularFechamento(
      { fundoTrocoCentavos: centavos(20_000), outrosMovimentosCentavos: centavos(50_000) },
      centavos(65_000),
    );
    expect(resultado.diferencaCentavos).toBe(-5000);
    expect(resultado.temDivergencia).toBe(true);
  });

  it('não bloqueia o fechamento mesmo com divergência grande', () => {
    // O caixa físico precisa fechar de qualquer jeito; a rota é quem decide
    // registrar auditoria, a função de domínio nunca lança aqui.
    expect(() =>
      calcularFechamento(
        { fundoTrocoCentavos: centavos(0), outrosMovimentosCentavos: centavos(0) },
        centavos(1_000_000),
      ),
    ).not.toThrow();
  });

  it('considera sangria (negativa) e suprimento (positiva) no esperado', () => {
    const resultado = calcularFechamento(
      {
        fundoTrocoCentavos: centavos(20_000),
        outrosMovimentosCentavos: centavos(50_000 - 15_000 + 5_000), // vendas - sangria + suprimento
      },
      centavos(60_000),
    );
    expect(resultado.valorEsperadoCentavos).toBe(60_000);
    expect(resultado.temDivergencia).toBe(false);
  });

  it('recusa valor contado negativo', () => {
    esperaCodigo(
      () =>
        calcularFechamento(
          { fundoTrocoCentavos: centavos(0), outrosMovimentosCentavos: centavos(0) },
          centavos(-1),
        ),
      'VALOR_CONTADO_NEGATIVO',
    );
  });
});
