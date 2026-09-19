/**
 * Consulta da auditoria.
 *
 * O sistema gravava em oito pontos — sangria, suprimento, divergência de
 * fechamento, desconto acima da alçada, devolução, entrada de estoque, ajuste
 * de inventário, alteração de preço — e **nada lia**. Auditoria que ninguém
 * consulta não dissuade ninguém: o registro existia para "quem autorizou
 * isso?" ter resposta, e a resposta morava num banco que só o desenvolvedor
 * alcança.
 *
 * A tela é de leitura e só. Não há botão de corrigir nem de apagar, e não é
 * omissão: o registro é insert-only por decisão, e não existe caminho no
 * código para alterá-lo.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { clienteApi, type RegistroAuditoria } from '../api/cliente.js';
import { Botao, Cartao, Erro, Selo, cx } from '../componentes/base.js';

/** Nome legível das ações. Chave desconhecida cai no próprio código. */
const ROTULO_ACAO: Readonly<Record<string, string>> = {
  SANGRIA: 'Sangria',
  SUPRIMENTO: 'Suprimento',
  DIVERGENCIA_FECHAMENTO_CAIXA: 'Caixa fechou com diferença',
  DESCONTO_ACIMA_DA_ALCADA: 'Desconto acima da alçada',
  DEVOLUCAO: 'Devolução',
  ENTRADA_ESTOQUE: 'Entrada de estoque',
  AJUSTE_INVENTARIO: 'Ajuste de inventário',
  ALTERACAO_PRECO: 'Alteração de preço',
  DIVERGENCIA_DE_PRECO: 'Preço praticado diferente do catálogo',
  CADASTRO_PRODUTO: 'Cadastro de produto',
  CADASTRO_VARIANTE: 'Cadastro de variação',
  DESATIVACAO_PRODUTO: 'Produto desativado',
  REATIVACAO_PRODUTO: 'Produto reativado',
  DESATIVACAO_VARIANTE: 'Variação desativada',
  REATIVACAO_VARIANTE: 'Variação reativada',
  RECEBIMENTO_CREDIARIO: 'Recebimento de crediário',
};

/** Ações em que dinheiro muda de mãos fora do fluxo normal de venda. */
const ACOES_SENSIVEIS = new Set([
  'SANGRIA',
  'DIVERGENCIA_FECHAMENTO_CAIXA',
  'DESCONTO_ACIMA_DA_ALCADA',
  'AJUSTE_INVENTARIO',
  'ALTERACAO_PRECO',
]);

