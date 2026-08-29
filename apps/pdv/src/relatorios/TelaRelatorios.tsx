/**
 * Relatório de vendas — o painel de gestão da loja.
 *
 * Filtra por período (padrão: últimos 30 dias) e por operador, mostra os
 * totais do período em destaque, série de vendas por dia, formas de
 * pagamento, desempenho por operador e produtos mais vendidos. Exporta em
 * CSV (para o Excel) e em PDF (via impressão do navegador — ver
 * `imprimirRelatorio.ts`).
 *
 * Tudo calculado no servidor por `calcularRelatorio` (packages/shared): a
 * tela só formata o que já vem pronto, sem repetir a matemática.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clienteApi, type RelatorioResumo } from '../api/cliente.js';
import { baixarComoCsv } from './exportarCsv.js';
import { imprimirRelatorio } from './imprimirRelatorio.js';

const NOME_DA_FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  PIX: 'PIX',
  CREDIARIO: 'Crediário',
  CARTAO: 'Cartão',
  VALE_TROCA: 'Vale-troca',
};

function dataIsoParaInput(data: Date): string {
  return data.toISOString().slice(0, 10);
}

interface Props {
  readonly nomeDaLoja: string;
  readonly aoVoltar: () => void;
}

export function TelaRelatorios({ nomeDaLoja, aoVoltar }: Props) {
  const hoje = useMemo(() => new Date(), []);
  const trintaDiasAtras = useMemo(() => new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000), [hoje]);

  const [desde, setDesde] = useState(dataIsoParaInput(trintaDiasAtras));
  const [ate, setAte] = useState(dataIsoParaInput(hoje));
  const [operadorId, setOperadorId] = useState('');
  const [operadores, setOperadores] = useState<Array<{ id: string; nome: string }>>([]);

  const [dados, setDados] = useState<RelatorioResumo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    clienteApi
      .listarOperadores()
      .then((resposta) => setOperadores(resposta.operadores))
      .catch(() => setOperadores([]));
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const filtro: Parameters<typeof clienteApi.buscarRelatorioResumo>[0] = {
        desde: new Date(`${desde}T00:00:00.000Z`).toISOString(),
        ate: new Date(`${ate}T23:59:59.999Z`).toISOString(),
      };
      if (operadorId) filtro.operadorId = operadorId;
      const resposta = await clienteApi.buscarRelatorioResumo(filtro);
      setDados(resposta);
    } catch {
      setErro('Não foi possível carregar o relatório.');
    } finally {
      setCarregando(false);
    }
  }, [desde, ate, operadorId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const maiorDia = Math.max(1, ...(dados?.porDia.map((d) => d.totalCentavos) ?? [0]));
  const maiorFormaPagamento = Math.max(1, ...(dados?.porFormaPagamento.map((f) => f.totalCentavos) ?? [0]));

  return (
    <div className="tela-caixa">
      <div className="cartao-caixa cartao-caixa-historico">
        <div className="cabecalho-devolucao">
          <h1>Relatório de vendas</h1>
          <button onClick={aoVoltar}>Voltar</button>
        </div>

        <div className="filtros-historico filtros-relatorio">
          <label>
            De
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </label>
          <label>
            Operador
            <select value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
              <option value="">Todos</option>
              {operadores.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.nome}
                </option>
              ))}
            </select>
          </label>

          <span className="preenche-relatorio" />

          <button disabled={!dados} onClick={() => dados && baixarComoCsv(dados)}>
            Exportar CSV
          </button>
          <button disabled={!dados} onClick={() => dados && imprimirRelatorio(dados, nomeDaLoja)}>
            Imprimir / PDF
          </button>
        </div>

        {erro && <p className="erro">{erro}</p>}

        {carregando && !dados ? (
          <p>Carregando…</p>
        ) : (
          dados && (
            <div className="painel-relatorio">
              <div className="cartoes-kpi">
                <CartaoKpi rotulo="Total vendido" valorCentavos={dados.totalVendidoCentavos} />
                <CartaoKpi rotulo="Total devolvido" valorCentavos={dados.totalDevolvidoCentavos} atencao={dados.totalDevolvidoCentavos > 0} />
                <CartaoKpi rotulo="Total líquido" valorCentavos={dados.totalLiquidoCentavos} destaque />
                <CartaoKpi rotulo="Ticket médio" valorCentavos={dados.ticketMedioCentavos} />
              </div>
              <p className="ajuda resumo-secundario">
                {dados.quantidadeVendas} venda(s) · {dados.totalItensVendidos} peça(s) vendida(s) ·{' '}
                {dados.quantidadeDevolucoes} devolução(ões)
              </p>

              <h3>Vendas por dia</h3>
              {dados.porDia.length === 0 ? (
                <p className="vazio">Nenhuma venda no período.</p>
              ) : (
                <div className="grafico-barras">
                  {dados.porDia.map((dia) => (
                    <div key={dia.data} className="coluna-barra" title={`${formatarBRL(centavos(dia.totalCentavos))} · ${dia.quantidadeVendas} venda(s)`}>
                      <div className="barra" style={{ height: `${Math.max(4, Math.round((dia.totalCentavos / maiorDia) * 100))}%` }} />
                      <span className="rotulo-dia">
                        {new Date(dia.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="colunas-relatorio">
                <div>
                  <h3>Por forma de pagamento</h3>
                  {dados.porFormaPagamento.length === 0 ? (
                    <p className="vazio">Sem dados.</p>
                  ) : (
                    <ul className="lista-barras-horizontais">
                      {dados.porFormaPagamento.map((forma) => (
                        <li key={forma.forma}>
                          <span className="rotulo-barra">{NOME_DA_FORMA[forma.forma] ?? forma.forma}</span>
                          <span className="barra-fundo">
                            <span
                              className="barra-preenchida"
                              style={{ width: `${Math.max(4, Math.round((forma.totalCentavos / maiorFormaPagamento) * 100))}%` }}
                            />
                          </span>
                          <span className="valor-barra">{formatarBRL(centavos(forma.totalCentavos))}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3>Por operador</h3>
                  {dados.porOperador.length === 0 ? (
                    <p className="vazio">Sem dados.</p>
                  ) : (
                    <table className="tabela-historico tabela-compacta">
                      <thead>
                        <tr>
                          <th>Operador</th>
                          <th>Vendas</th>
                          <th>Total</th>
                          <th>Ticket médio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dados.porOperador.map((op) => (
                          <tr key={op.operadorId}>
                            <td>{op.nome}</td>
                            <td>{op.quantidadeVendas}</td>
                            <td>{formatarBRL(centavos(op.totalCentavos))}</td>
                            <td>{formatarBRL(centavos(op.ticketMedioCentavos))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <h3>Produtos mais vendidos</h3>
              {dados.produtosMaisVendidos.length === 0 ? (
                <p className="vazio">Nenhum produto vendido no período.</p>
              ) : (
                <table className="tabela-historico tabela-compacta">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>SKU</th>
                      <th>Descrição</th>
                      <th>Qtd. vendida</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.produtosMaisVendidos.map((produto, indice) => (
                      <tr key={produto.varianteId}>
                        <td>{indice + 1}</td>
                        <td>{produto.sku}</td>
                        <td>{produto.descricao}</td>
                        <td>{produto.quantidadeVendida}</td>
                        <td>{formatarBRL(centavos(produto.totalCentavos))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CartaoKpi({
  rotulo,
  valorCentavos,
  destaque,
  atencao,
}: {
  rotulo: string;
  valorCentavos: number;
  destaque?: boolean;
  atencao?: boolean;
}) {
  const classe = ['cartao-kpi', destaque && 'cartao-kpi-destaque', atencao && 'cartao-kpi-atencao']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classe}>
      <span className="rotulo-kpi">{rotulo}</span>
      <span className="valor-kpi">{formatarBRL(centavos(valorCentavos))}</span>
    </div>
  );
}
