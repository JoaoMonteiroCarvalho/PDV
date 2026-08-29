import { describe, expect, it } from 'vitest';
import { centavos } from './dinheiro.js';
import { calcularRelatorio, type VendaParaRelatorio } from './relatorio.js';

function venda(sobrescrever: Partial<VendaParaRelatorio> = {}): VendaParaRelatorio {
  return {
    registradaEm: new Date('2026-08-10T14:00:00.000Z'),
    totalCentavos: centavos(8990),
    operador: { id: 'op-1', nome: 'Ana' },
    itens: [
      {
        varianteId: 'var-1',
        descricao: 'Conjunto Renda',
        sku: 'CJ-REN-M',
        quantidade: 1,
        totalCentavos: centavos(8990),
      },
    ],
    pagamentos: [{ forma: 'DINHEIRO', valorCentavos: centavos(8990), trocoCentavos: centavos(0) }],
    cancelamentos: [],
    ...sobrescrever,
  };
}

describe('calcularRelatorio — período vazio', () => {
  it('não quebra e devolve tudo zerado', () => {
    const relatorio = calcularRelatorio([]);
    expect(relatorio.quantidadeVendas).toBe(0);
    expect(relatorio.totalVendidoCentavos).toBe(0);
    expect(relatorio.totalDevolvidoCentavos).toBe(0);
    expect(relatorio.totalLiquidoCentavos).toBe(0);
    expect(relatorio.ticketMedioCentavos).toBe(0);
    expect(relatorio.totalItensVendidos).toBe(0);
    expect(relatorio.porDia).toEqual([]);
    expect(relatorio.porFormaPagamento).toEqual([]);
    expect(relatorio.porOperador).toEqual([]);
    expect(relatorio.produtosMaisVendidos).toEqual([]);
  });
});

describe('totais', () => {
  it('soma o total vendido e conta as vendas', () => {
    const relatorio = calcularRelatorio([
      venda({ totalCentavos: centavos(10000) }),
      venda({ totalCentavos: centavos(5000) }),
      venda({ totalCentavos: centavos(2500) }),
    ]);
    expect(relatorio.quantidadeVendas).toBe(3);
    expect(relatorio.totalVendidoCentavos).toBe(17500);
  });

  it('soma itens vendidos entre vendas com quantidades diferentes', () => {
    const relatorio = calcularRelatorio([
      venda({ itens: [{ varianteId: 'v1', descricao: 'A', sku: 'A', quantidade: 3, totalCentavos: centavos(300) }] }),
      venda({ itens: [{ varianteId: 'v2', descricao: 'B', sku: 'B', quantidade: 2, totalCentavos: centavos(200) }] }),
    ]);
    expect(relatorio.totalItensVendidos).toBe(5);
  });

  /**
   * A garantia central deste módulo: ticket médio nunca usa divisão de
   * float. R$ 100,00 dividido por 3 vendas não pode virar 33,333...
   * — usa `ratear`, que preserva o total exato entre as partes.
   */
  it('calcula ticket médio sem erro de ponto flutuante', () => {
    const relatorio = calcularRelatorio([
      venda({ totalCentavos: centavos(3334) }),
      venda({ totalCentavos: centavos(3333) }),
      venda({ totalCentavos: centavos(3333) }),
    ]);
    // total 10000 / 3 vendas -> primeira parte do rateio: 3334.
    expect(relatorio.ticketMedioCentavos).toBe(3334);
  });

  it('ticket médio de uma única venda é o próprio total', () => {
    const relatorio = calcularRelatorio([venda({ totalCentavos: centavos(12345) })]);
    expect(relatorio.ticketMedioCentavos).toBe(12345);
  });
});

