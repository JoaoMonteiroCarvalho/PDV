/**
 * Ramo dourado — o ornamento da lateral do cartão de login.
 *
 * NADA aqui é desenho novo. As folhas são o contorno do botão de rosa da
 * marca, e as gavinhas são a espiral que vive dentro dele — as duas curvas
 * oficiais, só reposicionadas, giradas e reduzidas. Os caules são o único
 * traço inventado, e existem para ligar as peças.
 *
 * A escolha é deliberada: um ramo comprado de banco de imagens ficaria
 * bonito e não diria nada. Feito com a própria marca, o ornamento repete o
 * símbolo sem repetir o logo — quem olha rápido vê "um ramo", quem olha duas
 * vezes reconhece a rosa em cada folha.
 *
 * É decoração pura: `aria-hidden`, sem texto, sem foco. O leitor de tela
 * pula direto para o formulário.
 */

import { caminhoDaEspiral, caminhoDoContorno } from '../tres/formaDaMarca.js';

/*
 * As duas formas da marca, centradas na origem e com meia-altura 1 — assim
 * cada instância escolhe o próprio tamanho pelo `scale` do transform, sem
 * precisar gerar um caminho por folha.
 */
const NA_ORIGEM = { x: 0, y: 0 };
const FOLHA = caminhoDoContorno(1, NA_ORIGEM);
const GAVINHA = caminhoDaEspiral(1, NA_ORIGEM);

/**
 * Caules. Desenhados à mão, em duas espessuras: o principal desce inteiro
 * pela lateral, os secundários saem dele para dentro do cartão.
 *
 * As curvas mudam de direção duas vezes (S duplo). Um caule de curvatura
 * constante lê como arame dobrado; a alternância é o que dá o movimento de
 * planta.
 */
const CAULE_PRINCIPAL =
  'M 130 448 C 104 392 100 348 118 302 C 136 256 158 226 145 182 ' +
  'C 132 140 100 120 107 80 C 112 50 128 32 125 2';

const CAULES_SECUNDARIOS = [
  'M 118 302 C 92 296 66 282 50 252',
  'M 145 182 C 122 182 96 172 80 148',
  'M 107 80 C 88 74 70 60 62 36',
  'M 122 372 C 140 356 150 336 149 312',
];

interface Peca {
  readonly x: number;
  readonly y: number;
  /** Graus. 0 aponta a ponta da folha para cima. */
  readonly giro: number;
  readonly tamanho: number;
}

/** Folhas ao longo dos caules, alternando os lados para não virar fileira. */
const FOLHAS: readonly Peca[] = [
  { x: 140, y: 420, giro: 32, tamanho: 19 },
  { x: 112, y: 386, giro: -34, tamanho: 16 },
  { x: 106, y: 340, giro: -46, tamanho: 23 },
  { x: 152, y: 332, giro: 30, tamanho: 17 },
  { x: 88, y: 290, giro: -62, tamanho: 20 },
  { x: 152, y: 250, giro: 24, tamanho: 24 },
  { x: 128, y: 214, giro: -20, tamanho: 15 },
  { x: 110, y: 178, giro: -54, tamanho: 21 },
  { x: 146, y: 132, giro: 34, tamanho: 18 },
  { x: 94, y: 120, giro: -70, tamanho: 15 },
  { x: 132, y: 78, giro: 26, tamanho: 16 },
  { x: 116, y: 42, giro: -28, tamanho: 20 },
];

/** Gavinhas nas pontas dos caules secundários — onde o ramo "termina". */
const GAVINHAS: readonly Peca[] = [
  { x: 50, y: 252, giro: 0, tamanho: 17 },
  { x: 62, y: 36, giro: 140, tamanho: 12 },
  { x: 80, y: 148, giro: -60, tamanho: 11 },
  { x: 149, y: 312, giro: 200, tamanho: 13 },
];

/**
 * Folha é mais ESTREITA que o botão de rosa, e de propósito.
 *
 * O símbolo tem 0,70 de meia-largura para 1 de meia-altura — cheio, porque
 * é um botão fechado. Nessa proporção, reduzido a 15px, ele lê como pétala
 * gorda e não como folha. Comprimido no eixo x fica esguio e pontudo, que é
 * o que uma folha é.
 *
 * Isto NÃO é distorcer a marca: o símbolo continua intacto no medalhão, no
 * cabeçalho e na peça 3D. Aqui ele é a origem de um motivo decorativo, não
 * uma aplicação do logo — a diferença entre citar uma forma e usar o logo
 * espremido.
 */
const ACHATAMENTO_DA_FOLHA = 0.58;

function transformar(p: Peca, achatar = false): string {
  const largura = achatar ? p.tamanho * ACHATAMENTO_DA_FOLHA : p.tamanho;
  return `translate(${p.x} ${p.y}) rotate(${p.giro}) scale(${largura} ${p.tamanho})`;
}

export function OrnamentoFloral({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 170 460"
      className={className}
      fill="none"
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMaxYMid slice"
    >
      <g stroke="var(--realce)" strokeLinecap="round">
        <path d={CAULE_PRINCIPAL} strokeWidth={2.4} />
        {CAULES_SECUNDARIOS.map((d) => (
          <path key={d} d={d} strokeWidth={1.5} />
        ))}

        {/*
          Gavinha com traço fino: ela é a espiral da marca em miniatura, e no
          tamanho em que entra aqui um traço grosso fecharia o miolo dela.
        */}
        {GAVINHAS.map((p) => (
          <path
            key={`${p.x}-${p.y}`}
            d={GAVINHA}
            transform={transformar(p)}
            strokeWidth={0.11}
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: 1.3 }}
          />
        ))}
      </g>

      {/*
        Folha CHEIA, sem contorno. É o que separa folha de gavinha na leitura:
        massa contra linha. Todas em contorno deixariam o ramo com aparência
        de rascunho técnico.
      */}
      {FOLHAS.map((p) => (
        <path
          key={`${p.x}-${p.y}`}
          d={FOLHA}
          transform={transformar(p, true)}
          fill="var(--realce)"
        />
      ))}
    </svg>
  );
}
