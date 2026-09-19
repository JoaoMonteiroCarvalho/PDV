/**
 * Ficha do produto: a grade inteira, com saldo, edição e extrato.
 *
 * É a tela onde a gerente responde as três perguntas que trazem alguém aqui:
 * "quanto custa?", "quantas tem?" e "para onde foram as que faltam?".
 *
 * As duas últimas andam juntas de propósito. Um saldo sozinho não diz nada
 * quando está errado; é o extrato ao lado dele que separa "vendeu" de "sumiu",
 * e é essa distinção que decide se o caso é ajuste de inventário ou conversa
 * com a equipe.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useState } from 'react';
import {
  clienteApi,
  type CategoriaResumo,
  type HistoricoMovimentacao,
  type ProdutoDetalhe,
  type VarianteDetalhe,
} from '../api/cliente.js';
import { Botao, Campo, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import { SwatchCor } from '../componentes/SwatchCor.js';

/** Nome legível de cada tipo de movimento do livro-razão. */
const ROTULO_MOVIMENTO: Readonly<Record<string, string>> = {
  ENTRADA_COMPRA: 'Entrada de mercadoria',
  VENDA: 'Venda',
  CANCELAMENTO_VENDA: 'Cancelamento de venda',
  DEVOLUCAO: 'Devolução',
  AJUSTE_INVENTARIO: 'Ajuste de inventário',
  PERDA: 'Perda',
  TRANSFERENCIA: 'Transferência',
};

