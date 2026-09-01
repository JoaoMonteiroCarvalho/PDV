/**
 * Gráfico de barras em SVG puro.
 *
 * Sem biblioteca: um gráfico de barras é meia dúzia de retângulos, e trazer
 * 100 kB de dependência para desenhá-los num app que precisa abrir rápido num
 * mini-PC não se paga.
 *
 * E sem 3D, por decisão de projeto. Barra em perspectiva é o exemplo clássico
 * de gráfico que engana: a face frontal fica mais baixa que o topo real, e
 * comparar duas barras vira adivinhação. Num relatório de faturamento isso não
 * é enfeite ruim, é número errado.
 *
 * Acessibilidade: o SVG é `aria-hidden` e os mesmos dados aparecem numa tabela
 * visualmente oculta logo abaixo. Quem usa leitor de tela recebe os valores,
 * não "gráfico".
 */

import { formatarBRL, centavos } from '@pdv/shared';

export interface BarraDoGrafico {
  readonly rotulo: string;
  readonly rotuloCompleto: string;
  readonly valorCentavos: number;
}

const ALTURA = 160;
const LARGURA_BARRA = 28;
const ESPACO = 10;

export function GraficoBarras({
  barras,
  titulo,
}: {
  barras: readonly BarraDoGrafico[];
  titulo: string;
}) {
  if (barras.length === 0) {
    return (
      <p className="py-10 text-center text-[14px] text-ink-faint">
        Sem movimento no período.
      </p>
    );
  }

  const maior = Math.max(...barras.map((barra) => barra.valorCentavos), 1);
  const largura = barras.length * (LARGURA_BARRA + ESPACO);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${largura} ${ALTURA + 24}`}
          width={largura}
          height={ALTURA + 24}
          aria-hidden
          className="max-w-full"
        >
          {barras.map((barra, indice) => {
            /*
             * Altura proporcional ao valor, começando do ZERO. Cortar o eixo
             * para "destacar a diferença" faz duas barras parecerem o dobro
             * uma da outra quando a diferença é de 3% — é a mentira mais comum
             * em gráfico de vendas.
             */
            const alturaBarra = Math.max(1, (barra.valorCentavos / maior) * ALTURA);
            const x = indice * (LARGURA_BARRA + ESPACO);

            return (
              <g key={barra.rotulo}>
                <rect
                  x={x}
                  y={ALTURA - alturaBarra}
                  width={LARGURA_BARRA}
                  height={alturaBarra}
                  rx={4}
                  fill="var(--accent)"
                />
                <text
                  x={x + LARGURA_BARRA / 2}
                  y={ALTURA + 16}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--ink-faint)"
                >
                  {barra.rotulo}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/*
        Os mesmos números em tabela, oculta visualmente. O gráfico é para bater
        o olho; isto é o que um leitor de tela lê, e o que alguém copia.
      */}
      <table className="sr-only">
        <caption>{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">Período</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {barras.map((barra) => (
            <tr key={barra.rotulo}>
              <th scope="row">{barra.rotuloCompleto}</th>
              <td>{formatarBRL(centavos(barra.valorCentavos))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
