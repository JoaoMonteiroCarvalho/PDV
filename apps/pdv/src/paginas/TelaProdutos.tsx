/**
 * Cadastro de produtos.
 *
 * Até aqui a loja não tinha como cadastrar coleção nova: o catálogo só entrava
 * por `seed.ts` ou SQL na mão. Esta é a tela que faltava.
 *
 * A decisão que organiza tudo: **produto nasce com a grade inteira**. Peça de
 * lingerie chega em P/M/G × três cores. Cadastrar o produto e depois nove
 * variações, uma de cada vez, transformaria a chegada da coleção numa tarde de
 * trabalho — e deixaria produto sem variação nenhuma toda vez que alguém
 * desistisse no meio. Por isso o formulário tem um GERADOR de grade: escolhe
 * os tamanhos, escolhe as cores, e ele monta as combinações com SKU sugerido.
 *
 * Preço e custo são `CampoDinheiro` — centavos inteiros, sem float, como em
 * todo lugar onde este sistema toca dinheiro.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useCallback, useEffect, useState } from 'react';
import {
  clienteApi,
  type CategoriaResumo,
  type ProdutoDetalhe,
  type ProdutoResumo,
  type VarianteEntrada,
} from '../api/cliente.js';
import { Botao, Campo, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import { SwatchCor } from '../componentes/SwatchCor.js';
import { useSessao, ehGerente } from '../estado/sessaoStore.js';
import { montarGrade, sugerirSku } from '../catalogo/gradeNova.js';
import { FichaProduto } from '../catalogo/FichaProduto.js';

export function TelaProdutos() {
  const operadora = useSessao((estado) => estado.operadora);
  const podeEditar = ehGerente(operadora);

  const [busca, setBusca] = useState('');
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [lista, setLista] = useState<ProdutoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<ProdutoDetalhe | null>(null);
  const [criando, setCriando] = useState(false);
  const [categorias, setCategorias] = useState<CategoriaResumo[]>([]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const resposta = await clienteApi.listarProdutos({
        busca: busca.trim() || undefined,
        incluirInativos,
      });
      setLista(resposta.itens);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar os produtos.');
    }
  }, [busca, incluirInativos]);

  useEffect(() => {
    // Espera de 250 ms: buscar a cada tecla dispararia uma consulta por letra.
    const temporizador = setTimeout(() => void carregar(), 250);
    return () => clearTimeout(temporizador);
  }, [carregar]);

  useEffect(() => {
    void clienteApi
      .listarCategorias()
      .then(setCategorias)
      .catch(() => setCategorias([]));
  }, []);

  async function abrir(produtoId: string) {
    setErro(null);
    try {
      setSelecionado(await clienteApi.obterProduto(produtoId));
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível abrir o produto.');
    }
  }

  if (criando) {
    return (
      <FormularioProduto
        categorias={categorias}
        aoCancelar={() => setCriando(false)}
        aoSalvar={async (produtoId) => {
          setCriando(false);
          await carregar();
          await abrir(produtoId);
        }}
      />
    );
  }

  if (selecionado) {
    return (
      <FichaProduto
        produto={selecionado}
        categorias={categorias}
        podeEditar={podeEditar}
        aoVoltar={() => {
          setSelecionado(null);
          void carregar();
        }}
        aoRecarregar={() => void abrir(selecionado.id)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-titulo text-[24px]">Produtos</h1>
          <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
            O cadastro que alimenta o caixa. Produto desativado some do catálogo das operadoras,
            mas nunca é apagado — ele assina as vendas já feitas.
          </p>
        </div>
        {podeEditar && (
          <Botao variante="primario" tamanho="grande" onClick={() => setCriando(true)}>
            Novo produto
          </Botao>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div className="min-w-[16rem] flex-1">
          <Campo
            rotulo="Buscar"
            deBusca
            placeholder="nome, marca ou SKU"
            autoComplete="off"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-3 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={incluirInativos}
            onChange={(evento) => setIncluirInativos(evento.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Mostrar desativados
        </label>
      </div>

      {erro && (
        <div className="mt-5">
          <Erro>{erro}</Erro>
        </div>
      )}

      {lista === null ? (
        <p className="mt-8 text-[14px] text-ink-faint">Carregando…</p>
      ) : lista.length === 0 ? (
        <Cartao className="mt-6 p-8 text-center">
          <p className="text-[14px] leading-relaxed text-ink-soft">
            {busca.trim()
              ? `Nada encontrado para “${busca.trim()}”.`
              : 'Nenhum produto cadastrado ainda.'}
          </p>
        </Cartao>
      ) : (
        <ul className="mt-6 space-y-2">
          {lista.map((produto) => (
            <li key={produto.id}>
              <button
                type="button"
                onClick={() => void abrir(produto.id)}
                className="flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-sunken"
              >
                <div className="min-w-0 flex-1">
                  <p className={cx('truncate text-[15px]', produto.ativo ? 'text-ink' : 'text-ink-faint')}>
                    {produto.nome}
                  </p>
                  <p className="truncate text-[12px] text-ink-faint">
                    {[produto.marca, produto.categoria?.nome].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <span className="num text-[13px] text-ink-faint">
                  {produto.quantidadeVariantes}{' '}
                  {produto.quantidadeVariantes === 1 ? 'variação' : 'variações'}
                </span>
                {!produto.ativo && <Selo tom="neutro">desativado</Selo>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Novo produto
// ---------------------------------------------------------------------------

function FormularioProduto({
  categorias,
  aoCancelar,
  aoSalvar,
}: {
  categorias: CategoriaResumo[];
  aoCancelar: () => void;
  aoSalvar: (produtoId: string) => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  const [marca, setMarca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [ncm, setNcm] = useState('');

  const [tamanhos, setTamanhos] = useState('P, M, G');
  const [cores, setCores] = useState('');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [custoCentavos, setCustoCentavos] = useState(0);

  const [variantes, setVariantes] = useState<VarianteEntrada[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function gerarGrade() {
    setErro(null);
    const combinacoes = montarGrade(tamanhos, cores);
    if (combinacoes.length === 0) {
      setErro('Informe ao menos um tamanho ou uma cor para montar a grade.');
      return;
    }
    setVariantes(
      combinacoes.map((combinacao) => ({
        sku: sugerirSku(nome, combinacao.tamanho, combinacao.cor),
        tamanho: combinacao.tamanho ?? undefined,
        cor: combinacao.cor ?? undefined,
        precoCentavos,
        custoCentavos,
      })),
    );
  }

  function alterarVariante(indice: number, mudanca: Partial<VarianteEntrada>) {
    setVariantes((atual) =>
      atual.map((variante, i) => (i === indice ? { ...variante, ...mudanca } : variante)),
    );
  }

  async function salvar() {
    setErro(null);
    if (nome.trim().length < 2) {
      setErro('O nome do produto precisa de ao menos 2 caracteres.');
      return;
    }
    if (variantes.length === 0) {
      setErro('Gere a grade antes de salvar: produto precisa de ao menos uma variação.');
      return;
    }
    const semSku = variantes.find((variante) => variante.sku.trim() === '');
    if (semSku) {
      setErro('Toda variação precisa de um SKU.');
      return;
    }

    setSalvando(true);
    try {
      const criado = await clienteApi.criarProduto({
        nome: nome.trim(),
        marca: marca.trim() || undefined,
        categoriaId: categoriaId || undefined,
        ncm: ncm.trim() || undefined,
        variantes,
      });
      await aoSalvar(criado.id);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível salvar o produto.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="font-titulo text-[24px]">Novo produto</h1>
      <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
        Preencha o produto, escolha a grade e confira os SKUs sugeridos antes de salvar.
      </p>

      <Cartao className="mt-6 p-5">
        <h2 className="font-titulo text-[16px] font-medium">O produto</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Nome"
            name="produto-nome"
            autoComplete="off"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
          />
          <Campo
            rotulo="Marca"
            name="produto-marca"
            autoComplete="off"
            value={marca}
            onChange={(evento) => setMarca(evento.target.value)}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-ink-soft">Categoria</span>
            <select
              value={categoriaId}
              onChange={(evento) => setCategoriaId(evento.target.value)}
              className="h-12 rounded-[8px] border border-line bg-surface px-4 text-[16px] text-ink focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
            >
              <option value="">Sem categoria</option>
              {categorias.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.nome}
                </option>
              ))}
            </select>
          </label>
          {/*
            NCM fica aqui mesmo sem módulo fiscal ligado: preencher enquanto
            cadastra custa um campo; revisitar dez mil SKUs no dia em que a
            NFC-e for ligada custa uma semana.
          */}
          <Campo
            rotulo="NCM (opcional, para o fiscal futuro)"
            name="produto-ncm"
            numerico
            autoComplete="off"
            placeholder="61083100"
            value={ncm}
            onChange={(evento) => setNcm(evento.target.value)}
          />
        </div>
      </Cartao>

      <Cartao className="mt-5 p-5">
        <h2 className="font-titulo text-[16px] font-medium">A grade</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
          Separe por vírgula. Deixe as cores em branco para uma peça sem variação de cor.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Tamanhos"
            name="grade-tamanhos"
            autoComplete="off"
            placeholder="P, M, G, GG"
            value={tamanhos}
            onChange={(evento) => setTamanhos(evento.target.value)}
          />
          <Campo
            rotulo="Cores"
            name="grade-cores"
            autoComplete="off"
            placeholder="preto, branco, nude"
            value={cores}
            onChange={(evento) => setCores(evento.target.value)}
          />
          <CampoDinheiro
            rotulo="Preço de venda"
            valorCentavos={precoCentavos}
            aoMudar={setPrecoCentavos}
          />
          <CampoDinheiro
            rotulo="Custo"
            valorCentavos={custoCentavos}
            aoMudar={setCustoCentavos}
            ajuda="Entra na margem. Pode ficar zero e ser corrigido na entrada da nota."
          />
        </div>

        <Botao variante="neutro" className="mt-4" onClick={gerarGrade}>
          Gerar grade
        </Botao>
      </Cartao>

      {variantes.length > 0 && (
        <Cartao className="mt-5 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-titulo text-[16px] font-medium">
              {variantes.length} {variantes.length === 1 ? 'variação' : 'variações'}
            </h2>
            <span className="text-[13px] text-ink-faint">Confira os SKUs antes de salvar</span>
          </div>

          <ul className="mt-4 divide-y divide-line">
            {variantes.map((variante, indice) => (
              <li key={indice} className="flex flex-wrap items-end gap-3 py-3">
                {variante.cor && <SwatchCor cor={variante.cor} tamanho={18} />}
                <span className="min-w-[6rem] text-[13px] text-ink-soft">
                  {[variante.tamanho, variante.cor].filter(Boolean).join(' · ') || 'única'}
                </span>
                <div className="min-w-[12rem] flex-1">
                  <Campo
                    rotulo="SKU"
                    numerico
                    autoComplete="off"
                    value={variante.sku}
                    onChange={(evento) =>
                      alterarVariante(indice, { sku: evento.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className="min-w-[10rem]">
                  <Campo
                    rotulo="Código de barras"
                    numerico
                    autoComplete="off"
                    placeholder="opcional"
                    value={variante.codigoBarras ?? ''}
                    onChange={(evento) =>
                      alterarVariante(indice, { codigoBarras: evento.target.value || undefined })
                    }
                  />
                </div>
                <div className="min-w-[8rem]">
                  <CampoDinheiro
                    rotulo="Preço"
                    valorCentavos={variante.precoCentavos}
                    aoMudar={(valor) => alterarVariante(indice, { precoCentavos: valor })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setVariantes((atual) => atual.filter((_, i) => i !== indice))}
                  aria-label={`Remover variação ${variante.sku}`}
                  className="mb-3 rounded-[8px] px-2 py-1 text-[13px] text-ink-faint hover:bg-perigo/10 hover:text-perigo"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {erro && (
        <div className="mt-5">
          <Erro>{erro}</Erro>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Botao
          variante="primario"
          tamanho="grande"
          disabled={salvando || variantes.length === 0}
          onClick={() => void salvar()}
        >
          {salvando ? 'Salvando…' : `Salvar produto com ${variantes.length} variações`}
        </Botao>
        <Botao variante="neutro" tamanho="grande" disabled={salvando} onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}
