import { deReais, ErroVenda, type PagamentoEntrada } from '@pdv/shared';
import { describe, expect, it } from 'vitest';
import {
  CARRINHO_VAZIO,
  adicionar,
  alterarQuantidade,
  calcular,
  calcularTroco,
  definirDescontoDoItem,
  definirDescontoDoTotal,
  fecharVenda,
  remover,
  saldoAPagar,
  totalDePecas,
  type ProdutoParaVenda,
} from './carrinho.js';

const CONJUNTO: ProdutoParaVenda = {
  id: '66666666-6666-4666-8666-666666666666',
  sku: 'CJ-REN-M-PRETO',
  nome: 'Conjunto Renda Delicada',
  categoria: 'Lingerie',
  tamanho: 'M',
  cor: 'Preto',
  precoCentavos: 8990,
};

const PERFUME: ProdutoParaVenda = {
  id: '77777777-7777-4777-8777-777777777777',
  sku: 'PF-SED',
  nome: 'Perfume Sedução 100ml',
  categoria: 'Perfumaria',
  tamanho: null,
  cor: null,
  precoCentavos: 18_990,
};

function pagar(forma: PagamentoEntrada['forma'], valor: string, troco = '0'): PagamentoEntrada {
  return { forma, valorCentavos: deReais(valor), trocoCentavos: deReais(troco) };
}

describe('montagem do carrinho', () => {
  it('adiciona item e calcula o total', () => {
    const carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    expect(carrinho.itens).toHaveLength(1);
    expect(calcular(carrinho).totalCentavos).toBe(8990);
  });

  it('bipar o mesmo produto duas vezes soma na quantidade, não cria duas linhas', () => {
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    carrinho = adicionar(carrinho, CONJUNTO);

    expect(carrinho.itens).toHaveLength(1);
    expect(carrinho.itens[0]!.quantidade).toBe(2);
    expect(calcular(carrinho).totalCentavos).toBe(17_980);
  });

  it('produtos diferentes ocupam linhas diferentes', () => {
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    carrinho = adicionar(carrinho, PERFUME);

    expect(carrinho.itens).toHaveLength(2);
    expect(calcular(carrinho).totalCentavos).toBe(27_980);
    expect(totalDePecas(carrinho)).toBe(2);
  });

  it('não muta o estado anterior', () => {
    const antes = adicionar(CARRINHO_VAZIO, CONJUNTO);
    const depois = adicionar(antes, PERFUME);

    expect(antes.itens).toHaveLength(1);
    expect(depois.itens).toHaveLength(2);
  });

  it('quantidade zero remove a linha', () => {
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO, 3);
    carrinho = alterarQuantidade(carrinho, CONJUNTO.id, 0);
    expect(carrinho.itens).toHaveLength(0);
  });

  it('remover tira só o item pedido', () => {
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    carrinho = adicionar(carrinho, PERFUME);
    carrinho = remover(carrinho, CONJUNTO.id);

    expect(carrinho.itens).toHaveLength(1);
    expect(carrinho.itens[0]!.sku).toBe('PF-SED');
  });

  it('recusa quantidade fracionada', () => {
    expect(() => adicionar(CARRINHO_VAZIO, CONJUNTO, 1.5)).toThrow();
    expect(() => adicionar(CARRINHO_VAZIO, CONJUNTO, 0)).toThrow();
  });

  it('mudar a quantidade zera o desconto do item', () => {
    // Um desconto de R$ 10 concedido sobre 1 peça não pode continuar valendo
    // quando a operadora muda para 5 peças.
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    carrinho = definirDescontoDoItem(carrinho, CONJUNTO.id, deReais('10,00'));
    expect(calcular(carrinho).descontoCentavos).toBe(1000);

    carrinho = alterarQuantidade(carrinho, CONJUNTO.id, 5);
    expect(calcular(carrinho).descontoCentavos).toBe(0);
  });
});

describe('descontos', () => {
  it('aplica desconto por item', () => {
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    carrinho = definirDescontoDoItem(carrinho, CONJUNTO.id, deReais('10,00'));

    const venda = calcular(carrinho);
    expect(venda.subtotalCentavos).toBe(8990);
    expect(venda.totalCentavos).toBe(7990);
  });

  it('rateia o desconto do total entre os itens, batendo com o servidor', () => {
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    carrinho = adicionar(carrinho, PERFUME);
    carrinho = definirDescontoDoTotal(carrinho, deReais('20,00'));

    const venda = calcular(carrinho);
    expect(venda.totalCentavos).toBe(25_980);
    // A soma dos itens tem que bater com o total — mesma invariante do CHECK
    // no banco. Se divergisse, o servidor recusaria a venda já impressa.
    const somaItens = venda.itens.reduce<number>((total, item) => total + item.totalCentavos, 0);
    expect(somaItens).toBe(venda.totalCentavos);
  });

  it('recusa desconto maior que a venda', () => {
    let carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
    carrinho = definirDescontoDoTotal(carrinho, deReais('100,00'));
    expect(() => calcular(carrinho)).toThrow(ErroVenda);
  });
});

