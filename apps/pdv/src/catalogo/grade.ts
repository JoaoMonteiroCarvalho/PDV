/**
 * Grade de variação — o problema central do catálogo de moda íntima.
 *
 * O servidor manda VARIANTES planas (cada combinação de tamanho e cor é uma
 * linha). A vendedora pensa em PRODUTO: "o conjunto de renda, tem no 42
 * preto?". Este módulo faz essa tradução.
 *
 * Lógica pura, sem React e sem banco: as regras de "qual combinação existe" e
 * "o que está esgotado" são as que mais aparecem no balcão, e precisam ser
 * testáveis sem montar tela.
 */

import type { ItemCatalogo } from '../banco/local.js';

export interface ProdutoAgrupado {
  readonly produtoId: string;
  readonly nome: string;
  readonly marca: string | null;
  readonly categoria: string | null;
  /** Cores distintas, na ordem em que aparecem no catálogo. */
  readonly cores: readonly string[];
  /** Tamanhos distintos, ordenados por convenção de grade, não alfabética. */
  readonly tamanhos: readonly string[];
  readonly variantes: readonly ItemCatalogo[];
  readonly precoMinimoCentavos: number;
  readonly precoMaximoCentavos: number;
  /** Soma do saldo de todas as combinações. Zero = produto sem nenhuma peça. */
  readonly saldoTotal: number;
}

/**
 * Ordem de tamanho por convenção do varejo, não alfabética.
 *
 * Ordenar "P, M, G, GG" como texto daria "G, GG, M, P" — a vendedora leria a
 * grade errada. Linha numérica (38, 40, 42) ordena por número. Peça de tamanho
 * único fica sozinha.
 */
const ORDEM_LETRA = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'ÚNICO', 'UNICO', 'U'];

export function compararTamanhos(a: string, b: string): number {
  const numeroA = Number.parseInt(a, 10);
  const numeroB = Number.parseInt(b, 10);
  const ambosNumericos = !Number.isNaN(numeroA) && !Number.isNaN(numeroB);
  if (ambosNumericos) return numeroA - numeroB;

  const indiceA = ORDEM_LETRA.indexOf(a.toUpperCase());
  const indiceB = ORDEM_LETRA.indexOf(b.toUpperCase());
  // Tamanho fora da convenção vai para o fim, em ordem alfabética entre si.
  if (indiceA === -1 && indiceB === -1) return a.localeCompare(b, 'pt-BR');
  if (indiceA === -1) return 1;
  if (indiceB === -1) return -1;
  return indiceA - indiceB;
}

/** Junta variantes soltas nos produtos que a vendedora enxerga. */
export function agruparPorProduto(itens: readonly ItemCatalogo[]): ProdutoAgrupado[] {
  const porProduto = new Map<string, ItemCatalogo[]>();

  for (const item of itens) {
    const lista = porProduto.get(item.produtoId);
    if (lista) lista.push(item);
    else porProduto.set(item.produtoId, [item]);
  }

  return [...porProduto.entries()].map(([produtoId, variantes]) => {
    const primeira = variantes[0]!;
    const precos = variantes.map((v) => v.precoCentavos);

    return {
      produtoId,
      nome: primeira.nome,
      marca: primeira.marca,
      categoria: primeira.categoria,
      cores: distintos(variantes.map((v) => v.cor)),
      tamanhos: distintos(variantes.map((v) => v.tamanho)).sort(compararTamanhos),
      variantes,
      precoMinimoCentavos: Math.min(...precos),
      precoMaximoCentavos: Math.max(...precos),
      saldoTotal: variantes.reduce((total, v) => total + v.saldoEstoque, 0),
    };
  });
}

function distintos(valores: readonly (string | null)[]): string[] {
  return [...new Set(valores.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/**
 * Acha a combinação exata escolhida na grade.
 *
 * `null` em cor ou tamanho significa "esta peça não varia nessa dimensão" —
 * perfume e óleo não têm tamanho, e o catálogo guarda isso como ausência.
 */
export function encontrarVariante(
  produto: ProdutoAgrupado,
  cor: string | null,
  tamanho: string | null,
): ItemCatalogo | null {
  return (
    produto.variantes.find((variante) => variante.cor === cor && variante.tamanho === tamanho) ??
    null
  );
}

/**
 * A combinação existe no cadastro? Diferente de ter estoque.
 *
 * Um conjunto pode existir em P/preto e GG/vinho sem existir em GG/preto —
 * a grade precisa mostrar que aquela célula simplesmente não é vendida, o que
 * não é o mesmo que "acabou".
 */
export function combinacaoExiste(
  produto: ProdutoAgrupado,
  cor: string | null,
  tamanho: string | null,
): boolean {
  return encontrarVariante(produto, cor, tamanho) !== null;
}

export type SituacaoCombinacao = 'disponivel' | 'esgotado' | 'inexistente';

export function situacaoDaCombinacao(
  produto: ProdutoAgrupado,
  cor: string | null,
  tamanho: string | null,
): SituacaoCombinacao {
  const variante = encontrarVariante(produto, cor, tamanho);
  if (!variante) return 'inexistente';
  return variante.saldoEstoque > 0 ? 'disponivel' : 'esgotado';
}

/** Produto tem uma variante só e nenhuma dimensão de variação (perfume, óleo). */
export function ehProdutoSimples(produto: ProdutoAgrupado): boolean {
  return produto.variantes.length === 1 && produto.cores.length === 0 && produto.tamanhos.length === 0;
}

/**
 * Qual combinação já vem escolhida ao abrir a consulta.
 *
 * Prefere a primeira COM saldo: abrir num tamanho esgotado faria a operadora
 * ler "0" e achar que o produto inteiro acabou. Se nada tem saldo, cai na
 * primeira que existe — a peça continua consultável e vendável.
 */
export function primeiraCombinacaoDisponivel(
  produto: ProdutoAgrupado,
): { cor: string | null; tamanho: string | null } | null {
  if (produto.variantes.length === 0) return null;

  const comSaldo = produto.variantes.find((variante) => variante.saldoEstoque > 0);
  const escolhida = comSaldo ?? produto.variantes[0]!;
  return { cor: escolhida.cor, tamanho: escolhida.tamanho };
}
