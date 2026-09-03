/**
 * A marca da RM, em números.
 *
 * O símbolo é uma rosa desenhada a traço: o botão fechado por fora (o
 * contorno) e as pétalas enroladas por dentro (a espiral).
 *
 * AS DUAS LINHAS ABAIXO SÃO CÓPIA LITERAL de `public/marca/rm-icone-cor.svg`.
 * Não são uma reinterpretação nem um ajuste "que ficou parecido": são os
 * mesmos caracteres que estão no arquivo da identidade, para dar para
 * comparar lado a lado. Uma versão anterior deste arquivo trazia uma curva
 * ajustada a olho contra uma imagem da marca, e ela não batia — o manual diz
 * para não distorcer o símbolo, e a única forma de garantir isso é usar o
 * desenho original.
 *
 * Daqui saem DOIS consumidores, e é por isso que a forma mora num módulo sem
 * three.js e sem React:
 *
 *   - a cena 3D, que transforma cada traço num tubo;
 *   - o palco estático em SVG, para quando não há WebGL.
 *
 * SISTEMA DE COORDENADAS na saída: y para CIMA, origem no centro do símbolo,
 * meia-altura igual a 1 — independente de tamanho, quem desenha escolhe a
 * escala. O SVG inverte o y de volta na hora de emitir o caminho.
 */

const CONTORNO_OFICIAL =
  'M50 22 C 34 30 28 46 34 58 C 39 68 45 73 50 73 C 55 73 61 68 66 58 C 72 46 66 30 50 22 Z';

const ESPIRAL_OFICIAL =
  'M39 60 C 33 52 35 40 47 38 C 58 36 64 46 58 54 C 53 60 44 58 44 50 C 44 45 50 44 53 48';

/**
 * Cor da marca — Vinho Rosé.
 *
 * Não é token de interface nem cor de catálogo: é a identidade. Fica igual
 * nos dois temas, do mesmo jeito que a cor de um produto fica.
 */
export const COR_MARCA = '#7A2E3A';

export interface Ponto {
  readonly x: number;
  readonly y: number;
}

export interface SegmentoCubico {
  readonly de: Ponto;
  readonly controle1: Ponto;
  readonly controle2: Ponto;
  readonly para: Ponto;
}

// ---------------------------------------------------------------------------
// Leitura do desenho oficial
// ---------------------------------------------------------------------------

/**
 * Onde fica o símbolo dentro do sistema de coordenadas do arquivo original.
 *
 * O contorno vai de y=22 (ponta de cima) a y=73 (base) e é simétrico em
 * torno de x=50. Estes três números são o que converte o desenho da marca
 * para a forma normalizada — e são a ÚNICA coisa aqui que não veio copiada
 * do arquivo, por isso ficam à vista.
 */
const EIXO_X = 50;
const CENTRO_Y = 47.5;
const MEIA_ALTURA = 25.5;

/**
 * Lê um `d` de SVG restrito ao que a marca usa: um `M`, uma sequência de `C`
 * e um `Z` opcional.
 *
 * Não é um interpretador de SVG — é de propósito. Aceitar arcos, curvas
 * relativas e comandos abreviados exigiria um interpretador de verdade para
 * ler duas linhas que nunca mudam; e se um dia a marca trouxer um comando
 * novo, é melhor quebrar aqui, alto e claro, do que desenhar errado calado.
 */
function lerCaminho(d: string): SegmentoCubico[] {
  const numeros = (trecho: string): number[] =>
    trecho
      .trim()
      .split(/[\s,]+/)
      .filter((parte) => parte.length > 0)
      .map(Number);

  const comandos = d.trim().match(/[MCZ][^MCZ]*/gi);
  if (!comandos) throw new Error(`Caminho da marca ilegível: ${d}`);

  const segmentos: SegmentoCubico[] = [];
  let atual: Ponto | null = null;

  for (const comando of comandos) {
    const tipo = comando[0]!.toUpperCase();
    const valores = numeros(comando.slice(1));

    if (tipo === 'M') {
      if (valores.length !== 2) throw new Error(`"M" com ${valores.length} números: ${comando}`);
      atual = normalizar({ x: valores[0]!, y: valores[1]! });
    } else if (tipo === 'C') {
      if (!atual) throw new Error('Caminho da marca começa sem "M".');
      if (valores.length !== 6) throw new Error(`"C" com ${valores.length} números: ${comando}`);
      const controle1 = normalizar({ x: valores[0]!, y: valores[1]! });
      const controle2 = normalizar({ x: valores[2]!, y: valores[3]! });
      const para = normalizar({ x: valores[4]!, y: valores[5]! });
      segmentos.push({ de: atual, controle1, controle2, para });
      atual = para;
    }
    // "Z" não vira segmento: no contorno oficial o último `C` já termina no
    // ponto inicial, então fechar seria empilhar um segmento de comprimento
    // zero — e um tubo de comprimento zero estoura a geometria no three.js.
  }

  if (segmentos.length === 0) throw new Error(`Caminho da marca sem curvas: ${d}`);
  return segmentos;
}