describe('devoluções', () => {
  it('soma o devolvido e calcula o líquido sem alterar o total vendido', () => {
    const relatorio = calcularRelatorio([
      venda({
        totalCentavos: centavos(10000),
        cancelamentos: [{ formaEstorno: 'DINHEIRO', valorCentavos: centavos(3000) }],
      }),
      venda({ totalCentavos: centavos(5000) }),
    ]);
    expect(relatorio.totalVendidoCentavos).toBe(15000);
    expect(relatorio.totalDevolvidoCentavos).toBe(3000);
    expect(relatorio.totalLiquidoCentavos).toBe(12000);
    expect(relatorio.quantidadeDevolucoes).toBe(1);
  });

  it('uma venda pode ter várias devoluções ao longo do tempo', () => {
    const relatorio = calcularRelatorio([
      venda({
        totalCentavos: centavos(10000),
        cancelamentos: [
          { formaEstorno: 'DINHEIRO', valorCentavos: centavos(2000) },
          { formaEstorno: 'PIX', valorCentavos: centavos(1000) },
        ],
      }),
    ]);
    expect(relatorio.totalDevolvidoCentavos).toBe(3000);
    expect(relatorio.quantidadeDevolucoes).toBe(2);
  });

  it('agrupa devolução por forma de estorno', () => {
    const relatorio = calcularRelatorio([
      venda({ cancelamentos: [{ formaEstorno: 'DINHEIRO', valorCentavos: centavos(1000) }] }),
      venda({ cancelamentos: [{ formaEstorno: 'DINHEIRO', valorCentavos: centavos(500) }] }),
      venda({ cancelamentos: [{ formaEstorno: 'VALE_TROCA', valorCentavos: centavos(2000) }] }),
    ]);
    expect(relatorio.devolucoesPorFormaEstorno).toEqual([
      { formaEstorno: 'VALE_TROCA', quantidade: 1, valorCentavos: 2000 },
      { formaEstorno: 'DINHEIRO', quantidade: 2, valorCentavos: 1500 },
    ]);
  });

  it('nunca deixa o total líquido negativo aparecer sem explicação — reflete exatamente vendido menos devolvido', () => {
    // Situação de borda: tudo que foi vendido no período foi devolvido.
    const relatorio = calcularRelatorio([
      venda({ totalCentavos: centavos(5000), cancelamentos: [{ formaEstorno: 'DINHEIRO', valorCentavos: centavos(5000) }] }),
    ]);
    expect(relatorio.totalLiquidoCentavos).toBe(0);
  });
});

describe('agrupamento por dia', () => {
  it('agrupa vendas do mesmo dia e ordena cronologicamente', () => {
    const relatorio = calcularRelatorio([
      venda({ registradaEm: new Date('2026-08-12T09:00:00.000Z'), totalCentavos: centavos(1000) }),
      venda({ registradaEm: new Date('2026-08-10T09:00:00.000Z'), totalCentavos: centavos(2000) }),
      venda({ registradaEm: new Date('2026-08-10T20:00:00.000Z'), totalCentavos: centavos(3000) }),
    ]);
    expect(relatorio.porDia).toEqual([
      { data: '2026-08-10', quantidadeVendas: 2, totalCentavos: 5000 },
      { data: '2026-08-12', quantidadeVendas: 1, totalCentavos: 1000 },
    ]);
  });
});

