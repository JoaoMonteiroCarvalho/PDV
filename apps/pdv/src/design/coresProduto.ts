/**
 * Paleta de CATÁLOGO — as cores reais das peças.
 *
 * Deliberadamente separada da paleta de interface. Um sutiã vinho é vinho
 * independente de a operadora ter escolhido tema claro ou escuro, e
 * independente de qual é a cor de destaque do sistema.
 *
 * O cadastro do produto guarda a CHAVE (`'vinho'`), nunca o hex. A tradução
 * acontece só aqui — assim, se a loja quiser ajustar o tom exibido de "nude",
 * muda num lugar e vale para preview 3D, swatch, thumbnail do carrinho e
 * comprovante.
 *
 * REGRA: nada neste arquivo pode ler `--accent` ou qualquer token de
 * interface. Se um dia isso acontecer, o produto passa a mudar de cor quando
 * alguém troca o tema — que é exatamente o bug que esta separação previne.
 */

export const CORES_PRODUTO = {
  preto: { rotulo: 'Preto', hex: '#1A1A1C' },
  grafite: { rotulo: 'Grafite', hex: '#3E3E42' },
  branco: { rotulo: 'Branco', hex: '#FAFAF8' },
  marfim: { rotulo: 'Marfim', hex: '#F2EFE9' },
  nude: { rotulo: 'Nude', hex: '#D8B49C' },
  blush: { rotulo: 'Blush', hex: '#E8B7B7' },
  rosa: { rotulo: 'Rosa', hex: '#D9789B' },
  vinho: { rotulo: 'Vinho', hex: '#7A3129' },
  vermelho: { rotulo: 'Vermelho', hex: '#A81E28' },
  marinho: { rotulo: 'Azul marinho', hex: '#1E2A44' },
  verde: { rotulo: 'Verde', hex: '#3A5A4A' },
  /*
   * Estampado não é uma cor, é a ausência de cor única. Recebe um tom neutro
   * de propósito — fingir um hex específico faria o swatch mentir sobre uma
   * peça que tem cinco cores.
   */
  estampado: { rotulo: 'Estampado', hex: '#B8ADA0' },
} as const;

export type ChaveCorProduto = keyof typeof CORES_PRODUTO;

/**
 * Como o cadastro escreve versus a chave da paleta.
 *
 * O cadastro é preenchido por gente, e "Azul Marinho" é o que a etiqueta do
 * fornecedor diz. Sem estes apelidos, uma peça perfeitamente catalogada
 * apareceria como cor desconhecida só por causa da grafia.
 */
const APELIDOS: Record<string, ChaveCorProduto> = {
  'azul marinho': 'marinho',
  azul: 'marinho',
  'off white': 'marfim',
  offwhite: 'marfim',
  creme: 'marfim',
  bordo: 'vinho',
  chumbo: 'grafite',
  estampa: 'estampado',
};

/** Cor usada quando o cadastro traz uma chave que o front ainda não conhece. */
const COR_DESCONHECIDA = { rotulo: 'Cor não catalogada', hex: '#C7C7CC' } as const;

export interface CorProduto {
  readonly chave: string;
  readonly rotulo: string;
  readonly hex: string;
  /** true quando a chave não existe na paleta — a UI sinaliza em vez de mentir. */
  readonly desconhecida: boolean;
}

/**
 * Traduz a chave vinda do cadastro para o tom exibido.
 *
 * Nunca lança: um produto com cor não catalogada precisa continuar vendável.
 * Ele aparece com um cinza neutro e `desconhecida: true`, para a tela poder
 * avisar sem impedir a venda.
 */
export function corDoProduto(chave: string | null | undefined): CorProduto {
  if (!chave) {
    return { chave: '', ...COR_DESCONHECIDA, desconhecida: true };
  }
  const semAcento = chave
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const normalizada = APELIDOS[semAcento] ?? semAcento;

  const encontrada = (CORES_PRODUTO as Record<string, { rotulo: string; hex: string } | undefined>)[
    normalizada
  ];
  if (!encontrada) {
    return { chave, ...COR_DESCONHECIDA, desconhecida: true };
  }
  return { chave: normalizada, rotulo: encontrada.rotulo, hex: encontrada.hex, desconhecida: false };
}

/**
 * Cor de contorno para o swatch.
 *
 * Marfim sobre fundo branco desaparece sem um contorno; preto sobre fundo
 * branco não precisa de nenhum. Calculado a partir da luminância da própria
 * cor do produto — de novo, sem tocar em token de interface.
 */
export function precisaDeContorno(hex: string): boolean {
  const limpo = hex.replace('#', '');
  const r = Number.parseInt(limpo.slice(0, 2), 16);
  const g = Number.parseInt(limpo.slice(2, 4), 16);
  const b = Number.parseInt(limpo.slice(4, 6), 16);
  // Luminância relativa aproximada (ITU-R BT.601), suficiente para decidir contorno.
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.85;
}

/** Lista para montar seletor de cor no cadastro de produto. */
export function listarCoresProduto(): CorProduto[] {
  return Object.entries(CORES_PRODUTO).map(([chave, valor]) => ({
    chave,
    rotulo: valor.rotulo,
    hex: valor.hex,
    desconhecida: false,
  }));
}
