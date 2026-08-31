/**
 * Card de produto com a grade de variação embutida.
 *
 * Este é o componente que resolve o problema mais caro do balcão: a cliente
 * pergunta "tem no GG vinho?" e a operadora precisa responder em segundos. A
 * grade inteira aparece AQUI, no resultado da busca — abrir uma tela por
 * variação transformaria uma pergunta de dois segundos em quatro cliques.
 *
 * Três estados por célula, e a diferença entre eles importa no balcão:
 *
 *   disponível  — tem peça, clique adiciona
 *   esgotado    — a loja vende, mas acabou. "Chega quinta" é uma resposta.
 *   inexistente — a loja não vende essa combinação. "Não trabalhamos" é outra.
 *
 * Tratar os dois últimos como a mesma coisa faz a operadora prometer
 * reposição de algo que nunca vai chegar.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { Link } from 'react-router-dom';
import type { ItemCatalogo } from '../banco/local.js';
import { Cartao, Selo, cx } from '../componentes/base.js';
import { SwatchCor } from '../componentes/SwatchCor.js';
import {
  ehProdutoSimples,
  encontrarVariante,
  situacaoDaCombinacao,
  type ProdutoAgrupado,
  type SituacaoCombinacao,
} from '../catalogo/grade.js';

interface Props {
  readonly produto: ProdutoAgrupado;
  readonly aoAdicionar: (variante: ItemCatalogo) => void;
}

export function CardProduto({ produto, aoAdicionar }: Props) {
  return (
    <Cartao className="flex flex-col gap-3 p-4">
      <Cabecalho produto={produto} />
      {ehProdutoSimples(produto) ? (
        <BotaoSimples produto={produto} aoAdicionar={aoAdicionar} />
      ) : (
        <Grade produto={produto} aoAdicionar={aoAdicionar} />
      )}
    </Cartao>
  );
}

function Cabecalho({ produto }: { produto: ProdutoAgrupado }) {
  const faixa =
    produto.precoMinimoCentavos === produto.precoMaximoCentavos
      ? formatarBRL(centavos(produto.precoMinimoCentavos))
      : `${formatarBRL(centavos(produto.precoMinimoCentavos))} – ${formatarBRL(centavos(produto.precoMaximoCentavos))}`;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-titulo text-[15px] font-medium text-ink">{produto.nome}</p>
        <p className="truncate text-[13px] text-ink-faint">
          {[produto.marca, produto.categoria].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="num text-[15px] font-medium text-ink">{faixa}</p>
        {produto.saldoTotal === 0 && (
          <span className="text-[12px] text-alerta">Sem peças</span>
        )}
        {/*
          Caminho para a consulta completa: prévia da cor, código de barras e
          SKU de cada combinação. Fica discreto de propósito — no balcão o
          gesto normal é clicar na grade e vender, não abrir a ficha.
        */}
        <Link
          to={`/produto/${produto.produtoId}`}
          className="text-[12px] text-ink-faint underline-offset-2 transition-colors hover:text-accent hover:underline"
        >
          detalhes
        </Link>
      </div>
    </div>
  );
}

/** Perfume, óleo, acessório: uma variante só, sem grade a montar. */
function BotaoSimples({ produto, aoAdicionar }: Props) {
  const variante = produto.variantes[0]!;
  const esgotado = variante.saldoEstoque <= 0;

  return (
    <button
      type="button"
      onClick={() => aoAdicionar(variante)}
      className={cx(
        'h-11 rounded-[12px] text-[15px] font-medium transition-colors duration-200',
        esgotado
          ? 'bg-sunken text-ink-faint hover:bg-line hover:text-ink'
          : 'bg-accent-soft text-accent hover:brightness-95',
      )}
    >
      {esgotado ? 'Adicionar (sem saldo)' : 'Adicionar'}
    </button>
  );
}