export function FichaProduto({
  produto,
  categorias,
  podeEditar,
  aoVoltar,
  aoRecarregar,
}: {
  produto: ProdutoDetalhe;
  categorias: CategoriaResumo[];
  podeEditar: boolean;
  aoVoltar: () => void;
  aoRecarregar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<VarianteDetalhe | null>(null);
  const [inventariando, setInventariando] = useState<VarianteDetalhe | null>(null);
  const [extrato, setExtrato] = useState<HistoricoMovimentacao | null>(null);

  async function alternarAtivo() {
    setErro(null);
    try {
      await clienteApi.atualizarProduto(produto.id, { ativo: !produto.ativo });
      aoRecarregar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível alterar o produto.');
    }
  }

  async function verExtrato(variante: VarianteDetalhe) {
    setErro(null);
    try {
      setExtrato(await clienteApi.historicoMovimentacao(variante.id));
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar o extrato.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Botao variante="discreto" onClick={aoVoltar} className="mb-4 h-8 px-2 text-[13px]">
        ← Voltar aos produtos
      </Botao>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-titulo text-[24px]">{produto.nome}</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            {[produto.marca, produto.categoria?.nome].filter(Boolean).join(' · ') || 'Sem marca'}
            {produto.ncm ? ` · NCM ${produto.ncm}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!produto.ativo && <Selo tom="neutro">desativado</Selo>}
          {podeEditar && (
            <Botao variante={produto.ativo ? 'perigo' : 'neutro'} onClick={() => void alternarAtivo()}>
              {produto.ativo ? 'Desativar produto' : 'Reativar produto'}
            </Botao>
          )}
        </div>
      </div>

      {erro && (
        <div className="mt-5">
          <Erro>{erro}</Erro>
        </div>
      )}

      <h2 className="mt-8 font-titulo text-[17px] font-medium">
        {produto.variantes.length}{' '}
        {produto.variantes.length === 1 ? 'variação' : 'variações'}
      </h2>

      <ul className="mt-3 space-y-2">
        {produto.variantes.map((variante) => (
          <li key={variante.id}>
            <Cartao className="flex flex-wrap items-center gap-3 p-4">
              {variante.cor && <SwatchCor cor={variante.cor} tamanho={20} />}

              <div className="min-w-0 flex-1">
                <p className={cx('truncate text-[15px]', variante.ativo ? 'text-ink' : 'text-ink-faint')}>
                  {[variante.tamanho, variante.cor].filter(Boolean).join(' · ') || 'Única'}
                </p>
                <p className="num truncate text-[12px] text-ink-faint">
                  {variante.sku}
                  {variante.codigoBarras ? ` · ${variante.codigoBarras}` : ''}
                </p>
              </div>

              <span className="num text-[15px]">{formatarBRL(centavos(variante.precoCentavos))}</span>

              {/*
                Saldo zero em vermelho, não em cinza. Peça esgotada é a
                informação que muda o que a operadora responde à cliente, e em
                cinza ela se parece com "sem informação".
              */}
              <span
                className={cx(
                  'num min-w-[4.5rem] text-right text-[14px]',
                  (variante.saldoEstoque ?? 0) <= 0 ? 'text-perigo' : 'text-ink-soft',
                )}
              >
                {variante.saldoEstoque ?? 0} un
              </span>

              {!variante.ativo && <Selo tom="neutro">inativa</Selo>}

              <div className="flex gap-1">
                <Botao
                  variante="discreto"
                  onClick={() => void verExtrato(variante)}
                  className="h-8 px-2 text-[13px]"
                >
                  Extrato
                </Botao>
                {podeEditar && (
                  <>
                    <Botao
                      variante="discreto"
                      onClick={() => setInventariando(variante)}
                      className="h-8 px-2 text-[13px]"
                    >
                      Contar
                    </Botao>
                    <Botao
                      variante="neutro"
                      onClick={() => setEditando(variante)}
                      className="h-8 px-2 text-[13px]"
                    >
                      Editar
                    </Botao>
                  </>
                )}
              </div>
            </Cartao>
          </li>
        ))}
      </ul>

      {editando && (
        <ModalEditarVariante
          variante={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            aoRecarregar();
          }}
        />
      )}

      {inventariando && (
        <ModalInventario
          variante={inventariando}
          aoFechar={() => setInventariando(null)}
          aoAjustar={() => {
            setInventariando(null);
            aoRecarregar();
          }}
        />
      )}

      {extrato && <ModalExtrato extrato={extrato} aoFechar={() => setExtrato(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edição de variação
// ---------------------------------------------------------------------------

function ModalEditarVariante({
  variante,
  aoFechar,
  aoSalvar,
}: {
  variante: VarianteDetalhe;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [sku, setSku] = useState(variante.sku);
  const [codigoBarras, setCodigoBarras] = useState(variante.codigoBarras ?? '');
  const [precoCentavos, setPrecoCentavos] = useState(variante.precoCentavos);
  const [custoCentavos, setCustoCentavos] = useState(variante.custoCentavos);
  const [ativo, setAtivo] = useState(variante.ativo);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const precoMudou = precoCentavos !== variante.precoCentavos;

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await clienteApi.atualizarVariante(variante.id, {
        sku: sku.trim().toUpperCase(),
        codigoBarras: codigoBarras.trim() || null,
        precoCentavos,
        custoCentavos,
        ativo,
      });
      aoSalvar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={`Editar ${variante.sku}`} aoFechar={aoFechar}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="SKU"
          numerico
          autoComplete="off"
          value={sku}
          onChange={(evento) => setSku(evento.target.value.toUpperCase())}
        />
        <Campo
          rotulo="Código de barras"
          numerico
          autoComplete="off"
          placeholder="opcional"
          value={codigoBarras}
          onChange={(evento) => setCodigoBarras(evento.target.value)}
        />
        <CampoDinheiro rotulo="Preço de venda" valorCentavos={precoCentavos} aoMudar={setPrecoCentavos} />
        <CampoDinheiro rotulo="Custo" valorCentavos={custoCentavos} aoMudar={setCustoCentavos} />
      </div>

      <label className="mt-4 flex items-center gap-2 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={ativo}
          onChange={(evento) => setAtivo(evento.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
        Variação ativa — desmarcar a remove do catálogo dos caixas
      </label>

      {/*
        Mudança de preço é avisada ANTES de salvar, não depois. Ela vai para a
        auditoria com nome e horário, e quem está editando merece saber disso
        enquanto ainda pode desistir.
      */}
      {precoMudou && (
        <p className="num mt-4 rounded-[8px] bg-alerta/10 px-4 py-3 text-[13px] leading-relaxed text-ink">
          Preço: {formatarBRL(centavos(variante.precoCentavos))} →{' '}
          {formatarBRL(centavos(precoCentavos))}. A alteração fica registrada na auditoria com seu
          nome.
        </p>
      )}

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <Botao variante="discreto" onClick={aoFechar} disabled={salvando} className="flex-1">
          Voltar
        </Botao>
        <Botao
          variante="primario"
          tamanho="grande"
          className="flex-[2]"
          disabled={salvando}
          onClick={() => void salvar()}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </Botao>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ajuste de inventário
// ---------------------------------------------------------------------------

function ModalInventario({
  variante,
  aoFechar,
  aoAjustar,
}: {
  variante: VarianteDetalhe;
  aoFechar: () => void;
  aoAjustar: () => void;
}) {
  const saldoSistema = variante.saldoEstoque ?? 0;
  const [contado, setContado] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const quantidade = /^\d+$/.test(contado.trim()) ? Number(contado.trim()) : null;
  const diferenca = quantidade === null ? null : quantidade - saldoSistema;
  const podeEnviar = quantidade !== null && observacao.trim().length >= 3 && !enviando;

  async function ajustar() {
    if (quantidade === null) return;
    setErro(null);
    setEnviando(true);
    try {
      await clienteApi.ajustarInventario(variante.id, {
        quantidadeContada: quantidade,
        observacao: observacao.trim(),
      });
      aoAjustar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível ajustar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={`Contagem de ${variante.sku}`} aoFechar={aoFechar}>
      <p className="text-[14px] leading-relaxed text-ink-soft">
        Informe quantas peças você contou na arara. O sistema lança o movimento que falta para o
        saldo bater — o estoque continua sendo a soma dos movimentos, nunca um número editado.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-[13px] text-ink-soft">No sistema</span>
          <p className="num mt-1 font-titulo text-[28px] font-semibold">{saldoSistema} un</p>
        </div>
        <Campo
          rotulo="Contado na arara"
          numerico
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          value={contado}
          onChange={(evento) => setContado(evento.target.value)}
          className="h-14 text-[17px]"
        />
      </div>

      {diferenca !== null && (
        <p
          className={cx(
            'num mt-4 rounded-[8px] px-4 py-3 text-[14px]',
            diferenca === 0 ? 'bg-ok/10 text-ok' : 'bg-alerta/10 text-alerta',
          )}
        >
          {diferenca === 0
            ? 'A contagem bate com o sistema. Nenhum movimento será lançado.'
            : `Diferença de ${diferenca > 0 ? '+' : ''}${diferenca} ${
                Math.abs(diferenca) === 1 ? 'peça' : 'peças'
              }.`}
        </p>
      )}

      <div className="mt-4">
        <Campo
          rotulo="Motivo da contagem"
          autoComplete="off"
          placeholder="inventário mensal, conferência da arara, peça danificada…"
          value={observacao}
          onChange={(evento) => setObservacao(evento.target.value)}
        />
        <p className="mt-1.5 text-[12px] text-ink-faint">
          Obrigatório. Ajuste sem motivo registrado é como sumiço vira “erro de sistema”.
        </p>
      </div>

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <Botao variante="discreto" onClick={aoFechar} disabled={enviando} className="flex-1">
          Voltar
        </Botao>
        <Botao
          variante="primario"
          tamanho="grande"
          className="flex-[2]"
          disabled={!podeEnviar}
          onClick={() => void ajustar()}
        >
          {enviando ? 'Registrando…' : 'Confirmar contagem'}
        </Botao>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Extrato de movimentação
// ---------------------------------------------------------------------------

function ModalExtrato({
  extrato,
  aoFechar,
}: {
  extrato: HistoricoMovimentacao;
  aoFechar: () => void;
}) {
  return (
    <Modal titulo={`Extrato de ${extrato.variante.sku}`} aoFechar={aoFechar}>
      <p className="text-[14px] text-ink-soft">
        {extrato.variante.produto}
        {[extrato.variante.tamanho, extrato.variante.cor].filter(Boolean).length > 0
          ? ` · ${[extrato.variante.tamanho, extrato.variante.cor].filter(Boolean).join(' · ')}`
          : ''}{' '}
        · saldo atual <strong className="num font-medium text-ink">{extrato.saldoAtual} un</strong>
      </p>

      {extrato.movimentos.length === 0 ? (
        <p className="mt-6 text-[14px] text-ink-faint">
          Nenhum movimento ainda. Esta variação nunca teve entrada nem venda.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line">
          {extrato.movimentos.map((movimento) => (
            <li key={movimento.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
              <span
                className={cx(
                  'num w-12 shrink-0 text-right text-[15px] font-medium',
                  movimento.quantidade < 0 ? 'text-perigo' : 'text-ok',
                )}
              >
                {movimento.quantidade > 0 ? '+' : ''}
                {movimento.quantidade}
              </span>
              <span className="text-[14px] text-ink">
                {ROTULO_MOVIMENTO[movimento.tipo] ?? movimento.tipo}
                {movimento.vendaNumero !== null ? ` nº ${movimento.vendaNumero}` : ''}
              </span>
              <span className="num text-[13px] text-ink-faint">
                deixou {movimento.saldoDepois} un
              </span>
              <span className="flex-1" />
              <span className="text-[12px] text-ink-faint">
                {new Date(movimento.criadoEm).toLocaleString('pt-BR')}
                {movimento.usuario ? ` · ${movimento.usuario}` : ''}
              </span>
              {movimento.observacao && (
                <p className="w-full text-[12px] text-ink-faint">{movimento.observacao}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Botao variante="neutro" tamanho="grande" className="w-full" onClick={aoFechar}>
          Fechar
        </Botao>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function Modal({
  titulo,
  children,
  aoFechar,
}: {
  titulo: string;
  children: React.ReactNode;
  aoFechar: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) aoFechar();
      }}
    >
      <div className="elevado flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-card border border-line bg-surface">
        <header className="border-b border-line px-6 py-4">
          <h2 className="font-titulo text-[18px] font-medium">{titulo}</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
