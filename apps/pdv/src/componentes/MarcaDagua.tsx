/**
 * A rosa da marca em marca d'água, para o fundo de uma área vazia.
 *
 * Mesmo traço do símbolo oficial — as duas curvas de `formaDaMarca`, sem
 * reinterpretação. É o mesmo raciocínio do ramo do login: quando a tela pede
 * presença, usar a própria marca em vez de um enfeite genérico.
 *
 * NÃO define cor nem opacidade. O traço sai em `currentColor` e quem usa
 * decide as duas coisas pelo contexto — uma marca d'água que se pinta sozinha
 * é a que aparece forte demais no tema errado.
 *
 * Decoração pura: `aria-hidden`, sem rótulo, fora da ordem de foco. O leitor
 * de tela não anuncia papel de parede.
 */

import { caminhoDaEspiral, caminhoDoContorno } from '../tres/formaDaMarca.js';

const NA_ORIGEM = { x: 0, y: 0 };
const CONTORNO = caminhoDoContorno(1, NA_ORIGEM);
const ESPIRAL = caminhoDaEspiral(1, NA_ORIGEM);

/**
 * Espessura do traço, na proporção do arquivo oficial.
 *
 * Lá o traço tem 2,13 para uma meia-altura de 25,5 — ou seja, 0,0835 na forma
 * normalizada. Engrossar aqui para "aparecer melhor" no fundo seria resolver
 * opacidade com peso e devolver uma rosa que não é a da loja; quem controla a
 * presença é a opacidade de quem usa.
 */
const ESPESSURA = 0.0835;

export function MarcaDagua({ className }: { className?: string }) {
  return (
    <svg
      // Meia-altura 1 e meia-largura ~0,70, com folga para o traço não ser
      // cortado nas pontas.
      viewBox="-0.85 -1.12 1.7 2.24"
      className={className}
      fill="none"
      aria-hidden
      focusable="false"
    >
      <g
        stroke="currentColor"
        strokeWidth={ESPESSURA}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={CONTORNO} />
        <path d={ESPIRAL} />
      </g>
    </svg>
  );
}