function Grade({ produto, aoAdicionar }: Props) {
  // Sem cor cadastrada, a grade vira uma linha só de tamanhos — e vice-versa.
  const linhas: (string | null)[] = produto.cores.length > 0 ? [...produto.cores] : [null];
  const colunas: (string | null)[] = produto.tamanhos.length > 0 ? [...produto.tamanhos] : [null];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[13px]">
        <caption className="sr-only">
          Grade de {produto.nome}: cores nas linhas, tamanhos nas colunas.
        </caption>
        {colunas[0] !== null && (
          <thead>
            <tr>
              <th className="w-24" />
              {colunas.map((tamanho) => (
                <th
                  key={tamanho}
                  scope="col"
                  className="num px-1 pb-1 text-center text-[12px] font-medium text-ink-soft"
                >
                  {tamanho}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {linhas.map((cor) => (
            <tr key={cor ?? '—'}>
              <th scope="row" className="pr-2 text-left font-normal">
                {cor === null ? (
                  <span className="text-ink-soft">Único</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <SwatchCor cor={cor} tamanho={16} />
                    <span className="truncate text-ink-soft">{cor}</span>
                  </span>
                )}
              </th>
              {colunas.map((tamanho) => (
                <td key={tamanho ?? '—'} className="p-0">
                  <Celula
                    produto={produto}
                    cor={cor}
                    tamanho={tamanho}
                    aoAdicionar={aoAdicionar}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ESTILO_CELULA: Record<SituacaoCombinacao, string> = {
  disponivel: 'bg-accent-soft text-accent hover:brightness-95 cursor-pointer',
  // Esgotado continua clicável de propósito: a peça pode estar na arara e o
  // saldo local está defasado. Bloquear aqui é pior que vender o que existe.
  esgotado: 'bg-sunken text-ink-faint hover:bg-line hover:text-ink cursor-pointer',
  inexistente: 'bg-transparent text-ink-faint/50 cursor-default',
};

function Celula({
  produto,
  cor,
  tamanho,
  aoAdicionar,
}: {
  produto: ProdutoAgrupado;
  cor: string | null;
  tamanho: string | null;
  aoAdicionar: (variante: ItemCatalogo) => void;
}) {
  const situacao = situacaoDaCombinacao(produto, cor, tamanho);
  const variante = encontrarVariante(produto, cor, tamanho);
  const descricao = [cor, tamanho].filter(Boolean).join(' ') || produto.nome;

  if (situacao === 'inexistente') {
    return (
      <div
        aria-label={`${descricao}: não vendido`}
        className={cx(
          'grid h-9 w-full place-items-center rounded-[9px] border border-dashed border-line',
          ESTILO_CELULA.inexistente,
        )}
      >
        <span aria-hidden>–</span>
      </div>
    );
  }

  const saldo = variante!.saldoEstoque;

  return (
    <button
      type="button"
      onClick={() => aoAdicionar(variante!)}
      aria-label={
        situacao === 'disponivel'
          ? `Adicionar ${descricao}, ${saldo} em estoque`
          : `Adicionar ${descricao}, sem saldo registrado`
      }
      className={cx(
        'num grid h-9 w-full place-items-center rounded-[9px] font-medium',
        'transition-[filter,background-color,color] duration-200',
        ESTILO_CELULA[situacao],
      )}
    >
      {situacao === 'disponivel' ? saldo : '0'}
    </button>
  );
}

/** Legenda da grade. Fica fora do card, uma vez por lista de resultados. */
export function LegendaGrade() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-faint">
      <span className="flex items-center gap-1.5">
        <span className="h-3.5 w-5 rounded-[5px] bg-accent-soft" aria-hidden />
        em estoque
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3.5 w-5 rounded-[5px] bg-sunken" aria-hidden />
        esgotado, mas a loja vende
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3.5 w-5 rounded-[5px] border border-dashed border-line" aria-hidden />
        combinação não vendida
      </span>
      <Selo tom="neutro">o número é o saldo</Selo>
    </div>
  );
}
