/**
 * A caixinha da marca — o objeto do login.
 *
 * Forma abstrata e geométrica de propósito: uma embalagem, nunca um corpo
 * humano estilizado. Numa loja de moda íntima, um manequim realista na tela
 * de abertura seria constrangedor com a cliente do outro lado do balcão.
 *
 * Custo deliberadamente baixo — isto roda o dia inteiro num mini-PC:
 *   - primitivas simples, sem malha importada e sem textura;
 *   - material padrão com um pouco de rugosidade, sem reflexo de ambiente;
 *   - nenhuma sombra projetada (a sombra é um disco borrado no chão).
 */

// Import cirurgico: o indice do drei puxa a biblioteca inteira (centenas de
// modulos) e estourava a memoria do Node no build e no dev server.
import { RoundedBox } from '@react-three/drei/core/RoundedBox.js';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';

/** Segundos de rotação de apresentação antes de a peça parar sozinha. */
const DURACAO_APRESENTACAO = 5.5;
/** Onde a peça repousa: levemente virada, para ler como volume e não como quadrado. */
const ANGULO_FINAL = Math.PI * 0.22;

interface Props {
  /** Cor da embalagem — vem do catálogo, nunca do tema da interface. */
  readonly cor: string;
  readonly corFita: string;
  /** Chamado quando a apresentação termina: o pai desliga o loop de render. */
  readonly aoRepousar?: () => void;
  /** true quando a operadora está arrastando: a apresentação cede o controle. */
  readonly interagindo: boolean;
}

export function CaixaDaMarca({ cor, corFita, aoRepousar, interagindo }: Props) {
  const grupo = useRef<Group>(null);
  const decorrido = useRef(0);
  const repousou = useRef(false);

  useFrame((_, delta) => {
    if (!grupo.current || repousou.current) return;

    // Arrastar assume o controle: a rotação automática nunca briga com a mão.
    if (interagindo) {
      repousou.current = true;
      aoRepousar?.();
      return;
    }

    decorrido.current += delta;
    const t = Math.min(decorrido.current / DURACAO_APRESENTACAO, 1);

    // easeOutCubic: começa no ritmo e desacelera até parar — sem freada seca.
    const suavizado = 1 - (1 - t) ** 3;
    grupo.current.rotation.y = suavizado * (Math.PI * 2 + ANGULO_FINAL);

    if (t >= 1) {
      repousou.current = true;
      aoRepousar?.();
    }
  });

  return (
    <group ref={grupo}>
      {/* Corpo da caixa */}
      <RoundedBox args={[2, 1.15, 1.45]} radius={0.09} smoothness={4} castShadow={false}>
        <meshStandardMaterial color={cor} roughness={0.62} metalness={0.02} />
      </RoundedBox>

      {/* Tampa, ligeiramente maior e deslocada — dá a leitura de "embalagem" */}
      <RoundedBox
        args={[2.06, 0.22, 1.51]}
        radius={0.07}
        smoothness={4}
        position={[0, 0.6, 0]}
      >
        <meshStandardMaterial color={cor} roughness={0.55} metalness={0.02} />
      </RoundedBox>

      {/*
        Fita: UMA faixa só, o único acento de cor da cena.

        As medidas importam. Ela vai de y=-0.585 (raspando o fundo do corpo)
        a y=+0.72 (raspando o topo da tampa) e é ligeiramente mais funda que
        a tampa, para ENVOLVER a caixa por fora. Antes ela era mais alta que
        a peça e atravessava o fundo, parecendo uma barra espetada.
      */}
      <mesh position={[0, 0.0675, 0]}>
        <boxGeometry args={[0.17, 1.305, 1.53]} />
        <meshStandardMaterial color={corFita} roughness={0.45} />
      </mesh>
    </group>
  );
}
