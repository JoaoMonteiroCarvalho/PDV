/**
 * Relatórios de venda.
 *
 * A tela responde três perguntas que a dona da loja faz toda semana: quanto
 * entrou, em que dia, e o que saiu mais. Nada além disso — um painel com
 * quinze indicadores vira um painel que ninguém lê.
 *
 * Os números vêm do SERVIDOR, não do catálogo local. Relatório é a única tela
 * do sistema em que estar desatualizado é pior do que não abrir: um
 * faturamento que ignora as vendas que ainda estão na fila do outro terminal
 * seria simplesmente errado.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { clienteApi, type RelatorioVendas } from '../api/cliente.js';
import { Botao, Cartao, Erro, Selo } from '../componentes/base.js';
import { GraficoBarras } from '../relatorios/GraficoBarras.js';
import {
  baixarCsv,
  centavosParaCsv,
  montarCsv,
  nomeDoArquivo,
  type ColunaCsv,
} from '../relatorios/csv.js';

/** `YYYY-MM-DD` local — o mesmo recorte de dia que o servidor usa. */
function dataLocal(data: Date): string {
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

function diasAtras(dias: number): string {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  return dataLocal(data);
}

const NOME_DA_FORMA: Readonly<Record<string, string>> = {
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Cartão débito',
  CREDITO: 'Cartão crédito',
  PIX: 'Pix',
  CREDIARIO: 'Fiado',
};

export function TelaRelatorios() {
  const [de, setDe] = useState(() => diasAtras(6));
  const [ate, setAte] = useState(() => dataLocal(new Date()));
  const [relatorio, setRelatorio] = useState<RelatorioVendas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setRelatorio(await clienteApi.relatorioVendas(de, ate));
      setErro(null);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar o relatório.');
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="font-titulo text-[24px]">Relatórios</h1>
      <p className="mt-1 text-[13px] text-ink-faint">
        Vendas do período. Os números vêm do servidor, não deste caixa.
      </p>

      <Cartao className="mt-5 flex flex-wrap items-end gap-4 p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-soft">De</span>
          <input
            type="date"
            value={de}
            max={ate}
            onChange={(evento) => setDe(evento.target.value)}
            className="num h-11 rounded-[12px] border border-line bg-surface px-3 text-[15px] focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-soft">Até</span>
          <input
            type="date"
            value={ate}
            min={de}
            onChange={(evento) => setAte(evento.target.value)}
            className="num h-11 rounded-[12px] border border-line bg-surface px-3 text-[15px] focus:border-accent"
          />
        </label>

        <div className="flex gap-2">
          <Botao variante="neutro" onClick={() => { setDe(dataLocal(new Date())); setAte(dataLocal(new Date())); }}>
            Hoje
          </Botao>
          <Botao variante="neutro" onClick={() => { setDe(diasAtras(6)); setAte(dataLocal(new Date())); }}>
            7 dias
          </Botao>
          <Botao variante="neutro" onClick={() => { setDe(diasAtras(29)); setAte(dataLocal(new Date())); }}>
            30 dias
          </Botao>
        </div>
      </Cartao>

      {erro && (
        <div className="mt-5">
          <Erro aoTentarNovamente={() => void carregar()}>{erro}</Erro>
        </div>
      )}

      {carregando && !relatorio && (
        <p className="py-14 text-center text-[14px] text-ink-faint">Carregando…</p>
      )}

      {relatorio && !erro && <Conteudo relatorio={relatorio} />}
    </div>
  );
}