describe('por forma de pagamento', () => {
  it('agrupa e ordena do maior para o menor total', () => {
    const relatorio = calcularRelatorio([
      venda({ pagamentos: [{ forma: 'DINHEIRO', valorCentavos: centavos(1000), trocoCentavos: centavos(0) }] }),
      venda({ pagamentos: [{ forma: 'PIX', valorCentavos: centavos(5000), trocoCentavos: centavos(0) }] }),
      venda({ pagamentos: [{ forma: 'PIX', valorCentavos: centavos(2000), trocoCentavos: centavos(0) }] }),
    ]);
    expect(relatorio.porFormaPagamento).toEqual([
      { forma: 'PIX', quantidade: 2, totalCentavos: 7000 },
      { forma: 'DINHEIRO', quantidade: 1, totalCentavos: 1000 },
    ]);
  });

  it('venda com pagamento dividido em duas formas conta em cada uma', () => {
    const relatorio = calcularRelatorio([
      venda({
        totalCentavos: centavos(10000),
        pagamentos: [
          { forma: 'DINHEIRO', valorCentavos: centavos(4000), trocoCentavos: centavos(0) },
          { forma: 'PIX', valorCentavos: centavos(6000), trocoCentavos: centavos(0) },
        ],
      }),
    ]);
    expect(relatorio.porFormaPagamento).toContainEqual({ forma: 'DINHEIRO', quantidade: 1, totalCentavos: 4000 });
    expect(relatorio.porFormaPagamento).toContainEqual({ forma: 'PIX', quantidade: 1, totalCentavos: 6000 });
  });

  /**
   * Regressão: a primeira versão deste relatório somava o valor BRUTO
   * recebido em dinheiro, sem descontar o troco. Um pagamento de R$ 100,00
   * com troco de R$ 10,10 numa venda de R$ 89,90 aparecia como "Dinheiro:
   * R$ 100,00" — mais do que a própria venda valeu. A soma de todas as
   * formas precisa bater com `totalVendidoCentavos`, sempre.
   */
  it('desconta o troco do dinheiro — não soma o valor bruto recebido', () => {
    const relatorio = calcularRelatorio([
      venda({
        totalCentavos: centavos(8990),
        pagamentos: [{ forma: 'DINHEIRO', valorCentavos: centavos(10000), trocoCentavos: centavos(1010) }],
      }),
    ]);
    expect(relatorio.porFormaPagamento).toEqual([{ forma: 'DINHEIRO', quantidade: 1, totalCentavos: 8990 }]);
  });

  it('a soma de todas as formas bate com o total vendido, mesmo com troco em uma delas', () => {
    const relatorio = calcularRelatorio([
      venda({
        totalCentavos: centavos(15000),
        pagamentos: [
          { forma: 'DINHEIRO', valorCentavos: centavos(10000), trocoCentavos: centavos(2000) }, // líquido 8000
          { forma: 'PIX', valorCentavos: centavos(7000), trocoCentavos: centavos(0) },
        ],
      }),
    ]);
    const somaDasFormas = relatorio.porFormaPagamento.reduce((soma, f) => soma + f.totalCentavos, 0);
    expect(somaDasFormas).toBe(relatorio.totalVendidoCentavos);
    expect(somaDasFormas).toBe(15000);
  });
});

describe('por operador', () => {
  it('agrupa por operador com ticket médio próprio', () => {
    const relatorio = calcularRelatorio([
      venda({ operador: { id: 'op-1', nome: 'Ana' }, totalCentavos: centavos(10000) }),
      venda({ operador: { id: 'op-1', nome: 'Ana' }, totalCentavos: centavos(20000) }),
      venda({ operador: { id: 'op-2', nome: 'Carla' }, totalCentavos: centavos(9000) }),
    ]);
    expect(relatorio.porOperador).toEqual([
      { operadorId: 'op-1', nome: 'Ana', quantidadeVendas: 2, totalCentavos: 30000, ticketMedioCentavos: 15000 },
      { operadorId: 'op-2', nome: 'Carla', quantidadeVendas: 1, totalCentavos: 9000, ticketMedioCentavos: 9000 },
    ]);
  });
});

describe('produtos mais vendidos', () => {
  it('ordena por quantidade vendida, não por valor', () => {
    const relatorio = calcularRelatorio([
      venda({
        itens: [
          { varianteId: 'caro', descricao: 'Body Renda', sku: 'BOD', quantidade: 1, totalCentavos: centavos(20000) },
          { varianteId: 'barato', descricao: 'Calcinha', sku: 'CAL', quantidade: 5, totalCentavos: centavos(5000) },
        ],
      }),
    ]);
    expect(relatorio.produtosMaisVendidos[0]).toMatchObject({ varianteId: 'barato', quantidadeVendida: 5 });
    expect(relatorio.produtosMaisVendidos[1]).toMatchObject({ varianteId: 'caro', quantidadeVendida: 1 });
  });

  it('soma a mesma variante vendida em vendas diferentes', () => {
    const item = { varianteId: 'v1', descricao: 'Calcinha', sku: 'CAL', quantidade: 2, totalCentavos: centavos(2000) };
    const relatorio = calcularRelatorio([venda({ itens: [item] }), venda({ itens: [item] })]);
    expect(relatorio.produtosMaisVendidos).toEqual([
      { varianteId: 'v1', descricao: 'Calcinha', sku: 'CAL', quantidadeVendida: 4, totalCentavos: 4000 },
    ]);
  });

  it('corta em 10 produtos, mesmo com mais variantes vendidas', () => {
    const itens = Array.from({ length: 15 }, (_, i) => ({
      varianteId: `v${i}`,
      descricao: `Produto ${i}`,
      sku: `SKU${i}`,
      quantidade: 15 - i, // decrescente, para a ordem ficar previsível
      totalCentavos: centavos(1000),
    }));
    const relatorio = calcularRelatorio([venda({ itens })]);
    expect(relatorio.produtosMaisVendidos).toHaveLength(10);
    expect(relatorio.produtosMaisVendidos[0]!.varianteId).toBe('v0');
  });
});

