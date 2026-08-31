/**
 * Catálogo visual.
 *
 * Serve para NAVEGAR, não para vender — quem está vendendo usa a busca da tela
 * de venda, que é mais rápida. Aqui a operadora passa os olhos no que a loja
 * tem, geralmente para responder a cliente que ainda não sabe o que quer, ou
 * para conferir cadastro.
 *
 * Cada card traz a prévia 3D da peça. O detalhe que faz isso ser viável:
 * TODOS os cards são desenhados por UM canvas só, via `View` do drei. Um
 * `<Canvas>` por card criaria um contexto WebGL por card, e o navegador só
 * mantém 8 a 16 vivos — passando disso ele descarta os mais antigos em
 * silêncio e os primeiros cards viram retângulos pretos, sem erro no console.
 *
 * Só o card visível na tela ganha prévia (`IntersectionObserver`): rolar uma
 * lista de 10 mil SKUs não pode manter dezenas de peças na cena.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { liveQuery } from 'dexie';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bancoLocal, type ItemCatalogo } from '../banco/local.js';
import { agruparPorProduto, type ProdutoAgrupado } from '../catalogo/grade.js';
import { descreverForma, formaDaPeca } from '../catalogo/formaDaPeca.js';
import { buscarProdutos } from '../catalogo/sincronizacao.js';
import { Botao, Campo, Cartao, Erro, Selo } from '../componentes/base.js';
import { SwatchCor } from '../componentes/SwatchCor.js';
import { corDoProduto } from '../design/coresProduto.js';
import { PalcoProduto } from '../tres/PalcoProduto.js';
import { podeRenderizar3d } from '../tres/capacidade.js';
import type { AlvoPrevia } from '../tres/CenaCatalogo.js';

const CenaCatalogo = lazy(() => import('../tres/CenaCatalogo.js'));

/** Quantas VARIANTES carregar por vez. Um produto costuma ter 6 a 20. */
const PASSO = 240;
const ESPERA_BUSCA_MS = 180;

