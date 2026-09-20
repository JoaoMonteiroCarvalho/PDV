/**
 * Contas a receber — o fiado em aberto.
 *
 * O relatório de vendas diz o que a loja FATUROU. Este diz o que ela tem a
 * RECEBER, e são números diferentes: uma venda fiada de R$ 300 entra inteira
 * no faturamento do dia e não põe um centavo na gaveta. Sem esta tela, a loja
 * enxergava só metade da própria posição financeira.
 *
 * A ordem da lista é a ordem da ligação de cobrança: quem deve vencido
 * primeiro, e dentro disso quem deve mais. A tela existe para alguém começar
 * pelo topo, não para ser navegada.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { clienteApi, type ClienteAReceber, type RelatorioContasAReceber } from '../api/cliente.js';
import { Botao, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import {
  baixarCsv,
  centavosParaCsv,
  dataParaCsv,
  montarCsv,
  type ColunaCsv,
} from '../relatorios/csv.js';

/** Uma linha por PARCELA — ver o comentário em `exportar`. */
interface LinhaCsv {
  readonly cliente: string;
  readonly telefone: string;
  readonly vendaNumero: number;
  readonly parcela: string;
  readonly vencimento: Date;
  readonly diasDeAtraso: number;
  readonly abertoCentavos: number;
}

const COLUNAS: readonly ColunaCsv<LinhaCsv>[] = [
  { titulo: 'Cliente', valor: (linha) => linha.cliente },
  { titulo: 'Telefone', valor: (linha) => linha.telefone },
  { titulo: 'Venda', valor: (linha) => String(linha.vendaNumero) },
  { titulo: 'Parcela', valor: (linha) => linha.parcela },
  { titulo: 'Vencimento', valor: (linha) => dataParaCsv(linha.vencimento) },
  { titulo: 'Dias de atraso', valor: (linha) => String(linha.diasDeAtraso) },
  { titulo: 'Em aberto', valor: (linha) => centavosParaCsv(linha.abertoCentavos) },
];