/**
 * CRITÉRIO DE ACEITE: um mês inteiro de operação, com venda, pagamento
 * dividido, devolução parcial e vários operadores — tudo precisa bater.
 */
describe('cenário realista de um período', () => {
  it('agrega um mês de vendas de moda íntima corretamente em todas as dimensões', () => {
    const vendas: VendaParaRelatorio[] = [
      venda({
        registradaEm: new Date('2026-08-01T13:00:00.000Z'),
        operador: { id: 'ana', nome: 'Ana Souza' },
        totalCentavos: centavos(8990),
        itens: [{ varianteId: 'conjunto', descricao: 'Conjunto Renda', sku: 'CJ-REN', quantidade: 1, totalCentavos: centavos(8990) }],
        pagamentos: [{ forma: 'PIX', valorCentavos: centavos(8990), trocoCentavos: centavos(0) }],
      }),
      venda({
        registradaEm: new Date('2026-08-01T15:00:00.000Z'),
        operador: { id: 'ana', nome: 'Ana Souza' },
        totalCentavos: centavos(15000),
        itens: [
          { varianteId: 'calcinha', descricao: 'Calcinha Cotton', sku: 'CAL-COT', quantidade: 3, totalCentavos: centavos(6000) },
          { varianteId: 'sutia', descricao: 'Sutiã Renda', sku: 'SUT-REN', quantidade: 1, totalCentavos: centavos(9000) },
        ],
        pagamentos: [
          { forma: 'DINHEIRO', valorCentavos: centavos(10000), trocoCentavos: centavos(0) },
          { forma: 'PIX', valorCentavos: centavos(5000), trocoCentavos: centavos(0) },
        ],
        cancelamentos: [{ formaEstorno: 'DINHEIRO', valorCentavos: centavos(6000) }], // devolveu a calcinha
      }),
      venda({
        registradaEm: new Date('2026-08-15T10:00:00.000Z'),
        operador: { id: 'carla', nome: 'Carla Lima' },
        totalCentavos: centavos(12000),
        itens: [{ varianteId: 'calcinha', descricao: 'Calcinha Cotton', sku: 'CAL-COT', quantidade: 2, totalCentavos: centavos(4000) }],
        pagamentos: [{ forma: 'CREDITO', valorCentavos: centavos(12000), trocoCentavos: centavos(0) }],
      }),
    ];

    const relatorio = calcularRelatorio(vendas);

    expect(relatorio.quantidadeVendas).toBe(3);
    expect(relatorio.totalVendidoCentavos).toBe(8990 + 15000 + 12000);
    expect(relatorio.totalDevolvidoCentavos).toBe(6000);
    expect(relatorio.totalLiquidoCentavos).toBe(8990 + 15000 + 12000 - 6000);
    expect(relatorio.quantidadeDevolucoes).toBe(1);

    expect(relatorio.porDia).toHaveLength(2);
    expect(relatorio.porDia[0]).toEqual({ data: '2026-08-01', quantidadeVendas: 2, totalCentavos: 23990 });

    expect(relatorio.porOperador).toEqual([
      { operadorId: 'ana', nome: 'Ana Souza', quantidadeVendas: 2, totalCentavos: 23990, ticketMedioCentavos: 11995 },
      { operadorId: 'carla', nome: 'Carla Lima', quantidadeVendas: 1, totalCentavos: 12000, ticketMedioCentavos: 12000 },
    ]);

    const calcinha = relatorio.produtosMaisVendidos.find((p) => p.varianteId === 'calcinha');
    expect(calcinha).toMatchObject({ quantidadeVendida: 5, totalCentavos: 10000 });

    // Soma dos itens de cada categoria: conjunto(1) + calcinha(3+2) + sutia(1) = 7
    expect(relatorio.totalItensVendidos).toBe(7);
  });
});
