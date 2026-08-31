import { describe, expect, it } from 'vitest';
import type { ItemCatalogo } from '../banco/local.js';
import {
  agruparPorProduto,
  combinacaoExiste,
  compararTamanhos,
  ehProdutoSimples,
  encontrarVariante,
  situacaoDaCombinacao,
} from './grade.js';

function variante(parcial: Partial<ItemCatalogo> & { id: string; produtoId: string }): ItemCatalogo {
  return {
    sku: `SKU-${parcial.id}`,
    codigoBarras: null,
    nome: 'Conjunto Renda',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: null,
    cor: null,
    precoCentavos: 8990,
    ativo: true,
    saldoEstoque: 5,
    atualizadoEm: '2026-08-01T10:00:00.000Z',
    termos: [],
    ...parcial,
  };
}

describe('compararTamanhos()', () => {
  it('ordena letra pela convenção do varejo, não alfabética', () => {
    // Alfabético daria "G, GG, M, P" e a vendedora leria a grade errada.
    const ordenado = ['GG', 'P', 'G', 'M'].sort(compararTamanhos);
    expect(ordenado).toEqual(['P', 'M', 'G', 'GG']);
  });

  it('ordena linha numérica por número', () => {
    expect(['46', '38', '42', '40'].sort(compararTamanhos)).toEqual(['38', '40', '42', '46']);
  });

  it('joga tamanho fora da convenção para o fim, sem quebrar', () => {
    const ordenado = ['M', 'Plus', 'P'].sort(compararTamanhos);
    expect(ordenado[0]).toBe('P');
    expect(ordenado[1]).toBe('M');
    expect(ordenado[2]).toBe('Plus');
  });
});

describe('agruparPorProduto()', () => {
  const variantes = [
    variante({ id: 'a', produtoId: 'p1', cor: 'Preto', tamanho: 'M', precoCentavos: 8990 }),
    variante({ id: 'b', produtoId: 'p1', cor: 'Vinho', tamanho: 'M', precoCentavos: 8990 }),
    variante({ id: 'c', produtoId: 'p1', cor: 'Preto', tamanho: 'GG', precoCentavos: 9990 }),
    variante({ id: 'd', produtoId: 'p2', nome: 'Perfume', cor: null, tamanho: null }),
  ];

  it('junta variantes do mesmo produto numa grade só', () => {
    const produtos = agruparPorProduto(variantes);
    expect(produtos).toHaveLength(2);

    const conjunto = produtos.find((p) => p.produtoId === 'p1')!;
    expect(conjunto.variantes).toHaveLength(3);
    expect(conjunto.cores).toEqual(['Preto', 'Vinho']);
    expect(conjunto.tamanhos).toEqual(['M', 'GG']);
  });

  it('agrupa por produtoId, não por nome', () => {
    // Dois produtos distintos com o mesmo nome não podem virar uma grade só.
    const homonimos = [
      variante({ id: 'x', produtoId: 'p1', nome: 'Calcinha', cor: 'Preto' }),
      variante({ id: 'y', produtoId: 'p2', nome: 'Calcinha', cor: 'Nude' }),
    ];
    expect(agruparPorProduto(homonimos)).toHaveLength(2);
  });

  it('expõe a faixa de preço quando as variações custam diferente', () => {
    const conjunto = agruparPorProduto(variantes).find((p) => p.produtoId === 'p1')!;
    expect(conjunto.precoMinimoCentavos).toBe(8990);
    expect(conjunto.precoMaximoCentavos).toBe(9990);
  });

  it('soma o saldo de todas as combinações', () => {
    const conjunto = agruparPorProduto(variantes).find((p) => p.produtoId === 'p1')!;
    expect(conjunto.saldoTotal).toBe(15); // 3 variantes × 5
  });

  it('lista vazia não quebra', () => {
    expect(agruparPorProduto([])).toEqual([]);
  });
});

describe('situacaoDaCombinacao()', () => {
  const produto = agruparPorProduto([
    variante({ id: 'a', produtoId: 'p1', cor: 'Preto', tamanho: 'P', saldoEstoque: 3 }),
    variante({ id: 'b', produtoId: 'p1', cor: 'Preto', tamanho: 'GG', saldoEstoque: 0 }),
    variante({ id: 'c', produtoId: 'p1', cor: 'Vinho', tamanho: 'P', saldoEstoque: 2 }),
  ])[0]!;

  it('combinação com peça na arara está disponível', () => {
    expect(situacaoDaCombinacao(produto, 'Preto', 'P')).toBe('disponivel');
  });

  it('distingue "acabou" de "nunca existiu"', () => {
    // Preto/GG existe no cadastro mas zerou.
    expect(situacaoDaCombinacao(produto, 'Preto', 'GG')).toBe('esgotado');
    // Vinho/GG nunca foi cadastrado — a loja não vende essa combinação.
    expect(situacaoDaCombinacao(produto, 'Vinho', 'GG')).toBe('inexistente');
  });

  it('combinacaoExiste ignora estoque', () => {
    expect(combinacaoExiste(produto, 'Preto', 'GG')).toBe(true);
    expect(combinacaoExiste(produto, 'Vinho', 'GG')).toBe(false);
  });
});

describe('encontrarVariante()', () => {
  const produto = agruparPorProduto([
    variante({ id: 'a', produtoId: 'p1', cor: 'Preto', tamanho: 'M' }),
  ])[0]!;

  it('localiza a combinação exata escolhida na grade', () => {
    expect(encontrarVariante(produto, 'Preto', 'M')?.id).toBe('a');
  });

  it('devolve null para combinação inexistente, sem lançar', () => {
    expect(encontrarVariante(produto, 'Vinho', 'M')).toBeNull();
  });
});

describe('ehProdutoSimples()', () => {
  it('perfume, sem cor nem tamanho, é produto simples', () => {
    const perfume = agruparPorProduto([
      variante({ id: 'x', produtoId: 'p9', nome: 'Perfume', cor: null, tamanho: null }),
    ])[0]!;
    expect(ehProdutoSimples(perfume)).toBe(true);
  });

  it('peça com grade não é produto simples', () => {
    const conjunto = agruparPorProduto([
      variante({ id: 'a', produtoId: 'p1', cor: 'Preto', tamanho: 'M' }),
      variante({ id: 'b', produtoId: 'p1', cor: 'Vinho', tamanho: 'M' }),
    ])[0]!;
    expect(ehProdutoSimples(conjunto)).toBe(false);
  });
});
