/**
 * O símbolo da loja, em números.
 *
 * A marca é um traço só: uma ROSA — o botão fechado por fora (o contorno) e as
 * pétalas enroladas por dentro (a espiral). Este módulo guarda a GEOMETRIA dela — sem three.js, sem React —
 * porque a mesma forma precisa sair em dois lugares:
 *
 *   - na cena 3D, como curvas que viram tubos;
 *   - no palco estático em SVG, quando não há WebGL.
 *
 * Se cada um desenhasse a sua versão, um dia alguém ajustaria a curva de um
 * e não do outro, e a loja passaria a ter dois símbolos ligeiramente
 * diferentes dependendo do computador. Por isso a definição mora aqui e os
 * dois consomem daqui.
 *
 * SISTEMA DE COORDENADAS: y para CIMA, origem no centro do botão, meia-altura
 * igual a 1. Assim a forma é independente do tamanho — quem desenha escolhe a
 * escala. O SVG inverte o y na hora de emitir o caminho, porque lá o eixo
 * cresce para baixo.
 */

/**
 * Meia-largura, com meia-altura = 1.
 *
 * O símbolo é uma ROSA — um botão fechado, visto de lado, com as pétalas
 * enroladas no miolo. Isso rege a proporção: botão é estreito. A primeira
 * versão saiu em 0,727 e lia como folha aberta; 0,60 fecha a silhueta.
 */
export const MEIA_LARGURA = 0.6;

/**
 * Cor da marca.
 *
 * Não é token de interface nem cor de catálogo — é a identidade da loja, e
 * por isso não muda com o tema nem com o cadastro de produto. Fica fixa nos
 * dois temas, do mesmo jeito que a cor de um produto fica.
 */
export const COR_MARCA = '#7B2D3B';

export interface Ponto {
  readonly x: number;
  readonly y: number;
}

interface SegmentoCubico {
  readonly de: Ponto;
  readonly controle1: Ponto;
  readonly controle2: Ponto;
  readonly para: Ponto;
}

const w = MEIA_LARGURA;

/**
 * Contorno do botão: quatro cúbicas, duas por lado, espelhadas.
 *
 * Duas por lado em vez de uma porque os dois extremos precisam ser
 * controlados separadamente. Com uma cúbica só, deixar a ponta de cima
 * afiada achatava a lateral, e encher a lateral arredondava a ponta.
 *
 * A silhueta resultante, em meia-largura por altura:
 *
 *      0,705   0,470        largura máxima em -0,05,
 *      0,455   0,717        logo abaixo do meio
 *      0,195   0,900
 *     -0,065   1,000
 *     -0,325   0,933
 *     -0,584   0,762
 *     -0,844   0,440
 *
 * As laterais são CHEIAS — a curva sobe rápido e se mantém larga por quase
 * toda a altura, fechando só nas duas pontas. Somado à largura pequena, é o
 * que faz ler como botão fechado e não como folha. O contrário (laterais
 * magras, cheias só no meio) dá um losango, que foi o erro das primeiras
 * tentativas.
 *
 * A ponta de cima fecha em 54° e a de baixo em 74°. Parecem ângulos abertos,
 * mas são medidos numa forma estreita: o que se vê é uma ponta bem definida
 * em cima e uma base arredondada embaixo. Essa diferença entre as duas
 * metades é o que dá direção ao botão — iguais, o desenho fica simétrico e
 * sem eixo.
 *
 * SOBRE QUERER A PONTA MAIS AFIADA: existe um piso geométrico. Numa forma
 * convexa com esta proporção, o triângulo que vai da ponta até a cintura já
 * abre 29,7°; nada convexo fecha menos que isso, e chegar perto do piso
 * obriga as laterais a ficarem retas — vira losango. Ponta afiada e lateral
 * cheia disputam a mesma proporção.
 *
 * No encontro dos dois trechos os apoios ficam ambos em `x = w`: a tangente
 * ali é VERTICAL, o que garante que a largura máxima está exatamente na
 * emenda e que ela não vira um vinco. Tirar qualquer um dos dois de `w`
 * produz um bico visível bem no meio da lateral.
 */
const LADO_DIREITO: readonly SegmentoCubico[] = [
  {
    de: { x: 0, y: 1 },
    controle1: { x: 0.67 * w, y: 0.71 },
    controle2: { x: w, y: 0.075 },
    para: { x: w, y: -0.05 },
  },
  {
    de: { x: w, y: -0.05 },
    controle1: { x: w, y: -0.395 },
    controle2: { x: 0.623 * w, y: -0.895 },
    para: { x: 0, y: -1 },
  },
];

