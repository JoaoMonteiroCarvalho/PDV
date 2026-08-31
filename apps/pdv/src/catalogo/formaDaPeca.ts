/**
 * Qual forma abstrata representa a peça na prévia 3D.
 *
 * A regra que governa este arquivo: a prévia é um SÍMBOLO, não uma foto. Ela
 * comunica a COR real da peça e o tipo geral de embalagem — nada além disso.
 * Prometer mais seria pior que não ter prévia nenhuma: a operadora confiaria
 * numa imagem que não corresponde ao que está na arara.
 *
 * E, principalmente: **nenhuma forma tem corpo humano**. Numa loja de moda
 * íntima, um manequim na tela é constrangedor com a cliente do outro lado do
 * balcão. Roupa aparece dobrada, como fica na prateleira.
 *
 * A decisão sai da categoria e da existência de grade de tamanho, não do nome
 * do produto. Adivinhar por texto ("óleo", "gel") erraria em cadastro escrito
 * de outro jeito, e erraria em silêncio.
 */

export type FormaDaPeca =
  /** Peça de vestir, mostrada dobrada — nunca vestida. */
  | 'dobrada'
  /** Perfume, óleo, cosmético: frasco. */
  | 'frasco'
  /** Qualquer outra coisa: embalagem neutra, sem fingir que sabe o que é. */
  | 'bloco';

/** Categorias que a loja usa para o que vem em frasco. */
const CATEGORIAS_FRASCO = new Set(['perfumaria', 'cosmeticos', 'cosmetico']);

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function formaDaPeca(
  categoria: string | null | undefined,
  temGradeDeTamanho: boolean,
): FormaDaPeca {
  if (categoria && CATEGORIAS_FRASCO.has(normalizar(categoria))) return 'frasco';
  // Grade de tamanho é o sinal mais confiável de "isto se veste": nenhum
  // perfume é vendido em P, M e G.
  if (temGradeDeTamanho) return 'dobrada';
  return 'bloco';
}

/** Texto alternativo da prévia. Descreve a forma, não inventa a peça. */
export function descreverForma(forma: FormaDaPeca, nome: string): string {
  const comoAparece: Record<FormaDaPeca, string> = {
    dobrada: 'representada como peça dobrada',
    frasco: 'representada como frasco',
    bloco: 'representada como embalagem',
  };
  return `Prévia abstrata de ${nome}, ${comoAparece[forma]}. A imagem indica a cor, não o modelo.`;
}