/** Do sistema do arquivo (y para baixo) para o nosso (y para cima, centrado). */
function normalizar(p: Ponto): Ponto {
  return {
    x: (p.x - EIXO_X) / MEIA_ALTURA,
    y: (CENTRO_Y - p.y) / MEIA_ALTURA,
  };
}

export const CONTORNO: readonly SegmentoCubico[] = lerCaminho(CONTORNO_OFICIAL);
export const ESPIRAL: readonly SegmentoCubico[] = lerCaminho(ESPIRAL_OFICIAL);

// ---------------------------------------------------------------------------
// Medidas derivadas
// ---------------------------------------------------------------------------

function avaliar(s: SegmentoCubico, t: number): Ponto {
  const u = 1 - t;
  const eixo = (a: number, b: number, c: number, d: number) =>
    u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d;
  return {
    x: eixo(s.de.x, s.controle1.x, s.controle2.x, s.para.x),
    y: eixo(s.de.y, s.controle1.y, s.controle2.y, s.para.y),
  };
}

/** Amostra qualquer caminho em pontos, para medir ou para desenhar. */
export function amostrar(
  segmentos: readonly SegmentoCubico[],
  porSegmento = 48,
): Ponto[] {
  const pontos: Ponto[] = [];
  for (const s of segmentos) {
    for (let i = 0; i <= porSegmento; i += 1) pontos.push(avaliar(s, i / porSegmento));
  }
  return pontos;
}

/**
 * Meia-largura do símbolo, com meia-altura = 1. Medida, não declarada: sai da
 * própria curva oficial, então continua certa se o desenho mudar.
 */
export const MEIA_LARGURA = Math.max(...amostrar(CONTORNO, 96).map((p) => Math.abs(p.x)));

/** As duas pontas soltas da espiral, onde a cena 3D arredonda o traço. */
export const PONTA_DE_DENTRO: Ponto = ESPIRAL[ESPIRAL.length - 1]!.para;
export const PONTA_DE_FORA: Ponto = ESPIRAL[0]!.de;

// ---------------------------------------------------------------------------
// Saída em SVG
// ---------------------------------------------------------------------------

/**
 * Volta para o sistema do SVG: y cresce para baixo, origem no canto.
 *
 * `escala` é a meia-altura em pixels; `centro` é onde o centro do símbolo cai
 * dentro do viewBox.
 */
function paraSvg(p: Ponto, escala: number, centro: Ponto): string {
  return `${(centro.x + p.x * escala).toFixed(2)} ${(centro.y - p.y * escala).toFixed(2)}`;
}

function caminho(
  segmentos: readonly SegmentoCubico[],
  escala: number,
  centro: Ponto,
  fechar: boolean,
): string {
  const partes = [`M ${paraSvg(segmentos[0]!.de, escala, centro)}`];
  for (const s of segmentos) {
    partes.push(
      `C ${paraSvg(s.controle1, escala, centro)}, ${paraSvg(s.controle2, escala, centro)}, ${paraSvg(s.para, escala, centro)}`,
    );
  }
  if (fechar) partes.push('Z');
  return partes.join(' ');
}

export function caminhoDoContorno(escala: number, centro: Ponto): string {
  return caminho(CONTORNO, escala, centro, true);
}

export function caminhoDaEspiral(escala: number, centro: Ponto): string {
  return caminho(ESPIRAL, escala, centro, false);
}