function Conteudo({ relatorio }: { relatorio: RelatorioVendas }) {
  const vazio = relatorio.resumo.quantidadeVendas === 0;

  return (
    <>
      <dl className="mt-6 grid gap-3 sm:grid-cols-4">
        <Indicador rotulo="Vendas" valor={String(relatorio.resumo.quantidadeVendas)} testid="qtd-vendas" />
        <Indicador
          rotulo="Faturamento"
          valor={formatarBRL(centavos(relatorio.resumo.totalCentavos))}
          testid="faturamento"
          forte
        />
        <Indicador
          rotulo="Ticket médio"
          valor={formatarBRL(centavos(relatorio.resumo.ticketMedioCentavos))}
          testid="ticket-medio"
        />
        <Indicador rotulo="Peças" valor={String(relatorio.resumo.pecasVendidas)} testid="pecas" />
      </dl>

      {relatorio.resumo.descontoCentavos > 0 && (
        <p className="mt-3 text-[13px] text-ink-faint">
          Desconto concedido no período:{' '}
          <span className="num">{formatarBRL(centavos(relatorio.resumo.descontoCentavos))}</span>
        </p>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-titulo text-[18px]">Faturamento por dia</h2>
          <Botao
            variante="neutro"
            disabled={vazio}
            onClick={() => exportarPorDia(relatorio)}
          >
            Exportar CSV
          </Botao>
        </div>
        <div className="mt-4">
          <GraficoBarras
            titulo="Faturamento por dia"
            barras={relatorio.porDia.map((dia) => ({
              rotulo: dia.dia.slice(8),
              rotuloCompleto: dia.dia.split('-').reverse().join('/'),
              valorCentavos: dia.totalCentavos,
            }))}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-titulo text-[18px]">Como pagaram</h2>
        {relatorio.porForma.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-ink-faint">Sem pagamentos no período.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-card border border-line">
            {relatorio.porForma.map((forma) => (
              <li key={forma.forma} className="flex items-center justify-between px-4 py-3">
                <span className="text-[14px]">{NOME_DA_FORMA[forma.forma] ?? forma.forma}</span>
                <span className="flex items-center gap-3">
                  <Selo tom="neutro">
                    <span className="num">{forma.quantidade}</span>
                  </Selo>
                  <span className="num text-[15px] font-medium">
                    {formatarBRL(centavos(forma.totalCentavos))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-titulo text-[18px]">O que mais saiu</h2>
          <Botao
            variante="neutro"
            disabled={relatorio.maisVendidos.length === 0}
            onClick={() => exportarProdutos(relatorio)}
          >
            Exportar CSV
          </Botao>
        </div>
        {relatorio.maisVendidos.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-ink-faint">Nenhuma peça vendida.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-card border border-line">
            {relatorio.maisVendidos.map((produto) => (
              <li key={produto.sku} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px]">{produto.descricao}</p>
                  <p className="num truncate text-[12px] text-ink-faint">{produto.sku}</p>
                </div>
                <span className="num text-[14px] text-ink-soft">{produto.quantidade} un</span>
                <span className="num w-24 text-right text-[15px] font-medium">
                  {formatarBRL(centavos(produto.totalCentavos))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Indicador({
  rotulo,
  valor,
  testid,
  forte,
}: {
  rotulo: string;
  valor: string;
  testid: string;
  forte?: boolean;
}) {
  return (
    <Cartao className="p-4">
      <dt className="text-[13px] text-ink-soft">{rotulo}</dt>
      <dd
        data-testid={testid}
        className={`num mt-1 font-titulo ${forte ? 'text-[24px] font-semibold' : 'text-[22px]'}`}
      >
        {valor}
      </dd>
    </Cartao>
  );
}

function exportarPorDia(relatorio: RelatorioVendas): void {
  const colunas: ColunaCsv<RelatorioVendas['porDia'][number]>[] = [
    { titulo: 'Dia', valor: (linha) => linha.dia.split('-').reverse().join('/') },
    { titulo: 'Vendas', valor: (linha) => String(linha.quantidade) },
    { titulo: 'Faturamento', valor: (linha) => centavosParaCsv(linha.totalCentavos) },
  ];
  baixarCsv(
    nomeDoArquivo('vendas-por-dia', relatorio.de, relatorio.ate),
    montarCsv(colunas, relatorio.porDia),
  );
}

function exportarProdutos(relatorio: RelatorioVendas): void {
  const colunas: ColunaCsv<RelatorioVendas['maisVendidos'][number]>[] = [
    { titulo: 'Produto', valor: (linha) => linha.descricao },
    { titulo: 'SKU', valor: (linha) => linha.sku },
    { titulo: 'Quantidade', valor: (linha) => String(linha.quantidade) },
    { titulo: 'Total', valor: (linha) => centavosParaCsv(linha.totalCentavos) },
  ];
  baixarCsv(
    nomeDoArquivo('produtos-vendidos', relatorio.de, relatorio.ate),
    montarCsv(colunas, relatorio.maisVendidos),
  );
}