function espelhar(segmento: SegmentoCubico): SegmentoCubico {
  const trocar = (p: Ponto): Ponto => ({ x: -p.x, y: p.y });
  // Invertido também no sentido: o lado esquerdo é percorrido de baixo para
  // cima, fechando o laço. Um contorno que "volta pelo mesmo caminho" faria
  // o tubo se dobrar sobre si mesmo na cena 3D.
  return {
    de: trocar(segmento.para),
    controle1: trocar(segmento.controle2),
    controle2: trocar(segmento.controle1),
    para: trocar(segmento.de),
  };
}

/** O contorno inteiro, em ordem, fechando o laço. */
export const CONTORNO: readonly SegmentoCubico[] = [
  ...LADO_DIREITO,
  ...[...LADO_DIREITO].reverse().map(espelhar),
];

// ---------------------------------------------------------------------------
// Espiral
// ---------------------------------------------------------------------------

/** Onde o miolo da espiral fica, em relação ao centro do botão. */
export const CENTRO_ESPIRAL: Ponto = { x: -0.044, y: -0.03 };
const RAIO_INICIAL = 0.135;
/**
 * O miolo ocupa 76% da meia-largura do botão.
 *
 * Sobra pouca margem de propósito: pétalas enroladas preenchem o botão, não
 * flutuam no meio dele. Com o envelope estreitado, um miolo pequeno deixava
 * um vazio em cima e embaixo que não existe numa rosa.
 */
const RAIO_FINAL = 0.454;

/**
 * Aperto do miolo.
 *
 * Com o raio crescendo por igual (expoente 1), a espiral vira um caracol:
 * voltas igualmente espaçadas, uma geometria. As pétalas de uma rosa não são
 * assim — elas se apertam no centro e vão abrindo para fora. O expoente 1,35
 * empilha as primeiras voltas perto do miolo e alarga as últimas, e é o que
 * transforma o caracol em pétalas enroladas.
 */
const APERTO = 1.35;
/**
 * Voltas e sentido.
 *
 * 1,64 volta no sentido anti-horário coloca a ponta de fora embaixo à
 * esquerda, passando por cima antes — que é o desenho da marca. Fechar duas
 * voltas cheias deixaria as duas pontas alinhadas e a espiral pareceria um
 * caracol simétrico, perdendo o movimento.
 */
const VOLTAS = 1.64;

/**
 * A espiral do miolo. `t` vai de 0 (ponta de dentro) a 1 (ponta de fora).
 *
 * Base de Arquimedes (raio crescendo com o ângulo) com o aperto acima. A
 * logarítmica pura, de concha de náutilo, abre rápido demais e o miolo some —
 * e é justamente o miolo que faz a leitura de rosa.
 */
export function pontoDaEspiral(t: number): Ponto {
  const angulo = t * VOLTAS * Math.PI * 2;
  const raio = RAIO_INICIAL + (RAIO_FINAL - RAIO_INICIAL) * t ** APERTO;
  return {
    x: CENTRO_ESPIRAL.x + Math.cos(angulo) * raio,
    y: CENTRO_ESPIRAL.y + Math.sin(angulo) * raio,
  };
}

/** Amostra a espiral em `passos + 1` pontos. */
export function pontosDaEspiral(passos = 120): Ponto[] {
  const pontos: Ponto[] = [];
  for (let i = 0; i <= passos; i += 1) pontos.push(pontoDaEspiral(i / passos));
  return pontos;
}

// ---------------------------------------------------------------------------
// Saída em SVG
// ---------------------------------------------------------------------------

/**
 * Converte para o sistema do SVG: y cresce para baixo, origem no canto.
 *
 * `escala` é a meia-altura em pixels; `centro` é onde o centro da folha cai
 * dentro do viewBox.
 */
function paraSvg(p: Ponto, escala: number, centro: Ponto): string {
  const x = centro.x + p.x * escala;
  const y = centro.y - p.y * escala;
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

/** O contorno como um `d` de SVG, já fechado. */
export function caminhoDoContorno(escala: number, centro: Ponto): string {
  const partes: string[] = [`M ${paraSvg(CONTORNO[0]!.de, escala, centro)}`];
  for (const s of CONTORNO) {
    partes.push(
      `C ${paraSvg(s.controle1, escala, centro)}, ${paraSvg(s.controle2, escala, centro)}, ${paraSvg(s.para, escala, centro)}`,
    );
  }
  partes.push('Z');
  return partes.join(' ');
}

/**
 * A espiral como um `d` de SVG.
 *
 * Sai como polilinha densa, não como curvas: a espiral é uma função, não um
 * punhado de arcos, e aproximá-la por Bézier daria trabalho para ninguém
 * enxergar a diferença num traço de 3 px.
 */
export function caminhoDaEspiral(escala: number, centro: Ponto, passos = 120): string {
  const pontos = pontosDaEspiral(passos);
  return pontos
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${paraSvg(p, escala, centro)}`)
    .join(' ');
}
