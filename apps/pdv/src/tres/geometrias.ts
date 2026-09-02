/**
 * Geometrias e materiais COMPARTILHADOS.
 *
 * O problema que este arquivo resolve foi medido, não suposto:
 *
 *   RoundedBox smoothness=3  ->  588 triângulos, e 51,5 ms para construir 60
 *   RoundedBox smoothness=1  ->  108 triângulos, e  8,7 ms para construir 60
 *
 * O catálogo desenha a mesma peça em 20 cards. Sem compartilhar, cada card
 * construía as próprias lâminas: 60 geometrias, 35.280 triângulos, e 51 ms de
 * CPU — três frames perdidos — TODA vez que cards entram na tela ao rolar. Numa
 * máquina de balcão isso é a diferença entre rolar liso e rolar aos trancos.
 *
 * Aqui as geometrias são construídas UMA vez, na carga do módulo, e todos os
 * cards apontam para os mesmos objetos. 60 construções viram 3, para sempre.
 *
 * Dois níveis de detalhe, porque o tamanho na tela é diferente:
 *   - `alto`  (consulta, login, confirmação): uma peça, 300 px, vale o detalhe.
 *   - `baixo` (cards do catálogo): 132 px, onde smoothness 3 e 1 são
 *     visualmente iguais e a diferença é 5× em triângulos.
 *
 * ATENÇÃO ao usar: o R3F descarta geometria e material ao desmontar o mesh.
 * Como estes são compartilhados, o primeiro card a sair da tela destruiria os
 * objetos dos outros — que passariam a não renderizar. Por isso todo mesh que
 * usa este módulo precisa de `dispose={null}`. Ver `PecaAbstrata`.
 */

import { BoxGeometry, CylinderGeometry, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';

export type NivelDeDetalhe = 'alto' | 'baixo';

/** Suavidade do canto por nível. Em 132 px, 1 e 3 são indistinguíveis. */
const SUAVIDADE: Record<NivelDeDetalhe, number> = { alto: 3, baixo: 1 };
/** Segmentos do cilindro. 24 numa peça de 132 px é resolução jogada fora. */
const SEGMENTOS: Record<NivelDeDetalhe, number> = { alto: 24, baixo: 10 };

function laminas(nivel: NivelDeDetalhe) {
  const s = SUAVIDADE[nivel];
  return {
    base: new RoundedBoxGeometry(2.1, 0.26, 1.5, s, 0.12),
    meio: new RoundedBoxGeometry(2.0, 0.24, 1.42, s, 0.11),
    topo: new RoundedBoxGeometry(1.88, 0.22, 1.34, s, 0.1),
  };
}

function frasco(nivel: NivelDeDetalhe) {
  const seg = SEGMENTOS[nivel];
  return {
    corpo: new CylinderGeometry(0.52, 0.58, 1.0, seg),
    ombro: new CylinderGeometry(0.2, 0.52, 0.18, seg),
    gargalo: new CylinderGeometry(0.16, 0.16, 0.16, Math.max(8, seg - 4)),
    tampa: new RoundedBoxGeometry(0.42, 0.34, 0.42, SUAVIDADE[nivel], 0.06),
  };
}

function bloco(nivel: NivelDeDetalhe) {
  return new RoundedBoxGeometry(1.6, 1.1, 1.0, SUAVIDADE[nivel], 0.1);
}

/**
 * Construídas na carga do módulo — e o módulo só é carregado quando uma cena
 * 3D monta, porque tudo aqui entra pelo chunk lazy do Three.
 */
export const GEOMETRIAS = {
  alto: { laminas: laminas('alto'), frasco: frasco('alto'), bloco: bloco('alto') },
  baixo: { laminas: laminas('baixo'), frasco: frasco('baixo'), bloco: bloco('baixo') },
} as const;

/**
 * Materiais por cor, criados sob demanda e reaproveitados.
 *
 * O catálogo tem uma dúzia de cores; sem cache seriam 60 materiais para 12
 * tons. O mapa é limitado pelo tamanho da paleta, não pelo número de cards.
 */
const materiaisBaixo = new Map<string, MeshLambertMaterial>();
const materiaisAlto = new Map<string, MeshStandardMaterial>();

/**
 * Card usa Lambert; peça grande usa Standard.
 *
 * Lambert tem shader bem mais barato que o Standard (que é PBR completo). Em
 * tecido fosco, a 132 px, a diferença não aparece — o que aparece é o custo
 * de fragment shader multiplicado por 20 viewports numa GPU integrada.
 */
export function materialDaPeca(cor: string, nivel: NivelDeDetalhe) {
  if (nivel === 'baixo') {
    let material = materiaisBaixo.get(cor);
    if (!material) {
      material = new MeshLambertMaterial({ color: cor });
      materiaisBaixo.set(cor, material);
    }
    return material;
  }

  let material = materiaisAlto.get(cor);
  if (!material) {
    material = new MeshStandardMaterial({ color: cor, roughness: 0.74, metalness: 0 });
    materiaisAlto.set(cor, material);
  }
  return material;
}

/** Tampa do frasco: tom neutro fixo, nunca a cor do produto. */
export const COR_TAMPA = '#4a4a4f';

/** Só para teste: quantos materiais o cache guarda. */
export function materiaisEmCache(): number {
  return materiaisBaixo.size + materiaisAlto.size;
}

/**
 * Descarta tudo. Não é usado pelo app — os objetos vivem enquanto o Three
 * estiver carregado, que é o comportamento certo para um conjunto fixo e
 * pequeno. Existe para o teste não vazar entre casos.
 */
export function descartarTudo(): void {
  for (const nivel of ['alto', 'baixo'] as const) {
    const conjunto = GEOMETRIAS[nivel];
    Object.values(conjunto.laminas).forEach((geometria) => geometria.dispose());
    Object.values(conjunto.frasco).forEach((geometria) => geometria.dispose());
    conjunto.bloco.dispose();
  }
  materiaisBaixo.forEach((material) => material.dispose());
  materiaisAlto.forEach((material) => material.dispose());
  materiaisBaixo.clear();
  materiaisAlto.clear();
}

/** Só para teste: contagem de triângulos de uma geometria. */
export function triangulosDe(geometria: BoxGeometry | CylinderGeometry | RoundedBoxGeometry): number {
  const indice = geometria.getIndex();
  const posicoes = geometria.getAttribute('position');
  return (indice ? indice.count : posicoes.count) / 3;
}
