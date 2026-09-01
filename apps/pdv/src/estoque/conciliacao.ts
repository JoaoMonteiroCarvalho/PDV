/**
 * Conciliação: qual peça do catálogo é cada item da nota.
 *
 * O código do fornecedor (`cProd`) quase nunca é o SKU da loja, e a descrição
 * dele ("CJ RENDA PT M") raramente bate com a nossa. O que costuma bater é o
 * código de barras — quando o fornecedor manda um.
 *
 * A regra aqui é conservadora de propósito: só casa quando tem CERTEZA, e
 * deixa o resto para a operadora decidir. Um palpite errado dá entrada de 12
 * peças na variante errada, e o erro só aparece quando a arara não bate com o
 * sistema — semanas depois, sem rastro de como aconteceu.
 *
 * Por isso não há casamento por semelhança de texto. Ele acertaria bastante e
 * erraria em silêncio, que é a pior combinação para estoque.
 */

import type { ItemCatalogo } from '../banco/local.js';
import type { ItemNota } from './notaFiscal.js';

export type ComoConciliou =
  /** Código de barras idêntico. É o único casamento automático confiável. */
  | 'codigo-barras'
  /** O código do fornecedor é igual a um SKU da loja — acontece, e é exato. */
  | 'sku'
  /** A operadora escolheu na mão. */
  | 'manual'
  /** Ninguém casou ainda. */
  | 'pendente';

export interface LinhaConciliada {
  readonly item: ItemNota;
  readonly varianteId: string | null;
  readonly como: ComoConciliou;
  /** Quantidade a dar entrada. Começa igual à da nota e é editável. */
  readonly quantidade: number;
}

/**
 * Casa os itens da nota com o catálogo local.
 *
 * Não consulta rede: usa a réplica que o caixa já tem. Conferir mercadoria no
 * estoque da loja, com a internet oscilando, é rotina.
 */
export function conciliar(
  itens: readonly ItemNota[],
  catalogo: readonly ItemCatalogo[],
): LinhaConciliada[] {
  const porCodigoBarras = new Map<string, ItemCatalogo>();
  const porSku = new Map<string, ItemCatalogo>();

  for (const variante of catalogo) {
    if (variante.codigoBarras) porCodigoBarras.set(variante.codigoBarras, variante);
    porSku.set(variante.sku.toUpperCase(), variante);
  }

  return itens.map((item) => {
    const porBarras = item.codigoBarras ? porCodigoBarras.get(item.codigoBarras) : undefined;
    if (porBarras) {
      return { item, varianteId: porBarras.id, como: 'codigo-barras', quantidade: item.quantidade };
    }

    const porCodigo = porSku.get(item.codigoFornecedor.toUpperCase());
    if (porCodigo) {
      return { item, varianteId: porCodigo.id, como: 'sku', quantidade: item.quantidade };
    }

    return { item, varianteId: null, como: 'pendente', quantidade: item.quantidade };
  });
}

export interface ResumoConciliacao {
  readonly total: number;
  readonly conciliados: number;
  readonly pendentes: number;
  /** Soma das quantidades que vão entrar de fato. */
  readonly pecasParaEntrada: number;
  readonly custoTotalCentavos: number;
}

export function resumir(linhas: readonly LinhaConciliada[]): ResumoConciliacao {
  const prontas = linhas.filter((linha) => linha.varianteId !== null && linha.quantidade > 0);

  return {
    total: linhas.length,
    conciliados: linhas.filter((linha) => linha.varianteId !== null).length,
    pendentes: linhas.filter((linha) => linha.varianteId === null).length,
    pecasParaEntrada: prontas.reduce((soma, linha) => soma + linha.quantidade, 0),
    custoTotalCentavos: prontas.reduce(
      (soma, linha) => soma + linha.item.custoUnitarioCentavos * linha.quantidade,
      0,
    ),
  };
}

/**
 * O que vai ao servidor: só as linhas conciliadas.
 *
 * Linha pendente é OMITIDA, não enviada com id nulo. Dar entrada parcial e
 * avisar o que ficou de fora é melhor do que travar a nota inteira porque um
 * item novo ainda não foi cadastrado — a mercadoria já está na loja e precisa
 * entrar no sistema hoje.
 */
export function paraEntrada(
  linhas: readonly LinhaConciliada[],
): { varianteId: string; quantidade: number; custoUnitarioCentavos: number }[] {
  return linhas
    .filter((linha) => linha.varianteId !== null && linha.quantidade > 0)
    .map((linha) => ({
      varianteId: linha.varianteId!,
      quantidade: linha.quantidade,
      custoUnitarioCentavos: linha.item.custoUnitarioCentavos,
    }));
}

/** Marca a escolha manual da operadora numa linha. */
export function escolherVariante(
  linhas: readonly LinhaConciliada[],
  numeroItem: number,
  varianteId: string | null,
): LinhaConciliada[] {
  return linhas.map((linha) =>
    linha.item.numeroItem === numeroItem
      ? { ...linha, varianteId, como: varianteId === null ? 'pendente' : 'manual' }
      : linha,
  );
}

/** Ajusta a quantidade de uma linha — a nota nem sempre bate com a caixa. */
export function ajustarQuantidade(
  linhas: readonly LinhaConciliada[],
  numeroItem: number,
  quantidade: number,
): LinhaConciliada[] {
  return linhas.map((linha) =>
    linha.item.numeroItem === numeroItem
      ? { ...linha, quantidade: Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 0 }
      : linha,
  );
}