function hojeISO(): string {
  const agora = new Date();
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

function diasAtrasISO(dias: number): string {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

export function TelaAuditoria() {
  const [acao, setAcao] = useState('');
  const [de, setDe] = useState(() => diasAtrasISO(30));
  const [ate, setAte] = useState(() => hojeISO());
  const [pagina, setPagina] = useState(1);

  const [acoes, setAcoes] = useState<string[]>([]);
  const [itens, setItens] = useState<RegistroAuditoria[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void clienteApi
      .listarAcoesAuditoria()
      .then(setAcoes)
      .catch(() => setAcoes([]));
  }, []);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const resposta = await clienteApi.consultarAuditoria({
        acao: acao || undefined,
        de: de || undefined,
        ate: ate || undefined,
        pagina,
      });
      setItens(resposta.itens);
      setTotal(resposta.total);
      setTotalPaginas(resposta.totalPaginas);
    } catch (falha) {
      setItens([]);
      setErro(falha instanceof Error ? falha.message : 'Não foi possível consultar a auditoria.');
    }
  }, [acao, de, ate, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar o filtro volta para a primeira página: manter a página 4 ao mudar o
  // período mostraria uma lista vazia que parece "não há registros".
  function trocarFiltro(aplicar: () => void) {
    aplicar();
    setPagina(1);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="font-titulo text-[24px]">Auditoria</h1>
      <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
        Tudo que envolve dinheiro fora do fluxo normal da venda: quem fez, quem autorizou e
        quando. Registro somente de leitura — nada aqui pode ser corrigido nem apagado.
      </p>

      <Cartao className="mt-6 flex flex-wrap items-end gap-4 p-5">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <span className="text-[13px] text-ink-soft">Ação</span>
          <select
            value={acao}
            onChange={(evento) => trocarFiltro(() => setAcao(evento.target.value))}
            className="h-12 rounded-[8px] border border-line bg-surface px-4 text-[16px] text-ink focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
          >
            <option value="">Todas as ações</option>
            {acoes.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_ACAO[valor] ?? valor}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-soft">De</span>
          <input
            type="date"
            value={de}
            onChange={(evento) => trocarFiltro(() => setDe(evento.target.value))}
            className="num h-12 rounded-[8px] border border-line bg-surface px-4 text-[15px] text-ink focus:border-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-soft">Até</span>
          <input
            type="date"
            value={ate}
            onChange={(evento) => trocarFiltro(() => setAte(evento.target.value))}
            className="num h-12 rounded-[8px] border border-line bg-surface px-4 text-[15px] text-ink focus:border-accent focus:outline-none"
          />
        </label>
      </Cartao>

      {erro && (
        <div className="mt-5">
          <Erro>{erro}</Erro>
        </div>
      )}

      {itens === null ? (
        <p className="mt-8 text-[14px] text-ink-faint">Consultando…</p>
      ) : itens.length === 0 ? (
        <Cartao className="mt-6 p-8 text-center">
          <p className="text-[14px] leading-relaxed text-ink-soft">
            Nenhum registro no período. Nada que exigisse autorização aconteceu entre essas datas.
          </p>
        </Cartao>
      ) : (
        <>
          <p className="mt-6 text-[13px] text-ink-faint">
            {total} {total === 1 ? 'registro' : 'registros'} no período
          </p>

          <ul className="mt-3 space-y-2">
            {itens.map((registro) => (
              <LinhaAuditoria key={registro.id} registro={registro} />
            ))}
          </ul>

          {totalPaginas > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Botao
                variante="neutro"
                disabled={pagina <= 1}
                onClick={() => setPagina((atual) => atual - 1)}
              >
                Anterior
              </Botao>
              <span className="num text-[14px] text-ink-soft">
                {pagina} de {totalPaginas}
              </span>
              <Botao
                variante="neutro"
                disabled={pagina >= totalPaginas}
                onClick={() => setPagina((atual) => atual + 1)}
              >
                Próxima
              </Botao>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LinhaAuditoria({ registro }: { registro: RegistroAuditoria }) {
  const [aberto, setAberto] = useState(false);
  const sensivel = ACOES_SENSIVEIS.has(registro.acao);

  return (
    <li>
      <Cartao className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cx('text-[15px]', sensivel ? 'font-medium text-ink' : 'text-ink')}>
            {ROTULO_ACAO[registro.acao] ?? registro.acao}
          </span>
          {sensivel && <Selo tom="alerta">exige autorização</Selo>}
          <span className="flex-1" />
          <span className="text-[12px] text-ink-faint">
            {new Date(registro.criadoEm).toLocaleString('pt-BR')}
          </span>
        </div>

        <p className="mt-1.5 text-[13px] text-ink-soft">
          por <strong className="font-medium text-ink">{registro.usuario}</strong>
          {/*
            Quem autorizou é o dado que esta tela existe para mostrar. Quando
            não há autorizador, dizer isso em palavras evita que a ausência
            pareça informação faltando.
          */}
          {registro.autorizadoPor ? (
            <>
              {' '}
              · autorizado por{' '}
              <strong className="font-medium text-ink">{registro.autorizadoPor}</strong>
            </>
          ) : (
            ' · sem autorização de terceiro'
          )}
        </p>

        <button
          type="button"
          onClick={() => setAberto((atual) => !atual)}
          className="mt-2 text-[13px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
        >
          {aberto ? 'Ocultar detalhes' : 'Ver detalhes'}
        </button>

        {aberto && (
          <dl className="mt-3 space-y-2 rounded-[8px] bg-sunken p-3 text-[12px]">
            <Detalhe rotulo="Antes" valor={registro.valorAntes} />
            <Detalhe rotulo="Depois" valor={registro.valorDepois} />
            <div>
              <dt className="text-ink-faint">Registro</dt>
              <dd className="num text-ink">
                {registro.entidade} · {registro.entidadeId}
              </dd>
            </div>
          </dl>
        )}
      </Cartao>
    </li>
  );
}

function Detalhe({ rotulo, valor }: { rotulo: string; valor: unknown }) {
  if (valor === null || valor === undefined) return null;
  return (
    <div>
      <dt className="text-ink-faint">{rotulo}</dt>
      <dd className="num whitespace-pre-wrap text-ink">{formatarValor(valor)}</dd>
    </div>
  );
}

/**
 * Formata o JSON guardado na auditoria para leitura humana.
 *
 * Campos terminados em `Centavos` viram moeda: a gerente que abre esta tela
 * está conferindo dinheiro, e `{"valorCentavos":15000}` obriga ela a dividir
 * por cem de cabeça no meio de uma investigação.
 */
function formatarValor(valor: unknown): string {
  if (typeof valor !== 'object' || valor === null) return String(valor);

  return Object.entries(valor as Record<string, unknown>)
    .map(([chave, conteudo]) => {
      if (chave.endsWith('Centavos') && typeof conteudo === 'number') {
        return `${chave.replace(/Centavos$/, '')}: ${formatarBRL(centavos(conteudo))}`;
      }
      if (chave === 'descontoBps' || chave === 'limiteOperadorBps') {
        const bps = typeof conteudo === 'number' ? conteudo : 0;
        return `${chave.replace(/Bps$/, '')}: ${(bps / 100).toFixed(2).replace('.', ',')}%`;
      }
      return `${chave}: ${
        typeof conteudo === 'object' && conteudo !== null ? JSON.stringify(conteudo) : String(conteudo)
      }`;
    })
    .join('\n');
}
