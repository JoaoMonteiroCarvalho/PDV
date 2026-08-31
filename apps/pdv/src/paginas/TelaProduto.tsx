/**
 * Consulta de produto.
 *
 * Responde a pergunta que a cliente faz de costas para o caixa: "esse aí vem
 * em vinho? no GG? quanto é?". Uma tela por produto, com a grade inteira e o
 * código de cada combinação — é daqui que sai a resposta e o SKU para o
 * pedido de reposição.
 *
 * Lê do catálogo LOCAL (Dexie), não da rede. Consultar produto é a coisa que
 * a operadora mais faz e a que menos pode depender da internet da loja.
 *
 * A prévia 3D entra por `lazy`: os dados e a grade aparecem antes, e a cena
 * carrega depois. Quem está com pressa nunca espera pelo 3D.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { liveQuery } from 'dexie';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { bancoLocal, type ItemCatalogo } from '../banco/local.js';
import {
  agruparPorProduto,
  encontrarVariante,
  primeiraCombinacaoDisponivel,
  situacaoDaCombinacao,
  type ProdutoAgrupado,
} from '../catalogo/grade.js';
import { descreverForma, formaDaPeca } from '../catalogo/formaDaPeca.js';
import { Botao, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import { SwatchCor } from '../componentes/SwatchCor.js';
import { corDoProduto } from '../design/coresProduto.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { useCaixa } from '../estado/caixaStore.js';
import { PalcoProduto } from '../tres/PalcoProduto.js';
import { podeRenderizar3d } from '../tres/capacidade.js';

const CenaProduto = lazy(() => import('../tres/CenaProduto.js'));

type Carga =
  | { estado: 'carregando' }
  | { estado: 'achou'; produto: ProdutoAgrupado }
  | { estado: 'nao-achou' }
  | { estado: 'erro'; mensagem: string };

export function TelaProduto() {
  const { produtoId } = useParams<{ produtoId: string }>();
  const [carga, setCarga] = useState<Carga>({ estado: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  /*
   * `liveQuery` em vez de uma leitura única: a consulta se corrige sozinha
   * quando o catálogo termina de sincronizar. Sem isso, abrir um link de
   * produto ANTES da primeira carga mostrava "não encontrado" e continuava
   * mostrando, mesmo depois de o produto chegar ao banco local.
   */
  useEffect(() => {
    if (!produtoId) {
      setCarga({ estado: 'nao-achou' });
      return;
    }

    setCarga({ estado: 'carregando' });

    const inscricao = liveQuery(async () => {
      const porProduto = await bancoLocal.catalogo.where('produtoId').equals(produtoId).toArray();
      if (porProduto.length > 0) return porProduto;

      /*
       * Aceita também o id de uma VARIANTE na URL. A tela de venda trabalha
       * com variantes, e um link colado de lá não deve dar "não encontrado"
       * por uma diferença que a operadora não tem como saber que existe.
       */
      const variante = await bancoLocal.catalogo.get(produtoId);
      if (!variante) return [];
      return bancoLocal.catalogo.where('produtoId').equals(variante.produtoId).toArray();
    }).subscribe({
      next: (variantes) => {
        const [produto] = agruparPorProduto(variantes);
        setCarga(produto ? { estado: 'achou', produto } : { estado: 'nao-achou' });
      },
      error: (falha: unknown) => {
        setCarga({
          estado: 'erro',
          mensagem:
            falha instanceof Error ? falha.message : 'Não foi possível ler o catálogo local.',
        });
      },
    });

    return () => inscricao.unsubscribe();
  }, [produtoId, tentativa]);

  if (carga.estado === 'carregando') {
    return <Aviso>Carregando produto…</Aviso>;
  }

  if (carga.estado === 'erro') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Erro aoTentarNovamente={() => setTentativa((n) => n + 1)}>{carga.mensagem}</Erro>
      </div>
    );
  }

  if (carga.estado === 'nao-achou') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="font-titulo text-[22px]">Produto não encontrado neste caixa</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          A consulta usa o catálogo baixado neste computador. Se o produto é novo, pode ainda não
          ter sincronizado — a barra no topo mostra o estado da conexão.
        </p>
        <Botao variante="neutro" className="mt-6" onClick={() => history.back()}>
          Voltar
        </Botao>
      </div>
    );
  }

  return <Detalhe produto={carga.produto} />;
}

