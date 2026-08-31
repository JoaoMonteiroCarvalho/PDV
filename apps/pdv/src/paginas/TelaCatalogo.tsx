/**
 * Catálogo visual.
 *
 * Serve para NAVEGAR, não para vender — quem está vendendo usa a busca da tela
 * de venda, que é mais rápida. Aqui a operadora passa os olhos no que a loja
 * tem, geralmente para responder a cliente que ainda não sabe o que quer, ou
 * para conferir cadastro.
 *
 * Sem 3D nos cards, e a razão é técnica, não estética: o navegador limita
 * quantos contextos WebGL existem ao mesmo tempo (na prática 8 a 16) e passa a
 * descartar os mais antigos em silêncio. Uma grade de prévias 3D viraria
 * retângulos pretos sem erro nenhum no console. O 3D vive na tela de UM
 * produto; aqui a cor aparece em amostra plana, que é o que a operadora
 * precisa enxergar de relance.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { bancoLocal, type ItemCatalogo } from '../banco/local.js';
import { agruparPorProduto, type ProdutoAgrupado } from '../catalogo/grade.js';
import { buscarProdutos } from '../catalogo/sincronizacao.js';
import { Botao, Campo, Cartao, Erro, Selo } from '../componentes/base.js';
import { SwatchCor } from '../componentes/SwatchCor.js';

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

  const buscando = termo.trim().length > 0;

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
              <CardCatalogo key={produto.produtoId} produto={produto} />
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
    </div>
  );
}

function CardCatalogo({ produto }: { produto: ProdutoAgrupado }) {
  const faixa =
    produto.precoMinimoCentavos === produto.precoMaximoCentavos
      ? formatarBRL(centavos(produto.precoMinimoCentavos))
      : `a partir de ${formatarBRL(centavos(produto.precoMinimoCentavos))}`;

  return (
    <Link
      to={`/produto/${produto.produtoId}`}
      className="block rounded-card transition-transform duration-200 hover:-translate-y-0.5"
    >
      <Cartao className="flex h-full flex-col gap-3 p-4">
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