export function TelaContasAReceber() {
  const [relatorio, setRelatorio] = useState<RelatorioContasAReceber | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void clienteApi
      .contasAReceber()
      .then((dados) => {
        if (!cancelado) setRelatorio(dados);
      })
      .catch((falha: unknown) => {
        if (!cancelado) {
          setErro(
            falha instanceof Error ? falha.message : 'Não foi possível carregar as contas a receber.',
          );
        }
      });
    return () => {
      cancelado = true;
    };
  }, []);

  function exportar() {
    if (!relatorio) return;
    /*
     * Uma linha por PARCELA, não por cliente. Quem exporta isto vai abrir na
     * planilha para montar a régua de cobrança, e lá a unidade de trabalho é
     * a parcela com seu vencimento — agrupado por cliente, a data se perde.
     */
    const linhas: LinhaCsv[] = relatorio.clientes.flatMap((cliente) =>
      cliente.parcelas.map((parcela) => ({
        cliente: cliente.nome,
        telefone: cliente.telefone ?? '',
        vendaNumero: parcela.vendaNumero,
        parcela: `${parcela.numero}/${parcela.totalParcelas}`,
        vencimento: new Date(parcela.vencimento),
        diasDeAtraso: parcela.diasDeAtraso,
        abertoCentavos: parcela.abertoCentavos,
      })),
    );
    baixarCsv('contas-a-receber.csv', montarCsv(COLUNAS, linhas));
  }

  if (erro) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <Erro>{erro}</Erro>
      </div>
    );
  }

  if (!relatorio) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <p className="text-[14px] text-ink-faint">Carregando…</p>
      </div>
    );
  }

  const { resumo } = relatorio;

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-titulo text-[24px]">Contas a receber</h1>
          <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
            O fiado em aberto. Cada valor é o que <strong className="text-ink">falta</strong> na
            parcela — recebimentos parciais já vêm descontados.
          </p>
        </div>
        {resumo.parcelas > 0 && (
          <Botao variante="neutro" onClick={exportar}>
            Exportar CSV
          </Botao>
        )}
      </div>

      {resumo.parcelas === 0 ? (
        <Cartao className="mt-6 p-8 text-center">
          <Selo tom="ok">Nada a receber</Selo>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
            Nenhuma parcela de fiado em aberto. Tudo que foi vendido a prazo já foi recebido.
          </p>
        </Cartao>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Totalizador
              rotulo="Total em aberto"
              valor={resumo.abertoCentavos}
              detalhe={`${resumo.clientes} ${resumo.clientes === 1 ? 'cliente' : 'clientes'}`}
            />
            {/*
              Vencido em vermelho e a vencer em neutro. São dois números de
              natureza diferente: um é dinheiro atrasado, o outro é dinheiro
              programado, e misturá-los num total só esconde o problema.
            */}
            <Totalizador rotulo="Vencido" valor={resumo.vencidoCentavos} tom="perigo" />
            <Totalizador rotulo="A vencer" valor={resumo.aVencerCentavos} />
          </div>

          <ul className="mt-6 space-y-3">
            {relatorio.clientes.map((cliente) => (
              <LinhaCliente key={cliente.clienteId} cliente={cliente} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Totalizador({
  rotulo,
  valor,
  detalhe,
  tom,
}: {
  rotulo: string;
  valor: number;
  detalhe?: string;
  tom?: 'perigo';
}) {
  return (
    <Cartao className="p-4">
      <span className="text-[13px] text-ink-soft">{rotulo}</span>
      <p
        className={cx(
          'num mt-1 font-titulo text-[24px] font-semibold',
          tom === 'perigo' && valor > 0 ? 'text-perigo' : 'text-ink',
        )}
      >
        {formatarBRL(centavos(valor))}
      </p>
      {detalhe && <p className="mt-0.5 text-[12px] text-ink-faint">{detalhe}</p>}
    </Cartao>
  );
}

function LinhaCliente({ cliente }: { cliente: ClienteAReceber }) {
  const [aberto, setAberto] = useState(false);
  const temVencido = cliente.vencidoCentavos > 0;

  return (
    <li>
      <Cartao className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[15px] font-medium text-ink">{cliente.nome}</span>
          {temVencido && <Selo tom="perigo">vencido</Selo>}
          {cliente.telefone && (
            <span className="num text-[13px] text-ink-faint">{cliente.telefone}</span>
          )}
          <span className="flex-1" />
          <span className="num text-[17px] font-semibold">
            {formatarBRL(centavos(cliente.abertoCentavos))}
          </span>
        </div>

        {temVencido && (
          <p className="num mt-1 text-[13px] text-perigo">
            {formatarBRL(centavos(cliente.vencidoCentavos))} vencidos
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setAberto((atual) => !atual)}
            className="text-[13px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
          >
            {aberto
              ? 'Ocultar parcelas'
              : `Ver ${cliente.parcelas.length} ${cliente.parcelas.length === 1 ? 'parcela' : 'parcelas'}`}
          </button>
          {/*
            O caminho do "e agora?": a ficha da cliente é onde se recebe a
            parcela. Sem este link a gerente teria que ir a Clientes e buscar
            de novo o nome que acabou de ler aqui.
          */}
          <Link
            to="/clientes"
            className="text-[13px] text-accent underline-offset-2 hover:underline"
          >
            Receber em Clientes
          </Link>
        </div>

        {aberto && (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {cliente.parcelas.map((parcela) => (
              <li
                key={parcela.parcelaId}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
              >
                <span className="num text-[13px] text-ink-soft">
                  {parcela.numero}/{parcela.totalParcelas}
                </span>
                <span className="text-[13px] text-ink-faint">venda nº {parcela.vendaNumero}</span>
                <span
                  className={cx(
                    'num text-[13px]',
                    parcela.diasDeAtraso > 0 ? 'text-perigo' : 'text-ink-soft',
                  )}
                >
                  {new Date(parcela.vencimento).toLocaleDateString('pt-BR')}
                  {parcela.diasDeAtraso > 0
                    ? ` · ${parcela.diasDeAtraso} ${parcela.diasDeAtraso === 1 ? 'dia' : 'dias'} de atraso`
                    : ''}
                </span>
                <span className="flex-1" />
                {parcela.recebidoCentavos > 0 && (
                  <span className="num text-[12px] text-ink-faint">
                    já recebeu {formatarBRL(centavos(parcela.recebidoCentavos))}
                  </span>
                )}
                <span className="num text-[14px]">
                  {formatarBRL(centavos(parcela.abertoCentavos))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </li>
  );
}
