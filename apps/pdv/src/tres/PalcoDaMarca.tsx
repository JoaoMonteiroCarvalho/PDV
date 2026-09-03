/**
 * O símbolo da loja sem 3D.
 *
 * Vale aqui a mesma regra do `PalcoEstatico`: isto não é tela de erro. Aparece
 * quando o computador não tem WebGL, quando a operadora desligou os efeitos em
 * Configurações, e enquanto a cena carrega. Quem nunca viu a versão em 3D não
 * percebe que está vendo a alternativa — é a marca, desenhada a traço, que é
 * exatamente como ela existe no papel.
 *
 * Os dois caminhos vêm de `formaDaMarca.ts`, o mesmo módulo que gera as
 * curvas da cena 3D. Não há um desenho aqui e outro lá.
 */

import { caminhoDaEspiral, caminhoDoContorno } from './formaDaMarca.js';

const LADO = 260;
const CENTRO = { x: LADO / 2, y: LADO / 2 };
/** Meia-altura em pixels. Deixa margem para o traço não encostar na borda. */
const ESCALA = 104;

const CONTORNO = caminhoDoContorno(ESCALA, CENTRO);
const ESPIRAL = caminhoDaEspiral(ESCALA, CENTRO);

export function PalcoDaMarca({ cor, rotulo }: { cor: string; rotulo?: string | undefined }) {
  return (
    <div className="grid size-full place-items-center">
      <div className="flex flex-col items-center gap-6">
        <svg
          width={LADO}
          height={LADO}
          viewBox={`0 0 ${LADO} ${LADO}`}
          fill="none"
          role="img"
          aria-label="Símbolo da loja"
        >
          {/*
            `round` nas duas pontas e nas junções: é o que faz o traço plano
            corresponder ao tubo de seção redonda da cena 3D. Com o padrão
            (`butt`/`miter`), a ponta da espiral sairia cortada em bisel e a
            emenda do contorno teria um esporão.
          */}
          <path
            d={CONTORNO}
            stroke={cor}
            strokeWidth={5.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={ESPIRAL}
            stroke={cor}
            strokeWidth={5.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {rotulo && <p className="text-[13px] text-ink-faint">{rotulo}</p>}
      </div>
    </div>
  );
}
