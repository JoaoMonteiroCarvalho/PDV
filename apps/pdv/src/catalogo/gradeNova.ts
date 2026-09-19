/**
 * Gerador de grade para o cadastro de produto.
 *
 * Peça de lingerie chega em P/M/G × três cores. Digitar as nove combinações à
 * mão é onde nascem os erros que só aparecem semanas depois: a variação que
 * ficou de fora e some do caixa, e o SKU colado duas vezes que faz duas peças
 * diferentes virarem a mesma no estoque.
 *
 * Funções puras, sem React: o que decide o que será gravado no catálogo é
 * testável sem montar tela nenhuma.
 */

export interface CombinacaoGrade {
  readonly tamanho: string | null;
  readonly cor: string | null;
}

/** Quebra "P, M, G" em ["P","M","G"], sem vazios e sem repetição. */
export function separarLista(texto: string): string[] {
  const itens = texto
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  // `Map` por chave normalizada preserva a grafia que a pessoa digitou, mas
  // trata "Preto" e "preto" como a mesma cor — senão viram duas variações.
  const porChave = new Map<string, string>();
  for (const item of itens) {
    const chave = item.toLowerCase();
    if (!porChave.has(chave)) porChave.set(chave, item);
  }
  return [...porChave.values()];
}

/**
 * Produto cartesiano de tamanhos × cores.
 *
 * Qualquer um dos dois pode ser vazio: perfume não tem tamanho, e uma peça
 * vendida em cor única não tem cor. Os dois vazios devolvem lista vazia — não
 * uma variação sem nada, porque nesse caso quem cadastra não informou grade
 * alguma e precisa saber disso.
 */
export function montarGrade(textoTamanhos: string, textoCores: string): CombinacaoGrade[] {
  const tamanhos = separarLista(textoTamanhos);
  const cores = separarLista(textoCores);

  if (tamanhos.length === 0 && cores.length === 0) return [];
  if (cores.length === 0) return tamanhos.map((tamanho) => ({ tamanho, cor: null }));
  if (tamanhos.length === 0) return cores.map((cor) => ({ tamanho: null, cor }));

  return tamanhos.flatMap((tamanho) => cores.map((cor) => ({ tamanho, cor })));
}

/**
 * SKU sugerido a partir do nome e da combinação.
 *
 * É SUGESTÃO, não regra: a tela deixa editar antes de salvar, porque loja que
 * já tem convenção de código não vai adotar a nossa. O que a sugestão precisa
 * garantir é ser previsível e não colidir dentro do mesmo produto.
 *
 * Acento sai (o leitor de código de barras não emite acento e o balcão digita
 * sem), espaço vira hífen, e o resultado é maiúsculo — o mesmo formato que o
 * esquema da API aceita.
 */
export function sugerirSku(nome: string, tamanho: string | null, cor: string | null): string {
  const raiz = normalizarParaSku(nome)
    .split('-')
    .filter((parte) => parte.length > 0)
    // Três palavras bastam para o código continuar legível no balcão:
    // "CONJUNTO-RENDA-FLOR" e não a frase inteira do nome comercial.
    .slice(0, 3)
    .join('-');

  const partes = [raiz, normalizarParaSku(cor ?? ''), normalizarParaSku(tamanho ?? '')].filter(
    (parte) => parte.length > 0,
  );

  return partes.join('-');
}

function normalizarParaSku(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas de acento separadas pelo NFD
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
