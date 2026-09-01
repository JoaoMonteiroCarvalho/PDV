/**
 * Estoque: o que a loja tem e entrada de mercadoria por XML da NF-e.
 *
 * A lista sai do catálogo LOCAL — conferir estoque no meio da loja, com a
 * internet oscilando, é rotina. A entrada, essa vai ao servidor: é dinheiro
 * virando mercadoria, e o livro-razão do estoque mora lá.
 *
 * O XML é lido no navegador, sem subir arquivo nenhum. A nota tem CNPJ,
 * endereço e valores do fornecedor; mandar isso para um servidor que não
 * precisa dela seria expor dado à toa.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { clienteApi } from '../api/cliente.js';
import { bancoLocal, type ItemCatalogo } from '../banco/local.js';
import { Botao, Campo, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import { SwatchCor } from '../componentes/SwatchCor.js';
import {
  ajustarQuantidade,
  conciliar,
  escolherVariante,
  paraEntrada,
  resumir,
  type LinhaConciliada,
} from '../estoque/conciliacao.js';
import { ErroNota, lerNotaFiscal, type NotaFiscal } from '../estoque/notaFiscal.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';

export function TelaEstoque() {
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [nota, setNota] = useState<NotaFiscal | null>(null);
  const [linhas, setLinhas] = useState<LinhaConciliada[]>([]);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  // `liveQuery`: a lista se corrige sozinha quando o catálogo sincroniza, e
  // logo depois de dar entrada — sem a operadora precisar recarregar.
  useEffect(() => {
    const inscricao = liveQuery(() =>
      bancoLocal.catalogo.orderBy('nome').limit(1_000).toArray(),
    ).subscribe({ next: setCatalogo });
    return () => inscricao.unsubscribe();
  }, []);

  async function aoEscolherArquivo(arquivo: File) {
    setErroArquivo(null);
    try {
      const lida = lerNotaFiscal(await arquivo.text());
      setNota(lida);
      setLinhas(conciliar(lida.itens, catalogo));
    } catch (falha) {
      setNota(null);
      setLinhas([]);
      setErroArquivo(
        falha instanceof ErroNota ? falha.message : 'Não foi possível ler o arquivo.',
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <h1 className="font-titulo text-[24px]">Estoque</h1>
      <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
        O que este caixa tem baixado, e entrada de mercadoria pelo XML da nota.
      </p>

      {nota ? (
        <Conferencia
          nota={nota}
          linhas={linhas}
          catalogo={catalogo}
          aoMudar={setLinhas}
          aoCancelar={() => {
            setNota(null);
            setLinhas([]);
          }}
        />
      ) : (
        <>
          <EntradaPorXml erro={erroArquivo} aoEscolher={(arquivo) => void aoEscolherArquivo(arquivo)} />
          <ListaDeEstoque catalogo={catalogo} />
        </>
      )}
    </div>
  );
}

function EntradaPorXml({
  erro,
  aoEscolher,
}: {
  erro: string | null;
  aoEscolher: (arquivo: File) => void;
}) {
  return (
    <Cartao className="mt-6 p-5">
      <h2 className="font-titulo text-[16px] font-medium">Entrada de mercadoria</h2>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-faint">
        Envie o XML da NF-e que veio com a mercadoria. O arquivo é lido{' '}
        <strong className="font-medium">aqui no computador</strong> — a nota tem dados do
        fornecedor que não precisam sair daqui.
      </p>

      <label className="mt-4 inline-flex cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-line px-4 py-3 transition-colors hover:bg-sunken">
        <input
          type="file"
          accept=".xml,text/xml,application/xml"
          className="sr-only"
          aria-label="Arquivo XML da nota fiscal"
          onChange={(evento) => {
            const arquivo = evento.target.files?.[0];
            if (arquivo) aoEscolher(arquivo);
            // Zera o input: escolher o MESMO arquivo de novo precisa disparar
            // o evento, o que não acontece se o valor não mudar.
            evento.target.value = '';
          }}
        />
        <span className="text-[14px] text-ink">Escolher XML da nota…</span>
      </label>

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}
    </Cartao>
  );
}

function Conferencia({
  nota,
  linhas,
  catalogo,
  aoMudar,
  aoCancelar,
}: {
  nota: NotaFiscal;
  linhas: LinhaConciliada[];
  catalogo: ItemCatalogo[];
  aoMudar: (proximas: LinhaConciliada[]) => void;
  aoCancelar: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState<{ pecas: number; movimentos: number } | null>(null);

  const resumo = useMemo(() => resumir(linhas), [linhas]);

  async function darEntrada() {
    setErro(null);
    setEnviando(true);
    try {
      const resultado = await clienteApi.registrarEntradaEstoque({
        itens: paraEntrada(linhas),
        // A chave identifica a nota sem ambiguidade; o número serve de reserva.
        documento: nota.chave ?? `NF-${nota.numero}`,
        observacao: `Entrada por XML — ${nota.fornecedor}`,
      });
      setConcluido(resultado);
      // O saldo mudou no servidor: puxa o catálogo para a lista refletir.
      void motorSincronizacao.sincronizarCatalogo();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível dar entrada.');
    } finally {
      setEnviando(false);
    }
  }

  if (concluido) {
    return (
      <div className="py-16 text-center">
        <Selo tom="ok">Entrada registrada</Selo>
        <p className="num mt-4 font-titulo text-[36px] font-semibold">{concluido.pecas} peças</p>
        <p className="mt-3 text-[14px] text-ink-soft">
          {concluido.movimentos} {concluido.movimentos === 1 ? 'item entrou' : 'itens entraram'} no
          estoque, com o custo da nota.
        </p>
        <Botao variante="primario" tamanho="grande" className="mt-8" onClick={aoCancelar}>
          Concluir
        </Botao>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <Cartao className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-titulo text-[16px] font-medium">
              Nota {nota.numero} — {nota.fornecedor}
            </h2>
            <p className="num mt-1 text-[13px] text-ink-faint">
              {resumo.total} {resumo.total === 1 ? 'item' : 'itens'} ·{' '}
              {formatarBRL(centavos(resumo.custoTotalCentavos))} em custo
            </p>
          </div>
          <Botao variante="discreto" onClick={aoCancelar}>
            Trocar nota
          </Botao>
        </div>

        {resumo.pendentes > 0 && (
          <div className="mt-4 rounded-[12px] border border-alerta/40 bg-alerta/5 px-4 py-3 text-[14px] leading-relaxed text-ink">
            <strong className="font-medium">
              {resumo.pendentes} {resumo.pendentes === 1 ? 'item não foi' : 'itens não foram'}{' '}
              reconhecido{resumo.pendentes === 1 ? '' : 's'}.
            </strong>{' '}
            Escolha a peça na lista ou deixe de fora — o resto entra do mesmo jeito, e a mercadoria
            que já está na loja não fica esperando um cadastro.
          </div>
        )}
      </Cartao>

      <div className="mt-4 space-y-2">
        {linhas.map((linha) => (
          <LinhaDaNota
            key={linha.item.numeroItem}
            linha={linha}
            catalogo={catalogo}
            aoEscolher={(varianteId) =>
              aoMudar(escolherVariante(linhas, linha.item.numeroItem, varianteId))
            }
            aoAjustar={(quantidade) =>
              aoMudar(ajustarQuantidade(linhas, linha.item.numeroItem, quantidade))
            }
          />
        ))}
      </div>

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Botao
          variante="primario"
          tamanho="grande"
          disabled={resumo.pecasParaEntrada === 0 || enviando}
          onClick={() => void darEntrada()}
        >
          {enviando ? 'Registrando…' : `Dar entrada em ${resumo.pecasParaEntrada} peças`}
        </Botao>
        <Botao variante="neutro" tamanho="grande" onClick={aoCancelar}>
          Cancelar
        </Botao>
      </div>

      {resumo.pecasParaEntrada === 0 && (
        <p className="mt-3 text-[13px] text-ink-faint">
          Nenhum item reconhecido ainda. Escolha ao menos uma peça para dar entrada.
        </p>
      )}
    </div>
  );
}

const ROTULO_ORIGEM: Record<LinhaConciliada['como'], string> = {
  'codigo-barras': 'código de barras',
  sku: 'código igual ao SKU',
  manual: 'escolhido na mão',
  pendente: 'não reconhecido',
};

function LinhaDaNota({
  linha,
  catalogo,
  aoEscolher,
  aoAjustar,
}: {
  linha: LinhaConciliada;
  catalogo: ItemCatalogo[];
  aoEscolher: (varianteId: string | null) => void;
  aoAjustar: (quantidade: number) => void;
}) {
  const pendente = linha.varianteId === null;

  return (
    <Cartao
      className={cx('p-4', pendente && 'border-alerta/40')}
      elevado={false}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem] flex-1">
          <p className="text-[14px] font-medium text-ink">
            <span className="num mr-2 text-ink-faint">{linha.item.numeroItem}.</span>
            {linha.item.descricao}
          </p>
          <p className="num mt-1 text-[12px] text-ink-faint">
            {linha.item.codigoFornecedor}
            {linha.item.codigoBarras && ` · ${linha.item.codigoBarras}`} ·{' '}
            {formatarBRL(centavos(linha.item.custoUnitarioCentavos))} cada
          </p>
        </div>

        <label className="flex items-center gap-2">
          <span className="text-[12px] text-ink-soft">qtd</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            aria-label={`Quantidade do item ${linha.item.numeroItem}`}
            value={linha.quantidade === 0 ? '' : linha.quantidade}
            placeholder="0"
            onChange={(evento) => aoAjustar(Number.parseInt(evento.target.value, 10))}
            className="num w-16 rounded-[8px] border border-line bg-surface px-2 py-1 text-right text-[14px] focus:border-accent"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Selo tom={pendente ? 'alerta' : 'ok'}>{ROTULO_ORIGEM[linha.como]}</Selo>
        <select
          aria-label={`Peça do item ${linha.item.numeroItem}`}
          value={linha.varianteId ?? ''}
          onChange={(evento) => aoEscolher(evento.target.value || null)}
          className="min-w-[16rem] flex-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink focus:border-accent"
        >
          <option value="">— deixar de fora desta entrada —</option>
          {catalogo.map((variante) => (
            <option key={variante.id} value={variante.id}>
              {variante.nome}
              {variante.cor ? ` · ${variante.cor}` : ''}
              {variante.tamanho ? ` · ${variante.tamanho}` : ''} ({variante.sku})
            </option>
          ))}
        </select>
      </div>
    </Cartao>
  );
}

function ListaDeEstoque({ catalogo }: { catalogo: ItemCatalogo[] }) {
  const [termo, setTermo] = useState('');

  const filtrado = useMemo(() => {
    const busca = termo.trim().toLowerCase();
    const base = busca
      ? catalogo.filter(
          (variante) =>
            variante.nome.toLowerCase().includes(busca) ||
            variante.sku.toLowerCase().includes(busca),
        )
      : catalogo;
    // Menor saldo primeiro: é o que a loja precisa repor, e a razão de abrir
    // esta tela na maioria das vezes.
    return [...base].sort((a, b) => a.saldoEstoque - b.saldoEstoque).slice(0, 200);
  }, [catalogo, termo]);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-titulo text-[18px]">O que tem na loja</h2>
        <div className="w-full max-w-xs">
          <Campo
            rotulo="Filtrar"
            placeholder="nome ou SKU"
            value={termo}
            onChange={(evento) => setTermo(evento.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      {filtrado.length === 0 ? (
        <p className="py-12 text-center text-[14px] text-ink-faint">
          {catalogo.length === 0
            ? 'O catálogo ainda não sincronizou neste computador.'
            : `Nada encontrado para “${termo.trim()}”.`}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line">
          {filtrado.map((variante) => (
            <li key={variante.id} className="flex items-center gap-3 px-4 py-2.5">
              {variante.cor && <SwatchCor cor={variante.cor} tamanho={16} />}
              <div className="min-w-0 flex-1">
                <Link
                  to={`/produto/${variante.produtoId}`}
                  className="truncate text-[14px] text-ink hover:text-accent hover:underline"
                >
                  {variante.nome}
                </Link>
                <p className="num truncate text-[12px] text-ink-faint">
                  {[variante.cor, variante.tamanho].filter(Boolean).join(' · ')}
                  {variante.cor || variante.tamanho ? ' · ' : ''}
                  {variante.sku}
                </p>
              </div>
              <Saldo saldo={variante.saldoEstoque} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Saldo({ saldo }: { saldo: number }) {
  /*
   * Saldo negativo aparece como negativo, não como zero. Ele significa que
   * vendeu mais do que o cadastro diz existir — esconder isso tiraria da loja
   * o único sinal de que aquele produto precisa de conferência.
   */
  if (saldo < 0) return <Selo tom="perigo">{saldo} — conferir</Selo>;
  if (saldo === 0) return <Selo tom="alerta">esgotado</Selo>;
  return <span className="num text-[15px] font-medium text-ink">{saldo}</span>;
}
