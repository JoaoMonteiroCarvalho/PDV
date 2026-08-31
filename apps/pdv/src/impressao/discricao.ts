/**
 * Discrição no comprovante.
 *
 * O papel sai da loja e nem sempre fica com quem comprou: vai para a bolsa,
 * para a mesa da cozinha, para a prestação de contas de um casal. "Calcinha
 * Fio Duplo Algodão" e "Óleo de Massagem Beijável" impressos em letra garrafal
 * expõem a cliente a uma conversa que ela não pediu.
 *
 * Por isso o comprovante sai com descrição GENÉRICA por padrão. Não é
 * censura nem economia de tinta — é a diferença entre a cliente voltar à loja
 * ou não voltar.
 *
 * O que NÃO some, porque é o que ela precisa para conferir a conta no balcão:
 * quantidade, preço unitário, total por linha, tamanho e cor. Some só o nome
 * do produto, que é a parte que denuncia.
 *
 * O SKU também não vai ao papel em modo discreto: nesta loja ele é escrito com
 * o nome dentro ("CJ-REN-P-PRETO"), então imprimi-lo desfaria o resto. Quem
 * precisa identificar a peça para troca usa o código da venda, que o
 * comprovante traz, e o registro no sistema.
 */

export type NivelDiscricao = 'discreto' | 'completo';

/**
 * Termo genérico por categoria.
 *
 * Deliberadamente pouco específico nas categorias sensíveis e mais informativo
 * nas neutras — perfume não constrange ninguém, e "Perfumaria" ajuda a cliente
 * a bater a conta.
 */
const GENERICO_POR_CATEGORIA: Readonly<Record<string, string>> = {
  lingerie: 'Peca intima',
  sensual: 'Produto',
  sexshop: 'Produto',
  'moda praia': 'Vestuario',
  pijamas: 'Vestuario',
  vestuario: 'Vestuario',
  perfumaria: 'Perfumaria',
  cosmeticos: 'Perfumaria',
  cosmetico: 'Perfumaria',
};

/** Sem categoria cadastrada, o genérico mais neutro que existe. */
const GENERICO_PADRAO = 'Produto';

export function normalizarCategoria(categoria: string | null | undefined): string {
  if (!categoria) return '';
  return categoria
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Descrição que vai ao papel.
 *
 * Em `completo` devolve o nome real — usado quando a própria cliente pede a
 * via detalhada, o que acontece e é direito dela.
 */
export function descricaoParaComprovante(
  nome: string,
  categoria: string | null | undefined,
  nivel: NivelDiscricao = 'discreto',
): string {
  if (nivel === 'completo') return nome;
  return GENERICO_POR_CATEGORIA[normalizarCategoria(categoria)] ?? GENERICO_PADRAO;
}

/** Lista para a tela de configurações mostrar o que cada categoria vira. */
export function listarGenericos(): { categoria: string; generico: string }[] {
  return Object.entries(GENERICO_POR_CATEGORIA).map(([categoria, generico]) => ({
    categoria,
    generico,
  }));
}
