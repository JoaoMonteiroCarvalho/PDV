/**
 * O símbolo da loja em 3D — o objeto do login.
 *
 * A marca é uma rosa desenhada a traço, e a tradução para 3D respeita isso:
 * cada traço
 * vira um TUBO de seção redonda, como um arame dobrado. Não é extrusão de
 * área preenchida, que engrossaria a marca e mudaria o desenho; de frente, o
 * que se vê é exatamente o símbolo, e é só ao girar que ele revela volume.
 *
 * A forma vem de `formaDaMarca.ts`, o mesmo módulo que alimenta a versão
 * em SVG — os dois nunca divergem.
 *
 * CUSTO (isto fica aberto o dia todo num mini-PC de loja):
 *
 *   contorno   140 seg. × 10 lados × 2 =  2.800 triângulos
 *   espiral    170 seg. × 10 lados × 2 =  3.400 triângulos
 *   2 pontas        esferas 10×8       =    ~320 triângulos
 *                                        -----------------
 *                                         ~6.520 triângulos
 *
 * Uma peça só na tela, contra as 20 miniaturas do catálogo — por isso aqui
 * cabe detalhe que lá não caberia. As geometrias são construídas UMA vez, no
 * nível do módulo: a cena remonta a cada visita ao login e reconstruí-las
 * toda vez seria desperdício puro.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import {
  CubicBezierCurve3,
  CurvePath,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Group,
} from 'three';
import {
  CONTORNO,
  ESPIRAL,
  PONTA_DE_DENTRO,
  PONTA_DE_FORA,
  type SegmentoCubico,
} from './formaDaMarca.js';

/**
 * Espessura do traço, em raio.
 *
 * No arquivo oficial o traço tem 3,2 unidades para um símbolo de 51 de
 * altura — ou seja, 6,3% da meia-altura. Aqui o raio é 0,03, o que dá 6,0%
 * de diâmetro: praticamente o mesmo peso, com a folga que o volume pede para
 * o traço não sumir quando a peça vira de lado.
 */
const RAIO_DO_TRACO = 0.03;

/**
 * A espiral fica um passo à frente do contorno.
 *
 * De frente não muda nada — é o mesmo símbolo. Ao girar, a separação é o que
 * transforma dois desenhos sobrepostos em duas camadas de verdade.
 */
const AVANCO_DA_ESPIRAL = 0.045;

/**
 * Monta as cúbicas oficiais como um caminho contínuo do three.js.
 *
 * As curvas entram exatamente como estão no arquivo da marca — sem
 * reamostrar e sem suavizar. Uma versão anterior reconstruía a espiral por
 * Catmull-Rom sobre pontos amostrados, o que só fazia sentido quando ela era
 * gerada por fórmula; com o desenho oficial em mãos, aproximar seria trocar
 * o original por uma cópia pior.
 */
function emTubo(
  segmentos: readonly SegmentoCubico[],
  divisoes: number,
  fechado: boolean,
): TubeGeometry {
  const caminho = new CurvePath<Vector3>();
  for (const s of segmentos) {
    caminho.add(
      new CubicBezierCurve3(
        new Vector3(s.de.x, s.de.y, 0),
        new Vector3(s.controle1.x, s.controle1.y, 0),
        new Vector3(s.controle2.x, s.controle2.y, 0),
        new Vector3(s.para.x, s.para.y, 0),
      ),
    );
  }
  return new TubeGeometry(caminho, divisoes, RAIO_DO_TRACO, 10, fechado);
}

// `closed` no contorno faz o tubo emendar no início sem costura nas pontas.
const GEOMETRIA_CONTORNO = emTubo(CONTORNO, 140, true);
const GEOMETRIA_ESPIRAL = emTubo(ESPIRAL, 170, false);
/** Ponta arredondada: sem ela, a espiral termina num corte reto e seco. */
const GEOMETRIA_PONTA = new SphereGeometry(RAIO_DO_TRACO, 10, 8);

/** Segundos de apresentação antes de a peça parar sozinha. */
const DURACAO_APRESENTACAO = 4.5;
/** De onde parte e onde repousa a apresentação. */
const ANGULO_INICIAL = -0.95;
const ANGULO_FINAL = 0.34;

interface Props {
  readonly cor: string;
  /** Chamado quando a apresentação termina: o pai desliga o loop de render. */
  readonly aoRepousar?: () => void;
  /** true enquanto a operadora arrasta: a apresentação cede o controle. */
  readonly interagindo: boolean;
}

export function MarcaDaLoja({ cor, aoRepousar, interagindo }: Props) {
  const grupo = useRef<Group>(null);
  const decorrido = useRef(0);
  const repousou = useRef(false);

  useFrame((_, delta) => {
    if (!grupo.current || repousou.current) return;

    if (interagindo) {
      repousou.current = true;
      aoRepousar?.();
      return;
    }

    decorrido.current += delta;
    const t = Math.min(decorrido.current / DURACAO_APRESENTACAO, 1);
    const suavizado = 1 - (1 - t) ** 3;

    /*
     * Um quarto de volta, não uma volta inteira.
     *
     * A caixinha girava 360° porque uma caixa tem quatro lados para mostrar.
     * O símbolo é chapado: a meio caminho de uma volta completa ele ficaria
     * de perfil e sumiria, e a marca da loja piscaria para fora da tela na
     * primeira coisa que a operadora vê no dia. Aqui ele apenas se vira para
     * a frente e para.
     */
    grupo.current.rotation.y = ANGULO_INICIAL + suavizado * (ANGULO_FINAL - ANGULO_INICIAL);

    if (t >= 1) {
      repousou.current = true;
      aoRepousar?.();
    }
  });

  return (
    /*
     * A peça sobe e encolhe para dar lugar ao wordmark no rodapé do palco.
     * O símbolo oficial é mais largo que a versão anterior, e na escala antiga
     * a base dele encostava em "RM MODA ÍNTIMA" — o manual pede respiro em
     * volta da marca, e texto colado é o oposto disso.
     */
    <group ref={grupo} scale={0.92} position={[0, 0.28, 0]}>
      <mesh geometry={GEOMETRIA_CONTORNO}>
        <meshStandardMaterial color={cor} roughness={0.45} metalness={0} />
      </mesh>

      <group position={[0, 0, AVANCO_DA_ESPIRAL]}>
        <mesh geometry={GEOMETRIA_ESPIRAL}>
          <meshStandardMaterial color={cor} roughness={0.45} metalness={0} />
        </mesh>

        <mesh geometry={GEOMETRIA_PONTA} position={[PONTA_DE_DENTRO.x, PONTA_DE_DENTRO.y, 0]}>
          <meshStandardMaterial color={cor} roughness={0.45} metalness={0} />
        </mesh>
        <mesh geometry={GEOMETRIA_PONTA} position={[PONTA_DE_FORA.x, PONTA_DE_FORA.y, 0]}>
          <meshStandardMaterial color={cor} roughness={0.45} metalness={0} />
        </mesh>
      </group>
    </group>
  );
}
