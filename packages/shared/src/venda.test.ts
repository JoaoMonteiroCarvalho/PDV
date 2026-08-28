import { centavos, deReais, pontosBase, type Centavos } from './dinheiro.js';
import { describe, expect, it } from 'vitest';
import {
  calcularParcelas,
  calcularVenda,
  ErroVenda,
  movimentosDaVenda,
  validarAlcadaDesconto,
  validarPagamentos,
  type ItemEntrada,
  type PagamentoEntrada,
} from './venda.js';

function item(preco: string, quantidade: number, desconto = '0', varianteId = 'v1'): ItemEntrada {
  return {
    varianteId,
    quantidade,
    precoUnitarioCentavos: deReais(preco),
    descontoCentavos: deReais(desconto),
  };
}

function pagamento(
  forma: PagamentoEntrada['forma'],
  valor: string,
  troco = '0',
): PagamentoEntrada {
  return { forma, valorCentavos: deReais(valor), trocoCentavos: deReais(troco) };
}

/**
 * Verifica o código estável do erro, não o texto da mensagem.
 * Mensagem é para o operador e pode mudar; código é contrato com o frontend.
 */
function esperaCodigo(acao: () => unknown, codigo: string): void {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroVenda);
    expect((erro as ErroVenda).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Esperava ErroVenda com código ${codigo}, mas nada foi lançado.`);
}

describe('calcularVenda()', () => {
  it('soma itens sem desconto', () => {
    const venda = calcularVenda([item('89,90', 2), item('49,90', 1)]);
    expect(venda.subtotalCentavos).toBe(22970);
    expect(venda.descontoCentavos).toBe(0);
    expect(venda.totalCentavos).toBe(22970);
  });

  it('aplica desconto por item', () => {
    const venda = calcularVenda([item('89,90', 1, '10,00')]);
    expect(venda.subtotalCentavos).toBe(8990);
    expect(venda.descontoCentavos).toBe(1000);
    expect(venda.totalCentavos).toBe(7990);
    expect(venda.itens[0]!.totalCentavos).toBe(7990);
  });

  it('rateia o desconto do total entre os itens, preservando a soma', () => {
    const venda = calcularVenda(
      [item('33,33', 1, '0', 'a'), item('33,33', 1, '0', 'b'), item('33,34', 1, '0', 'c')],
      deReais('10,00'),
    );
    expect(venda.subtotalCentavos).toBe(10000);
    expect(venda.descontoCentavos).toBe(1000);
    expect(venda.totalCentavos).toBe(9000);

    // A invariante que o banco também exige via CHECK.
    const somaItens = venda.itens.reduce<number>((total, i) => total + i.totalCentavos, 0);
    expect(somaItens).toBe(venda.totalCentavos);
  });

  it('mantém a invariante do banco para qualquer desconto sobre o total', () => {
    const itens = [
      item('89,90', 2, '0', 'a'),
      item('49,90', 3, '5,00', 'b'),
      item('19,99', 1, '0', 'c'),
    ];
    const base = calcularVenda(itens);
    for (let desconto = 0; desconto <= base.totalCentavos; desconto += 37) {
      const venda = calcularVenda(itens, centavos(desconto) as Centavos);
      const somaItens = venda.itens.reduce<number>((total, i) => total + i.totalCentavos, 0);
      expect(somaItens).toBe(venda.totalCentavos);
      expect(venda.totalCentavos).toBe(venda.subtotalCentavos - venda.descontoCentavos);
      expect(venda.totalCentavos).toBeGreaterThanOrEqual(0);
    }
  });

  it('não rateia desconto para item já zerado por desconto próprio', () => {
    const venda = calcularVenda(
      [item('50,00', 1, '50,00', 'brinde'), item('50,00', 1, '0', 'normal')],
      deReais('10,00'),
    );
    expect(venda.itens[0]!.totalCentavos).toBe(0);
    expect(venda.itens[1]!.totalCentavos).toBe(4000);
  });

  it('recusa venda vazia', () => {
    esperaCodigo(() => calcularVenda([]), 'VENDA_SEM_ITENS');
  });

  it('recusa desconto maior que o item', () => {
    esperaCodigo(() => calcularVenda([item('50,00', 1, '60,00')]), 'DESCONTO_MAIOR_QUE_ITEM');
  });

  it('recusa desconto maior que o total da venda', () => {
    esperaCodigo(
      () => calcularVenda([item('50,00', 1)], deReais('60,00')),
      'DESCONTO_MAIOR_QUE_TOTAL',
    );
  });

  it('recusa quantidade fracionada — esta loja vende por unidade', () => {
    esperaCodigo(() => calcularVenda([item('50,00', 1.5)]), 'QUANTIDADE_INVALIDA');
    esperaCodigo(() => calcularVenda([item('50,00', 0)]), 'QUANTIDADE_INVALIDA');
  });
});

describe('validarAlcadaDesconto()', () => {
  const operadorSemAlcada = { limiteOperadorBps: pontosBase(0), autorizadorEhGerente: false };

  it('passa quando não há desconto', () => {
    const venda = calcularVenda([item('100,00', 1)]);
    expect(validarAlcadaDesconto(venda, operadorSemAlcada).exigiuAutorizacao).toBe(false);
  });

  it('passa quando o desconto cabe no limite do operador', () => {
    const venda = calcularVenda([item('100,00', 1)], deReais('5,00')); // 5%
    const resultado = validarAlcadaDesconto(venda, {
      limiteOperadorBps: pontosBase(500),
      autorizadorEhGerente: false,
    });
    expect(resultado.exigiuAutorizacao).toBe(false);
    expect(resultado.descontoBps).toBe(500);
  });

  it('bloqueia desconto acima do limite sem gerente', () => {
    const venda = calcularVenda([item('100,00', 1)], deReais('20,00')); // 20%
    esperaCodigo(
      () =>
        validarAlcadaDesconto(venda, {
          limiteOperadorBps: pontosBase(500),
          autorizadorEhGerente: false,
        }),
      'DESCONTO_ACIMA_DA_ALCADA',
    );
  });

  it('libera com gerente e sinaliza que precisa ir para auditoria', () => {
    const venda = calcularVenda([item('100,00', 1)], deReais('20,00'));
    const resultado = validarAlcadaDesconto(venda, {
      limiteOperadorBps: pontosBase(500),
      autorizadoPorId: 'gerente-1',
      autorizadorEhGerente: true,
    });
    expect(resultado.exigiuAutorizacao).toBe(true);
  });

  it('recusa autorizador que não é gerente', () => {
    const venda = calcularVenda([item('100,00', 1)], deReais('20,00'));
    esperaCodigo(
      () =>
        validarAlcadaDesconto(venda, {
          limiteOperadorBps: pontosBase(500),
          autorizadoPorId: 'outro-operador',
          autorizadorEhGerente: false,
        }),
      'AUTORIZADOR_SEM_PERMISSAO',
    );
  });

  it('arredonda o desconto para cima ao medir a alçada (conservador)', () => {
    const venda = calcularVenda([item('99,99', 1)], deReais('0,01'));
    expect(venda.descontoBps).toBe(2);
  });
});

describe('validarPagamentos()', () => {
  const venda = calcularVenda([item('100,00', 1)]);

  it('aceita pagamento exato', () => {
    expect(() => validarPagamentos(venda, [pagamento('DEBITO', '100,00')])).not.toThrow();
  });

  it('aceita dinheiro com troco', () => {
    expect(() => validarPagamentos(venda, [pagamento('DINHEIRO', '150,00', '50,00')])).not.toThrow();
  });

  it('aceita pagamento dividido entre formas', () => {
    expect(() =>
      validarPagamentos(venda, [pagamento('PIX', '60,00'), pagamento('CREDITO', '40,00')]),
    ).not.toThrow();
  });

  it('recusa quando a soma não fecha o total', () => {
    esperaCodigo(
      () => validarPagamentos(venda, [pagamento('DEBITO', '99,00')]),
      'PAGAMENTO_NAO_FECHA',
    );
    esperaCodigo(
      () => validarPagamentos(venda, [pagamento('DEBITO', '101,00')]),
      'PAGAMENTO_NAO_FECHA',
    );
  });

  it('recusa troco em cartão — a maquininha é separada e não devolve troco', () => {
    esperaCodigo(
      () => validarPagamentos(venda, [pagamento('DEBITO', '150,00', '50,00')]),
      'TROCO_FORA_DE_DINHEIRO',
    );
  });

  it('recusa troco maior que o dinheiro recebido', () => {
    esperaCodigo(
      () => validarPagamentos(venda, [pagamento('DINHEIRO', '100,00', '150,00')]),
      'TROCO_MAIOR_QUE_RECEBIDO',
    );
  });

  it('recusa venda sem pagamento', () => {
    esperaCodigo(() => validarPagamentos(venda, []), 'VENDA_SEM_PAGAMENTO');
  });

  it('exige cliente identificado no crediário', () => {
    esperaCodigo(
      () => validarPagamentos(venda, [pagamento('CREDIARIO', '100,00')]),
      'CREDIARIO_SEM_CLIENTE',
    );
  });

  it('respeita o limite de crediário do cliente', () => {
    esperaCodigo(
      () =>
        validarPagamentos(venda, [pagamento('CREDIARIO', '100,00')], {
          clienteId: 'c1',
          limiteCrediarioDisponivelCentavos: deReais('50,00'),
        }),
      'LIMITE_CREDIARIO_EXCEDIDO',
    );

    expect(() =>
      validarPagamentos(venda, [pagamento('CREDIARIO', '100,00')], {
        clienteId: 'c1',
        limiteCrediarioDisponivelCentavos: deReais('300,00'),
      }),
    ).not.toThrow();
  });

  it('aceita entrada em dinheiro e o resto no crediário', () => {
    expect(() =>
      validarPagamentos(venda, [pagamento('DINHEIRO', '30,00'), pagamento('CREDIARIO', '70,00')], {
        clienteId: 'c1',
        limiteCrediarioDisponivelCentavos: deReais('500,00'),
      }),
    ).not.toThrow();
  });
});

describe('calcularParcelas()', () => {
  it('divide sem perder centavo', () => {
    const parcelas = calcularParcelas(deReais('100,00'), 3, new Date(Date.UTC(2026, 8, 10)));
    expect(parcelas.map((p) => p.valorCentavos)).toEqual([3334, 3333, 3333]);
    expect(parcelas.reduce<number>((total, p) => total + p.valorCentavos, 0)).toBe(10000);
  });

  it('numera e agenda vencimentos mensais', () => {
    const parcelas = calcularParcelas(deReais('300,00'), 3, new Date(Date.UTC(2026, 8, 10)));
    expect(parcelas.map((p) => p.numero)).toEqual([1, 2, 3]);
    expect(parcelas.map((p) => p.vencimento.toISOString().slice(0, 10))).toEqual([
      '2026-09-10',
      '2026-10-10',
      '2026-11-10',
    ]);
  });

  it('não transborda de mês curto — dia 31 vence no último dia de fevereiro', () => {
    const parcelas = calcularParcelas(deReais('300,00'), 3, new Date(Date.UTC(2026, 11, 31)));
    expect(parcelas.map((p) => p.vencimento.toISOString().slice(0, 10))).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
  });

  it('recusa parâmetros inválidos', () => {
    esperaCodigo(() => calcularParcelas(centavos(0), 3, new Date()), 'CREDIARIO_VALOR_INVALIDO');
    esperaCodigo(
      () => calcularParcelas(deReais('100,00'), 0, new Date()),
      'CREDIARIO_PARCELAS_INVALIDAS',
    );
  });
});

describe('movimentosDaVenda()', () => {
  it('gera baixa de estoque negativa por item', () => {
    const venda = calcularVenda([item('50,00', 2, '0', 'a'), item('30,00', 1, '0', 'b')]);
    expect(movimentosDaVenda(venda)).toEqual([
      { varianteId: 'a', tipo: 'VENDA', quantidade: -2 },
      { varianteId: 'b', tipo: 'VENDA', quantidade: -1 },
    ]);
  });
});