export function TelaCatalogo() {
  const [termo, setTermo] = useState('');
  /** Termo já estabilizado pelo debounce — é ele que consulta o banco. */
  const [termoBuscado, setTermoBuscado] = useState('');
  const [limite, setLimite] = useState(PASSO);
  const [variantes, setVariantes] = useState<ItemCatalogo[]>([]);
  const [acabou, setAcabou] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  /** Quais cards estão na tela agora — só eles ganham prévia 3D. */
  const [visiveis, setVisiveis] = useState<ReadonlySet<string>>(new Set());

  const buscando = termo.trim().length > 0;
  const usar3d = useMemo(() => podeRenderizar3d(), []);

  /*
   * Um objeto-ref estável por produto, criado sob demanda. O `View` do drei
   * segue o retângulo deste elemento a cada quadro; se o ref trocasse de
   * identidade a cada render, a prévia perderia o card de vista.
   */
  const trilhos = useRef(new Map<string, { current: HTMLElement | null }>());
  const trilhoDe = useCallback((chave: string) => {
    let trilho = trilhos.current.get(chave);
    if (!trilho) {
      trilho = { current: null };
      trilhos.current.set(chave, trilho);
    }
    return trilho;
  }, []);

  /** Observa os slots e mantém `visiveis` em dia enquanto a operadora rola. */
  const observador = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (!usar3d) return;
    observador.current = new IntersectionObserver(
      (entradas) => {
        setVisiveis((atual) => {
          const proximo = new Set(atual);
          for (const entrada of entradas) {
            const chave = (entrada.target as HTMLElement).dataset.produto;
            if (!chave) continue;
            if (entrada.isIntersecting) proximo.add(chave);
            else proximo.delete(chave);
          }
          return proximo;
        });
      },
      // Margem generosa: a peça já está pronta quando o card entra na tela.
      { rootMargin: '240px' },
    );
    return () => observador.current?.disconnect();
  }, [usar3d]);

  const registrarSlot = useCallback(
    (chave: string, elemento: HTMLElement | null) => {
      trilhoDe(chave).current = elemento;
      if (!elemento) return;
      observador.current?.observe(elemento);
    },
    [trilhoDe],
  );

  /*
   * Debounce só do TEXTO. A consulta em si é reativa (abaixo); o atraso aqui
   * existe só para não refazer a busca a cada tecla digitada.
   */
  useEffect(() => {
    if (termo.trim().length === 0) {
      setTermoBuscado('');
      return;
    }
    const temporizador = setTimeout(() => setTermoBuscado(termo.trim()), ESPERA_BUSCA_MS);
    return () => clearTimeout(temporizador);
  }, [termo]);

  /*
   * `liveQuery` em vez de uma leitura única.
   *
   * Sem isto, quem abre o catálogo ENQUANTO a primeira carga ainda desce vê
   * "ainda não sincronizou" e continua vendo, mesmo depois de o catálogo
   * chegar — a tela leu o banco vazio uma vez e nunca mais olhou. Só sair e
   * voltar resolvia, e a operadora não tem como saber disso.
   *
   * Com `liveQuery`, a lista se preenche sozinha conforme o motor grava.
   */
  useEffect(() => {
    setCarregando(true);

    const inscricao = liveQuery(async () =>
      termoBuscado
        ? buscarProdutos(bancoLocal, termoBuscado, 200)
        : bancoLocal.catalogo.orderBy('nome').limit(limite).toArray(),
    ).subscribe({
      next: (encontrados) => {
        setVariantes(encontrados);
        setAcabou(termoBuscado.length > 0 || encontrados.length < limite);
        setErro(null);
        setCarregando(false);
      },
      error: (falha: unknown) => {
        setErro(falha instanceof Error ? falha.message : 'Não foi possível ler o catálogo local.');
        setCarregando(false);
      },
    });

    return () => inscricao.unsubscribe();
  }, [termoBuscado, limite, tentativa]);

  const produtos = useMemo(() => {
    const agrupados = agruparPorProduto(variantes);
    /*
     * O corte por limite de VARIANTES pode partir o último produto no meio, e
     * ele apareceria com menos cores do que tem de verdade. Some da página até
     * o "carregar mais" trazer o resto — melhor faltar um card do que mostrar
     * uma grade incompleta como se fosse completa.
     */
    return acabou ? agrupados : agrupados.slice(0, -1);
  }, [variantes, acabou]);

  /** Só os cards visíveis viram peça na cena. */
  const alvos = useMemo<AlvoPrevia[]>(() => {
    if (!usar3d) return [];
    return produtos
      .filter((produto) => visiveis.has(produto.produtoId))
      .map((produto) => ({
        chave: produto.produtoId,
        forma: formaDaPeca(produto.categoria, produto.tamanhos.length > 0),
        // Cor da PEÇA, da paleta de catálogo — nunca token de interface.
        cor: corDoProduto(produto.cores[0] ?? null).hex,
        trilho: trilhoDe(produto.produtoId),
      }));
  }, [produtos, visiveis, usar3d, trilhoDe]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-[24px]">Catálogo</h1>
          <p className="mt-1 text-[13px] text-ink-faint">
            O que este caixa tem baixado. Clique numa peça para ver a grade completa.
          </p>
        </div>
        <div className="w-full max-w-sm">
          <Campo
            rotulo="Buscar"
            placeholder="nome, marca, cor ou SKU"
            value={termo}
            onChange={(evento) => setTermo(evento.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      {erro && (
        <div className="mt-6">
          <Erro aoTentarNovamente={() => setTentativa((n) => n + 1)}>{erro}</Erro>
        </div>
      )}

      {!erro && produtos.length === 0 && !carregando && (
        <p className="py-16 text-center text-[14px] text-ink-faint">
          {buscando
            ? `Nada encontrado para “${termo.trim()}”.`
            : 'O catálogo ainda não sincronizou neste computador.'}
        </p>
      )}

      {produtos.length > 0 && (
        <>
          <div className="mt-6 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {produtos.map((produto) => (
              <CardCatalogo
                key={produto.produtoId}
                produto={produto}
                usar3d={usar3d}
                aoMontarSlot={registrarSlot}
              />
            ))}
          </div>

          {!acabou && (
            <div className="mt-6 grid place-items-center">
              <Botao
                variante="neutro"
                disabled={carregando}
                onClick={() => setLimite((atual) => atual + PASSO)}
              >
                {carregando ? 'Carregando…' : 'Carregar mais'}
              </Botao>
            </div>
          )}
        </>
      )}

      {/*
        UM canvas para a grade inteira. Entra por `lazy`, então a lista, os
        preços e o estoque aparecem antes de qualquer coisa 3D — quem está com
        pressa nunca espera pela cena.
      */}
      {usar3d && alvos.length > 0 && (
        <Suspense fallback={null}>
          <CenaCatalogo alvos={alvos} />
        </Suspense>
      )}
    </div>
  );
}