function Aviso({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center text-[14px] text-ink-faint">{children}</div>;
}

function Detalhe({ produto }: { produto: ProdutoAgrupado }) {
  const navegar = useNavigate();
  const adicionarItem = useCarrinho((estado) => estado.adicionarItem);
  const sessaoCaixa = useCaixa((estado) => estado.sessao);

  const inicial = useMemo(() => primeiraCombinacaoDisponivel(produto), [produto]);
  const [cor, setCor] = useState<string | null>(inicial?.cor ?? null);
  const [tamanho, setTamanho] = useState<string | null>(inicial?.tamanho ?? null);

  const variante = encontrarVariante(produto, cor, tamanho);
  const situacao = situacaoDaCombinacao(produto, cor, tamanho);

  const temGrade = produto.tamanhos.length > 0;
  const forma = formaDaPeca(produto.categoria, temGrade);
  // A cor da PRÉVIA é a da peça selecionada — paleta de catálogo, nunca tema.
  const tom = corDoProduto(cor);
  const usar3d = useMemo(() => podeRenderizar3d(), []);
  const descricao = descreverForma(forma, produto.nome);

  function adicionarEVender() {
    if (!variante) return;
    adicionarItem(variante);
    navegar('/venda');
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <Link
        to="/catalogo"
        className="text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        ← Catálogo
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Cartao className="overflow-hidden">
          <div className="h-[300px] bg-sunken">
            {usar3d ? (
              <Suspense fallback={<PalcoProduto forma={forma} cor={tom.hex} descricao={descricao} />}>
                <CenaProduto forma={forma} cor={tom.hex} />
              </Suspense>
            ) : (
              <PalcoProduto forma={forma} cor={tom.hex} descricao={descricao} />
            )}
          </div>

          {/*
            A legenda é obrigatória, não decoração. Sem ela a operadora pode
            tomar a prévia por foto do produto e descrever para a cliente um
            modelo que não existe.
          */}
          <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
            Representação abstrata para indicar a <strong className="font-medium">cor</strong>. Não
            é foto do produto.
          </p>
        </Cartao>

        <div className="min-w-0">
          <h1 className="font-titulo text-[26px] leading-tight">{produto.nome}</h1>
          <p className="mt-1 text-[14px] text-ink-faint">
            {[produto.marca, produto.categoria].filter(Boolean).join(' · ') || 'Sem categoria'}
          </p>

          <p className="num mt-4 font-titulo text-[30px] font-semibold">
            {produto.precoMinimoCentavos === produto.precoMaximoCentavos
              ? formatarBRL(centavos(produto.precoMinimoCentavos))
              : `${formatarBRL(centavos(produto.precoMinimoCentavos))} – ${formatarBRL(centavos(produto.precoMaximoCentavos))}`}
          </p>

          {produto.cores.length > 0 && (
            <Seletor titulo="Cor">
              {produto.cores.map((opcao) => (
                <BotaoCor
                  key={opcao}
                  cor={opcao}
                  escolhida={opcao === cor}
                  aoEscolher={() => setCor(opcao)}
                />
              ))}
            </Seletor>
          )}

          {produto.tamanhos.length > 0 && (
            <Seletor titulo="Tamanho">
              {produto.tamanhos.map((opcao) => {
                const situacaoOpcao = situacaoDaCombinacao(produto, cor, opcao);
                return (
                  <BotaoTamanho
                    key={opcao}
                    tamanho={opcao}
                    situacao={situacaoOpcao}
                    escolhido={opcao === tamanho}
                    aoEscolher={() => setTamanho(opcao)}
                  />
                );
              })}
            </Seletor>
          )}

          <FichaDaVariante variante={variante} situacao={situacao} />

          <div className="mt-6 flex flex-wrap gap-2">
            <Botao
              variante="primario"
              tamanho="grande"
              disabled={!variante || !sessaoCaixa}
              onClick={adicionarEVender}
            >
              Adicionar à venda
            </Botao>
            <Botao variante="neutro" tamanho="grande" onClick={() => history.back()}>
              Voltar
            </Botao>
          </div>

          {!sessaoCaixa && (
            <p className="mt-3 text-[13px] text-ink-faint">
              Consultar funciona sempre. Para lançar a peça é preciso{' '}
              <Link to="/caixa" className="text-accent hover:underline">
                abrir o caixa
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Seletor({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="text-[13px] font-medium text-ink-soft">{titulo}</h2>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function BotaoCor({
  cor,
  escolhida,
  aoEscolher,
}: {
  cor: string;
  escolhida: boolean;
  aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-pressed={escolhida}
      // Rótulo explícito: sem ele o nome acessível do botão sai da amostra de
      // cor mais do texto, e o leitor de tela anuncia a cor duas vezes ou
      // nenhuma, dependendo de como o navegador computa o nome.
      aria-label={`Cor ${cor}`}
      className={cx(
        'flex items-center gap-2 rounded-[12px] border px-3 py-2 text-[14px] transition-colors duration-200',
        escolhida ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-sunken',
      )}
    >
      <SwatchCor cor={cor} tamanho={16} />
      {cor}
    </button>
  );
}

function BotaoTamanho({
  tamanho,
  situacao,
  escolhido,
  aoEscolher,
}: {
  tamanho: string;
  situacao: 'disponivel' | 'esgotado' | 'inexistente';
  escolhido: boolean;
  aoEscolher: () => void;
}) {
  /*
   * Tamanho que não existe NESTA cor continua clicável: clicar mostra a ficha
   * dizendo que a combinação não é vendida. Desabilitar deixaria a operadora
   * sem saber se o problema é a cor ou o tamanho.
   */
  const rotuloEstado =
    situacao === 'disponivel' ? '' : situacao === 'esgotado' ? ', esgotado' : ', não vendido nesta cor';

  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-pressed={escolhido}
      aria-label={`Tamanho ${tamanho}${rotuloEstado}`}
      className={cx(
        'num min-w-[3rem] rounded-[12px] border px-3 py-2 text-[14px] transition-colors duration-200',
        escolhido && 'border-accent bg-accent-soft text-accent',
        !escolhido && situacao === 'disponivel' && 'border-line hover:bg-sunken',
        !escolhido && situacao === 'esgotado' && 'border-line text-ink-faint hover:bg-sunken',
        !escolhido && situacao === 'inexistente' && 'border-dashed border-line text-ink-faint/60',
      )}
    >
      {tamanho}
    </button>
  );
}

/** Os dados da combinação escolhida: é daqui que sai o código para reposição. */
function FichaDaVariante({
  variante,
  situacao,
}: {
  variante: ItemCatalogo | null;
  situacao: 'disponivel' | 'esgotado' | 'inexistente';
}) {
  if (!variante) {
    return (
      <div className="mt-6 rounded-[12px] border border-dashed border-line px-4 py-3 text-[14px] text-ink-soft">
        A loja não vende esta combinação. Escolha outra cor ou outro tamanho.
      </div>
    );
  }

  return (
    <dl className="mt-6 grid gap-x-6 gap-y-2 rounded-[12px] bg-sunken px-4 py-3 text-[14px] sm:grid-cols-2">
      <Linha rotulo="Preço">{formatarBRL(centavos(variante.precoCentavos))}</Linha>
      <Linha rotulo="Estoque">
        {situacao === 'disponivel' ? (
          <Selo tom="ok">{variante.saldoEstoque} em estoque</Selo>
        ) : (
          <Selo tom="alerta">Sem saldo registrado</Selo>
        )}
      </Linha>
      <Linha rotulo="SKU">{variante.sku}</Linha>
      <Linha rotulo="Código de barras">{variante.codigoBarras ?? '—'}</Linha>
    </dl>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-soft">{rotulo}</dt>
      <dd className="num text-right text-ink">{children}</dd>
    </div>
  );
}
