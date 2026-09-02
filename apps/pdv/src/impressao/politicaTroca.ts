/**
 * Política de troca — o texto que vai ao comprovante e a regra de confirmação.
 *
 * Peça íntima não tem troca por higiene. Isso é praxe do varejo e a loja tem
 * direito de fixar essa política **para arrependimento e troca por gosto**.
 *
 * O que a loja NÃO pode recusar é troca por **defeito de fabricação**: isso é
 * direito do consumidor (CDC art. 18) e nenhuma política de loja derruba. Por
 * isso a ressalva está no texto impresso e não é opcional — um comprovante que
 * dissesse apenas "peça íntima não tem troca" induziria a cliente a erro e
 * exporia a loja a reclamação com razão.
 *
 * Também não se promete o "arrependimento em 7 dias" do art. 49: aquele prazo
 * vale para compra FORA do estabelecimento (internet, telefone). Numa venda de
 * balcão ele não se aplica, e imprimir que se aplica criaria uma obrigação que
 * a loja não tem.
 */

import { normalizarCategoria } from './discricao.js';

/**
 * Categorias em que a troca é recusada por higiene.
 *
 * Moda praia entra pelo mesmo motivo que lingerie — a peça é provada em
 * contato direto com o corpo.
 */
const CATEGORIAS_COM_RESTRICAO = new Set(['lingerie', 'moda praia', 'sensual', 'sexshop']);

export function temRestricaoDeHigiene(categoria: string | null | undefined): boolean {
  return CATEGORIAS_COM_RESTRICAO.has(normalizarCategoria(categoria));
}

/**
 * A venda tem alguma peça sujeita à restrição?
 *
 * A confirmação da operadora é exigida SÓ quando a resposta é sim. Pedir em
 * toda venda treinaria a mão a clicar sem ler, que é o mesmo que não pedir.
 */
export function vendaExigeAvisoDeHigiene(
  itens: readonly { readonly categoria: string | null }[],
): boolean {
  return itens.some((item) => temRestricaoDeHigiene(item.categoria));
}

/** O que a operadora confirma ter dito à cliente, em voz alta, antes de fechar. */
export const AVISO_NA_TELA =
  'Peça íntima não tem troca por higiene, exceto defeito de fabricação. ' +
  'Confirme que avisou a cliente antes de finalizar.';

/**
 * Bloco impresso no comprovante, já em 48 colunas.
 *
 * Sai sem acento de propósito: a impressora térmica da loja ainda não foi
 * definida, e boa parte delas imprime a página de código errada, trocando
 * acentos por caracteres soltos justo no aviso que mais precisa ser lido.
 */
export function linhasDaPoliticaTroca(
  comRestricao: boolean,
  linhaDaLoja?: string | null,
): string[] {
  const linhas = ['POLITICA DE TROCA'];

  if (comRestricao) {
    linhas.push('Peca intima e moda praia: sem troca por');
    linhas.push('higiene, EXCETO defeito de fabricacao.');
  }

  linhas.push('Demais itens: 7 dias, com etiqueta e');
  linhas.push('este comprovante.');
  linhas.push('Defeito de fabricacao: troca garantida.');

  /*
   * A linha da loja vem POR ÚLTIMO e é adicional, nunca substitui. Se ela
   * pudesse trocar o texto acima, uma configuração descuidada apagaria a
   * garantia de troca por defeito — que é direito e não é negociável.
   */
  if (linhaDaLoja && linhaDaLoja.trim().length > 0) {
    for (const parte of quebrarEmColunas(linhaDaLoja.trim(), 48)) linhas.push(parte);
  }

  return linhas;
}

/** Quebra por palavra para não cortar no meio de uma no papel de 48 colunas. */
function quebrarEmColunas(texto: string, colunas: number): string[] {
  const partes: string[] = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/)) {
    if (atual.length === 0) atual = palavra.slice(0, colunas);
    else if (atual.length + 1 + palavra.length <= colunas) atual += ` ${palavra}`;
    else {
      partes.push(atual);
      atual = palavra.slice(0, colunas);
    }
  }
  if (atual.length > 0) partes.push(atual);
  return partes;
}