describe('pagamento', () => {
  const carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO); // R$ 89,90

  it('calcula o saldo restante conforme entram pagamentos', () => {
    const venda = calcular(carrinho);
    expect(saldoAPagar(venda, [])).toBe(8990);
    expect(saldoAPagar(venda, [pagar('PIX', '50,00')])).toBe(3990);
    expect(saldoAPagar(venda, [pagar('PIX', '50,00'), pagar('DEBITO', '39,90')])).toBe(0);
  });

  it('usa o líquido (recebido − troco) ao fechar em dinheiro, não o bruto', () => {
    // Bug real encontrado pelo E2E: pagar R$ 100,00 em dinheiro numa venda de
    // R$ 89,90 gera R$ 10,10 de troco. Se saldoAPagar usasse o valor bruto
    // recebido, o saldo ficaria em -10,10 (nunca zero) e o botão de
    // finalizar, que exige saldo === 0, jamais habilitaria.
    const venda = calcular(carrinho);
    const pagamentos = [pagar('DINHEIRO', '100,00', '10,10')];
    expect(saldoAPagar(venda, pagamentos)).toBe(0);
  });

  it('saldo líquido soma corretamente com mais de um pagamento em dinheiro', () => {
    const venda = calcular(carrinho);
    const pagamentos = [pagar('PIX', '40,00'), pagar('DINHEIRO', '60,00', '10,10')];
    expect(saldoAPagar(venda, pagamentos)).toBe(0);
  });

  it('sugere o troco quando o cliente dá mais em dinheiro', () => {
    const venda = calcular(carrinho);
    expect(calcularTroco(venda, [pagar('DINHEIRO', '100,00')])).toBe(1010);
  });

  it('não sugere troco negativo quando falta dinheiro', () => {
    const venda = calcular(carrinho);
    expect(calcularTroco(venda, [pagar('DINHEIRO', '50,00')])).toBe(0);
  });
});

describe('fecharVenda()', () => {
  const carrinho = adicionar(CARRINHO_VAZIO, CONJUNTO);
  const dados = {
    sessaoCaixaId: '44444444-4444-4444-8444-444444444444',
    pagamentos: [pagar('DINHEIRO', '100,00', '10,10')],
  };

  it('gera o UUID no cliente, antes de qualquer rede', () => {
    const fechada = fecharVenda(carrinho, dados, () => 'id-fixo-de-teste');
    expect(fechada.id).toBe('id-fixo-de-teste');
    expect(fechada.corpo.id).toBe('id-fixo-de-teste');
  });

  it('monta o corpo exatamente no formato que o servidor espera', () => {
    const quando = new Date('2026-08-28T15:30:00.000Z');
    const fechada = fecharVenda(carrinho, dados, () => 'v1', () => quando);

    expect(fechada.corpo).toMatchObject({
      id: 'v1',
      sessaoCaixaId: dados.sessaoCaixaId,
      criadaEmCliente: '2026-08-28T15:30:00.000Z',
      descontoSobreTotalCentavos: 0,
      itens: [
        {
          varianteId: CONJUNTO.id,
          quantidade: 1,
          precoUnitarioCentavos: 8990,
          descontoCentavos: 0,
        },
      ],
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 10_000, trocoCentavos: 1010 }],
    });
  });

  it('recusa fechar quando o pagamento não cobre o total — antes de imprimir', () => {
    // Esta é a razão de validar aqui: se a venda fosse impressa e só depois
    // recusada pelo servidor, o comprovante já estaria na mão da cliente.
    expect(() =>
      fecharVenda(carrinho, { ...dados, pagamentos: [pagar('DEBITO', '50,00')] }),
    ).toThrow(ErroVenda);
  });

  it('recusa crediário sem cliente identificado', () => {
    expect(() =>
      fecharVenda(carrinho, {
        sessaoCaixaId: dados.sessaoCaixaId,
        pagamentos: [pagar('CREDIARIO', '89,90')],
      }),
    ).toThrow(ErroVenda);
  });

  it('inclui o plano de parcelas quando há crediário', () => {
    const fechada = fecharVenda(
      carrinho,
      {
        sessaoCaixaId: dados.sessaoCaixaId,
        clienteId: '55555555-5555-4555-8555-555555555555',
        pagamentos: [pagar('CREDIARIO', '89,90')],
        crediario: {
          quantidadeParcelas: 3,
          primeiroVencimento: new Date('2026-09-10T00:00:00.000Z'),
        },
      },
      () => 'v1',
    );

    expect(fechada.corpo.crediario).toEqual({
      quantidadeParcelas: 3,
      primeiroVencimento: '2026-09-10T00:00:00.000Z',
    });
  });

  it('devolve o cálculo para a impressão do comprovante', () => {
    const fechada = fecharVenda(carrinho, dados, () => 'v1');
    expect(fechada.calculo.totalCentavos).toBe(8990);
    expect(fechada.calculo.itens[0]!.totalCentavos).toBe(8990);
  });

  it('cada fechamento gera um id novo — vendas iguais não colidem', () => {
    const primeira = fecharVenda(carrinho, dados);
    const segunda = fecharVenda(carrinho, dados);
    expect(primeira.id).not.toBe(segunda.id);
  });
});
