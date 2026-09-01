import { describe, expect, it } from 'vitest';
import type { ItemCatalogo } from '../banco/local.js';
import {
  ajustarQuantidade,
  conciliar,
  escolherVariante,
  paraEntrada,
  resumir,
} from './conciliacao.js';
import type { ItemNota } from './notaFiscal.js';

function variante(parcial: Partial<ItemCatalogo> & { id: string; sku: string }): ItemCatalogo {
  return {
    produtoId: 'p1',
    codigoBarras: null,
    nome: 'Conjunto Renda',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: 'M',
    cor: 'Preto',
    precoCentavos: 8_990,
    ativo: true,
    saldoEstoque: 3,
    atualizadoEm: '2026-09-01T10:00:00.000Z',
    termos: [],
    ...parcial,
  };
}

function itemNota(parcial: Partial<ItemNota> & { numeroItem: number }): ItemNota {
  return {
    codigoFornecedor: 'FORN-1',
    codigoBarras: null,
    descricao: 'CJ RENDA PT M',
    unidade: 'UN',
    quantidade: 10,
    custoUnitarioCentavos: 2_550,
    totalCentavos: 25_500,
    ...parcial,
  };
}

const CATALOGO = [
  variante({ id: 'v1', sku: 'CJ-REN-M-PRETO', codigoBarras: '7890000000017' }),
  variante({ id: 'v2', sku: 'CJ-REN-GG-VINHO', codigoBarras: null, cor: 'Vinho' }),
];

describe('conciliar()', () => {
  it('casa pelo código de barras, o único automático confiável', () => {
    const linhas = conciliar([itemNota({ numeroItem: 1, codigoBarras: '7890000000017' })], CATALOGO);
    expect(linhas[0]).toMatchObject({ varianteId: 'v1', como: 'codigo-barras' });
  });

  it('casa quando o código do fornecedor é igual a um SKU da loja', () => {
    const linhas = conciliar([itemNota({ numeroItem: 1, codigoFornecedor: 'CJ-REN-GG-VINHO' })], CATALOGO);
    expect(linhas[0]).toMatchObject({ varianteId: 'v2', como: 'sku' });
  });

  it('código de barras ganha do SKU quando os dois batem em variantes diferentes', () => {
    // O EAN identifica a peça física; o cProd é convenção do fornecedor.
    const linhas = conciliar(
      [itemNota({ numeroItem: 1, codigoBarras: '7890000000017', codigoFornecedor: 'CJ-REN-GG-VINHO' })],
      CATALOGO,
    );
    expect(linhas[0]!.varianteId).toBe('v1');
  });

  it('NÃO adivinha por semelhança de descrição', () => {
    /*
     * Um palpite errado dá entrada de 12 peças na variante errada, e o erro só
     * aparece quando a arara não bate com o sistema — semanas depois, sem
     * rastro. Acertar bastante e errar em silêncio é a pior combinação para
     * estoque.
     */
    const linhas = conciliar(
      [itemNota({ numeroItem: 1, descricao: 'CONJUNTO RENDA PRETO M', codigoFornecedor: 'X-999' })],
      CATALOGO,
    );
    expect(linhas[0]).toMatchObject({ varianteId: null, como: 'pendente' });
  });

  it('aceita SKU em caixa diferente', () => {
    const linhas = conciliar([itemNota({ numeroItem: 1, codigoFornecedor: 'cj-ren-gg-vinho' })], CATALOGO);
    expect(linhas[0]!.varianteId).toBe('v2');
  });

  it('começa com a quantidade da nota', () => {
    const linhas = conciliar([itemNota({ numeroItem: 1, quantidade: 7 })], CATALOGO);
    expect(linhas[0]!.quantidade).toBe(7);
  });

  it('catálogo vazio deixa tudo pendente, sem quebrar', () => {
    const linhas = conciliar([itemNota({ numeroItem: 1 })], []);
    expect(linhas[0]!.como).toBe('pendente');
  });
});

describe('resumir()', () => {
  const linhas = conciliar(
    [
      itemNota({ numeroItem: 1, codigoBarras: '7890000000017', quantidade: 10, custoUnitarioCentavos: 2_550 }),
      itemNota({ numeroItem: 2, codigoFornecedor: 'CJ-REN-GG-VINHO', quantidade: 5, custoUnitarioCentavos: 1_000 }),
      itemNota({ numeroItem: 3, codigoFornecedor: 'NOVO-1' }),
    ],
    CATALOGO,
  );

  it('conta conciliados e pendentes', () => {
    const resumo = resumir(linhas);
    expect(resumo.total).toBe(3);
    expect(resumo.conciliados).toBe(2);
    expect(resumo.pendentes).toBe(1);
  });

  it('soma só o que vai entrar de fato', () => {
    const resumo = resumir(linhas);
    expect(resumo.pecasParaEntrada).toBe(15);
    expect(resumo.custoTotalCentavos).toBe(10 * 2_550 + 5 * 1_000);
  });

  it('linha com quantidade zerada não conta como entrada', () => {
    const semQuantidade = ajustarQuantidade(linhas, 1, 0);
    expect(resumir(semQuantidade).pecasParaEntrada).toBe(5);
  });
});

describe('paraEntrada()', () => {
  it('envia só as linhas conciliadas, omitindo as pendentes', () => {
    /*
     * Dar entrada parcial e avisar o que ficou de fora é melhor do que travar
     * a nota inteira por um item novo: a mercadoria já está na loja e precisa
     * entrar no sistema hoje.
     */
    const linhas = conciliar(
      [
        itemNota({ numeroItem: 1, codigoBarras: '7890000000017' }),
        itemNota({ numeroItem: 2, codigoFornecedor: 'NOVO-1' }),
      ],
      CATALOGO,
    );

    expect(paraEntrada(linhas)).toEqual([
      { varianteId: 'v1', quantidade: 10, custoUnitarioCentavos: 2_550 },
    ]);
  });

  it('leva o custo da nota, que é o que apura margem', () => {
    const linhas = conciliar(
      [itemNota({ numeroItem: 1, codigoBarras: '7890000000017', custoUnitarioCentavos: 3_333 })],
      CATALOGO,
    );
    expect(paraEntrada(linhas)[0]!.custoUnitarioCentavos).toBe(3_333);
  });

  it('nada conciliado devolve lista vazia, não erro', () => {
    expect(paraEntrada(conciliar([itemNota({ numeroItem: 1 })], []))).toEqual([]);
  });
});

describe('escolherVariante() e ajustarQuantidade()', () => {
  const linhas = conciliar([itemNota({ numeroItem: 1 }), itemNota({ numeroItem: 2 })], []);

  it('escolha manual marca a origem, para a auditoria saber', () => {
    const depois = escolherVariante(linhas, 1, 'v2');
    expect(depois[0]).toMatchObject({ varianteId: 'v2', como: 'manual' });
    expect(depois[1]!.como).toBe('pendente');
  });

  it('desfazer a escolha volta para pendente', () => {
    const depois = escolherVariante(escolherVariante(linhas, 1, 'v2'), 1, null);
    expect(depois[0]).toMatchObject({ varianteId: null, como: 'pendente' });
  });

  it('ajusta a quantidade — a nota nem sempre bate com a caixa', () => {
    expect(ajustarQuantidade(linhas, 2, 4)[1]!.quantidade).toBe(4);
  });

  it('quantidade inválida vira zero, não NaN', () => {
    expect(ajustarQuantidade(linhas, 1, Number.NaN)[0]!.quantidade).toBe(0);
    expect(ajustarQuantidade(linhas, 1, -3)[0]!.quantidade).toBe(0);
  });
});