function CardCatalogo({
  produto,
  usar3d,
  aoMontarSlot,
}: {
  produto: ProdutoAgrupado;
  usar3d: boolean;
  aoMontarSlot: (chave: string, elemento: HTMLElement | null) => void;
}) {
  const faixa =
    produto.precoMinimoCentavos === produto.precoMaximoCentavos
      ? formatarBRL(centavos(produto.precoMinimoCentavos))
      : `a partir de ${formatarBRL(centavos(produto.precoMinimoCentavos))}`;

  const forma = formaDaPeca(produto.categoria, produto.tamanhos.length > 0);
  const tom = corDoProduto(produto.cores[0] ?? null);
  const descricao = descreverForma(forma, produto.nome);

  return (
    <Link
      to={`/produto/${produto.produtoId}`}
      className="block rounded-card transition-transform duration-200 hover:-translate-y-0.5"
    >
      <Cartao className="flex h-full flex-col gap-3 p-4">
        {/*
          Slot da prévia. Com 3D ligado ele fica VAZIO de propósito: o canvas
          único desenha por cima deste retângulo. Preenchê-lo com o SVG faria
          as duas imagens aparecerem juntas, porque o `View` do drei não limpa
          a área antes de desenhar.
        */}
        <div
          data-produto={produto.produtoId}
          ref={(elemento) => aoMontarSlot(produto.produtoId, elemento)}
          // Com 3D o slot é um retângulo vazio que o canvas pinta; sem
          // rótulo, a peça sumiria para quem usa leitor de tela.
          role={usar3d ? 'img' : undefined}
          aria-label={usar3d ? descricao : undefined}
          className="h-[132px] w-full overflow-hidden rounded-[10px] bg-sunken"
        >
          {!usar3d && <PalcoProduto forma={forma} cor={tom.hex} descricao={descricao} />}
        </div>

        <div className="min-w-0">
          <p className="truncate font-titulo text-[15px] font-medium">{produto.nome}</p>
          <p className="truncate text-[13px] text-ink-faint">
            {[produto.marca, produto.categoria].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>

        {produto.cores.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {produto.cores.slice(0, 6).map((cor) => (
              <SwatchCor key={cor} cor={cor} tamanho={18} />
            ))}
            {produto.cores.length > 6 && (
              <span className="num text-[12px] text-ink-faint">+{produto.cores.length - 6}</span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2">
          <span className="num text-[15px] font-medium">{faixa}</span>
          {produto.saldoTotal === 0 ? (
            <Selo tom="alerta">Sem peças</Selo>
          ) : (
            <Selo tom="neutro">
              <span className="num">{produto.saldoTotal}</span> em estoque
            </Selo>
          )}
        </div>

        {produto.tamanhos.length > 0 && (
          <p className="num truncate text-[12px] text-ink-faint">
            {produto.tamanhos.join(' · ')}
          </p>
        )}
      </Cartao>
    </Link>
  );
}
