import { describe, expect, it } from 'vitest';
import { centavos } from './dinheiro.js';
import {
  ErroDevolucao,
  calcularDevolucao,
  ehFormaEstornoValida,
  movimentoDeCaixaDaDevolucao,
  movimentosDeEstoqueDaDevolucao,
  validarAutorizacaoDevolucao,
  type ItemDisponivelParaDevolucao,
} from './devolucao.js';

function esperaCodigo(acao: () => unknown, codigo: string): void {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDevolucao);
    expect((erro as ErroDevolucao).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Esperava ErroDevolucao com código ${codigo}, mas nada foi lançado.`);
}

const ITEM_3_UNIDADES: ItemDisponivelParaDevolucao = {
  itemVendaId: 'iv1',
  varianteId: 'v1',
  quantidadeVendida: 3,
  quantidadeJaDevolvida: 0,
  precoUnitarioLiquidoCentavos: centavos(8990),
};

const ITEM_PARCIALMENTE_DEVOLVIDO: ItemDisponivelParaDevolucao = {
  itemVendaId: 'iv2',
  varianteId: 'v2',
  quantidadeVendida: 5,
  quantidadeJaDevolvida: 2,
  precoUnitarioLiquidoCentavos: centavos(5000),
};

describe('calcularDevolucao()', () => {
  it('devolve parcialmente 1 de 3 peças iguais', () => {
    const resultado = calcularDevolucao([ITEM_3_UNIDADES], [{ itemVendaId: 'iv1', quantidade: 1 }]);
    expect(resultado.itens).toHaveLength(1);
    expect(resultado.itens[0]!.valorCentavos).toBe(8990);
    expect(resultado.totalCentavos).toBe(8990);
  });

  it('devolve a quantidade total vendida', () => {
    const resultado = calcularDevolucao([ITEM_3_UNIDADES], [{ itemVendaId: 'iv1', quantidade: 3 }]);
    expect(resultado.totalCentavos).toBe(26_970);
  });

  it('considera o que já foi devolvido antes ao calcular o disponível', () => {
    // Vendido 5, já devolvido 2 -> disponível é 3.
    const resultado = calcularDevolucao(
      [ITEM_PARCIALMENTE_DEVOLVIDO],
      [{ itemVendaId: 'iv2', quantidade: 3 }],
    );
    expect(resultado.totalCentavos).toBe(15_000);
  });

  it('recusa devolver mais do que o disponível', () => {
    esperaCodigo(
      () => calcularDevolucao([ITEM_PARCIALMENTE_DEVOLVIDO], [{ itemVendaId: 'iv2', quantidade: 4 }]),
      'QUANTIDADE_MAIOR_QUE_DISPONIVEL',
    );
  });

  it('recusa devolver o que já foi todo devolvido antes', () => {
    const tudoDevolvido: ItemDisponivelParaDevolucao = {
      ...ITEM_3_UNIDADES,
      quantidadeJaDevolvida: 3,
    };
    esperaCodigo(
      () => calcularDevolucao([tudoDevolvido], [{ itemVendaId: 'iv1', quantidade: 1 }]),
      'QUANTIDADE_MAIOR_QUE_DISPONIVEL',
    );
  });

  it('devolve múltiplos itens de uma vez', () => {
    const resultado = calcularDevolucao(
      [ITEM_3_UNIDADES, ITEM_PARCIALMENTE_DEVOLVIDO],
      [
        { itemVendaId: 'iv1', quantidade: 2 },
        { itemVendaId: 'iv2', quantidade: 1 },
      ],
    );
    expect(resultado.totalCentavos).toBe(2 * 8990 + 5000);
  });

  it('recusa devolução sem itens', () => {
    esperaCodigo(() => calcularDevolucao([ITEM_3_UNIDADES], []), 'DEVOLUCAO_SEM_ITENS');
  });

  it('recusa item que não pertence à venda', () => {
    esperaCodigo(
      () => calcularDevolucao([ITEM_3_UNIDADES], [{ itemVendaId: 'inexistente', quantidade: 1 }]),
      'ITEM_INEXISTENTE',
    );
  });

  it('recusa quantidade fracionada ou não positiva', () => {
    esperaCodigo(
      () => calcularDevolucao([ITEM_3_UNIDADES], [{ itemVendaId: 'iv1', quantidade: 1.5 }]),
      'QUANTIDADE_INVALIDA',
    );
    esperaCodigo(
      () => calcularDevolucao([ITEM_3_UNIDADES], [{ itemVendaId: 'iv1', quantidade: 0 }]),
      'QUANTIDADE_INVALIDA',
    );
  });

  it('recusa o mesmo item repetido na mesma devolução — não soma silenciosamente', () => {
    esperaCodigo(
      () =>
        calcularDevolucao(
          [ITEM_3_UNIDADES],
          [
            { itemVendaId: 'iv1', quantidade: 1 },
            { itemVendaId: 'iv1', quantidade: 1 },
          ],
        ),
      'ITEM_DUPLICADO',
    );
  });

  it('o valor devolvido é proporcional ao preço já líquido de desconto', () => {
    // Um item que teve desconto tem precoUnitarioLiquidoCentavos menor que o
    // preço de tabela; devolver 1 unidade devolve esse valor líquido.
    const comDesconto: ItemDisponivelParaDevolucao = {
      itemVendaId: 'iv3',
      varianteId: 'v3',
      quantidadeVendida: 2,
      quantidadeJaDevolvida: 0,
      precoUnitarioLiquidoCentavos: centavos(4000), // preço de tabela era 5000, com desconto
    };
    const resultado = calcularDevolucao([comDesconto], [{ itemVendaId: 'iv3', quantidade: 1 }]);
    expect(resultado.totalCentavos).toBe(4000);
  });
});

describe('validarAutorizacaoDevolucao() — sem alçada de valor, igual sangria', () => {
  it('aceita com gerente identificado', () => {
    expect(() =>
      validarAutorizacaoDevolucao({ autorizadoPorId: 'g1', autorizadorEhGerente: true }),
    ).not.toThrow();
  });

  it('recusa sem autorizador, mesmo para devolução de valor pequeno', () => {
    esperaCodigo(
      () => validarAutorizacaoDevolucao({ autorizadorEhGerente: false }),
      'AUTORIZACAO_OBRIGATORIA',
    );
  });

  it('recusa quando o autorizador não é gerente', () => {
    esperaCodigo(
      () => validarAutorizacaoDevolucao({ autorizadoPorId: 'operador-1', autorizadorEhGerente: false }),
      'AUTORIZADOR_SEM_PERMISSAO',
    );
  });
});

describe('movimentosDeEstoqueDaDevolucao()', () => {
  it('devolve ao estoque com quantidade positiva', () => {
    const devolucao = calcularDevolucao([ITEM_3_UNIDADES], [{ itemVendaId: 'iv1', quantidade: 2 }]);
    const movimentos = movimentosDeEstoqueDaDevolucao(devolucao);
    expect(movimentos).toEqual([{ varianteId: 'v1', tipo: 'CANCELAMENTO_VENDA', quantidade: 2 }]);
  });
});

describe('movimentoDeCaixaDaDevolucao()', () => {
  it('dinheiro e PIX geram saída negativa da gaveta', () => {
    expect(movimentoDeCaixaDaDevolucao('DINHEIRO', centavos(5000))).toEqual({
      tipo: 'CANCELAMENTO',
      valorCentavos: -5000,
    });
    expect(movimentoDeCaixaDaDevolucao('PIX', centavos(5000))).toEqual({
      tipo: 'CANCELAMENTO',
      valorCentavos: -5000,
    });
  });

  it('cartão não gera movimento de caixa — a maquininha é separada', () => {
    expect(movimentoDeCaixaDaDevolucao('CARTAO', centavos(5000))).toBeNull();
  });

  it('vale-troca não mexe em caixa nenhum', () => {
    expect(movimentoDeCaixaDaDevolucao('VALE_TROCA', centavos(5000))).toBeNull();
  });
});

describe('ehFormaEstornoValida()', () => {
  it('aceita as quatro formas', () => {
    expect(ehFormaEstornoValida('DINHEIRO')).toBe(true);
    expect(ehFormaEstornoValida('PIX')).toBe(true);
    expect(ehFormaEstornoValida('CARTAO')).toBe(true);
    expect(ehFormaEstornoValida('VALE_TROCA')).toBe(true);
  });

  it('recusa valor desconhecido', () => {
    expect(ehFormaEstornoValida('BOLETO')).toBe(false);
    expect(ehFormaEstornoValida('')).toBe(false);
  });
});
