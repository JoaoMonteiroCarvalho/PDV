import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useNavegacao } from '@/estado/useNavegacao.js';
import { useOperadores, useRelatorioResumo } from '@/servicos/relatorios.js';

const NOME_FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_DEBITO: 'Cartão débito',
  CARTAO_CREDITO: 'Cartão crédito',
  CREDIARIO: 'Crediário',
  CARTAO: 'Cartão',
  VALE_TROCA: 'Vale-troca',
};

function Cartao({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-borda bg-superficie p-4">
      <p className="text-rotulo text-texto-secundario">{rotulo}</p>
      <p className="text-valor">{valor}</p>
    </div>
  );
}

export function TelaRelatorios() {
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const [desde, setDesde] = useState('');
  const [ate, setAte] = useState('');
  const [operadorId, setOperadorId] = useState('');

  const { data: operadoresData } = useOperadores();
  const { data, isLoading, isError } = useRelatorioResumo({
    ...(desde && { desde: new Date(desde).toISOString() }),
    ...(ate && { ate: new Date(ate).toISOString() }),
    ...(operadorId && { operadorId }),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-valor">Relatórios</h1>
        <Button variante="fantasma" onClick={irParaVenda}>
          Voltar pra venda
        </Button>
      </header>

      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="relatorio-desde" className="text-rotulo text-texto-secundario">
            Desde
          </label>
          <Input id="relatorio-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="relatorio-ate" className="text-rotulo text-texto-secundario">
            Até
          </label>
          <Input id="relatorio-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="relatorio-operador" className="text-rotulo text-texto-secundario">
            Operador
          </label>
          <select
            id="relatorio-operador"
            value={operadorId}
            onChange={(e) => setOperadorId(e.target.value)}
            className="h-alvo rounded border border-borda bg-fundo px-3 text-corpo text-texto"
          >
            <option value="">Todos</option>
            {operadoresData?.operadores.map((operador) => (
              <option key={operador.id} value={operador.id}>
                {operador.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-corpo text-texto-secundario">Carregando…</p>}
      {isError && (
        <p role="alert" className="text-corpo text-perigo">
          Não foi possível carregar o relatório. Verifique a conexão.
        </p>
      )}

      {data && (
        <>
          <p className="text-rotulo text-texto-secundario">
            Período: {new Date(data.periodo.desde).toLocaleDateString('pt-BR')} a{' '}
            {new Date(data.periodo.ate).toLocaleDateString('pt-BR')}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Cartao rotulo="Vendido" valor={formatarBRL(centavos(data.totalVendidoCentavos))} />
            <Cartao rotulo="Devolvido" valor={formatarBRL(centavos(data.totalDevolvidoCentavos))} />
            <Cartao rotulo="Líquido" valor={formatarBRL(centavos(data.totalLiquidoCentavos))} />
            <Cartao rotulo="Ticket médio" valor={formatarBRL(centavos(data.ticketMedioCentavos))} />
            <Cartao rotulo="Vendas" valor={String(data.quantidadeVendas)} />
            <Cartao rotulo="Devoluções" valor={String(data.quantidadeDevolucoes)} />
          </div>

          <section className="space-y-2">
            <h2 className="text-corpo font-semibold">Por forma de pagamento</h2>
            {data.porFormaPagamento.length === 0 ? (
              <p className="text-rotulo text-texto-secundario">Nenhuma venda no período.</p>
            ) : (
              data.porFormaPagamento.map((linha) => (
                <div key={linha.forma} className="flex justify-between text-corpo">
                  <span>
                    {NOME_FORMA[linha.forma] ?? linha.forma} ({linha.quantidade})
                  </span>
                  <span>{formatarBRL(centavos(linha.totalCentavos))}</span>
                </div>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-corpo font-semibold">Por operador</h2>
            {data.porOperador.map((linha) => (
              <div key={linha.operadorId} className="flex justify-between text-corpo">
                <span>
                  {linha.nome} ({linha.quantidadeVendas} vendas)
                </span>
                <span>
                  {formatarBRL(centavos(linha.totalCentavos))} · ticket médio{' '}
                  {formatarBRL(centavos(linha.ticketMedioCentavos))}
                </span>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-corpo font-semibold">Produtos mais vendidos</h2>
            {data.produtosMaisVendidos.map((linha) => (
              <div key={linha.varianteId} className="flex justify-between text-corpo">
                <span>
                  {linha.descricao} <span className="text-rotulo text-texto-secundario">{linha.sku}</span>
                </span>
                <span>
                  {linha.quantidadeVendida} un. · {formatarBRL(centavos(linha.totalCentavos))}
                </span>
              </div>
            ))}
          </section>

          {data.devolucoesPorFormaEstorno.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-corpo font-semibold text-alerta">Devoluções por forma de estorno</h2>
              {data.devolucoesPorFormaEstorno.map((linha) => (
                <div key={linha.formaEstorno} className="flex justify-between text-corpo">
                  <span>
                    {NOME_FORMA[linha.formaEstorno] ?? linha.formaEstorno} ({linha.quantidade})
                  </span>
                  <span>{formatarBRL(centavos(linha.valorCentavos))}</span>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-corpo font-semibold">Por dia</h2>
            {data.porDia.map((ponto) => (
              <div key={ponto.data} className="flex justify-between text-corpo">
                <span>{new Date(ponto.data).toLocaleDateString('pt-BR')}</span>
                <span>
                  {ponto.quantidadeVendas} vendas · {formatarBRL(centavos(ponto.totalCentavos))}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
