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
  CatmullRomCurve3,
  CubicBezierCurve3,
  CurvePath,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Group,
} from 'three';
import { CONTORNO, pontoDaEspiral, pontosDaEspiral } from './formaDaMarca.js';

/**
 * Espessura do traço, em raio.
 *
 * Na marca impressa o traço tem ~4% da largura do botão, e o tubo respeita
 * isso: 0,026 de raio dá 4,3%. A diferença é a licença que o volume pede para
 * o traço não sumir quando a peça vira de lado. Um tubo mais gordo (0,055,
 * como começou) engorda a marca em mais do dobro e a descaracteriza.
 *
 * O valor acompanha a LARGURA do botão: ao estreitá-lo, o mesmo raio pesa
 * mais e precisa encolher junto.
 */
const RAIO_DO_TRACO = 0.026;

/**
 * A espiral fica um passo à frente do contorno.
 *
 * De frente não muda nada — é o mesmo símbolo. Ao girar, a separação é o que
 * transforma dois desenhos sobrepostos em duas camadas de verdade.
 */
const AVANCO_DA_ESPIRAL = 0.045;

function contornoEmTubo(): TubeGeometry {
  const caminho = new CurvePath<Vector3>();
  for (const s of CONTORNO) {
    caminho.add(
      new CubicBezierCurve3(
        new Vector3(s.de.x, s.de.y, 0),
        new Vector3(s.controle1.x, s.controle1.y, 0),
        new Vector3(s.controle2.x, s.controle2.y, 0),
        new Vector3(s.para.x, s.para.y, 0),
      ),
    );
  }
  // `closed` faz o tubo emendar no início sem costura visível nas pontas.
  return new TubeGeometry(caminho, 140, RAIO_DO_TRACO, 10, true);
}

function espiralEmTubo(): TubeGeometry {
  const pontos = pontosDaEspiral(90).map((p) => new Vector3(p.x, p.y, 0));
  // Catmull-Rom passa por todos os pontos amostrados; com 90 deles a curva
  // reconstruída é indistinguível da espiral original.
  const curva = new CatmullRomCurve3(pontos, false, 'catmullrom', 0.5);
  return new TubeGeometry(curva, 170, RAIO_DO_TRACO, 10, false);
}

const GEOMETRIA_CONTORNO = contornoEmTubo();
const GEOMETRIA_ESPIRAL = espiralEmTubo();
/** Ponta arredondada: sem ela, a espiral termina num corte reto e seco. */
const GEOMETRIA_PONTA = new SphereGeometry(RAIO_DO_TRACO, 10, 8);

const PONTA_DE_DENTRO = pontoDaEspiral(0);
const PONTA_DE_FORA = pontoDaEspiral(1);

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
    <group ref={grupo} scale={1.25}>
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
