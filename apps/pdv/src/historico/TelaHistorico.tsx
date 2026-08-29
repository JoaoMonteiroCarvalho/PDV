/**
 * Histórico de vendas navegável.
 *
 * Lista da mais recente para a mais antiga, com filtro de período e
 * operador, paginada por cursor no mesmo esquema do catálogo — sem isso, uma
 * venda registrada no meio da navegação poderia deslocar as páginas e sumir
 * da tela. Clicar numa linha abre o detalhe completo, incluindo devoluções
 * já feitas — a venda original nunca muda, então o que aparece aqui é sempre
 * o que realmente aconteceu.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { clienteApi, type DetalheVenda, type LinhaHistoricoVenda } from '../api/cliente.js';

const NOME_DA_FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  PIX: 'PIX',
  CREDIARIO: 'Crediário',
};

interface Props {
  readonly aoVoltar: () => void;
}

export function TelaHistorico({ aoVoltar }: Props) {
  const [vendaSelecionadaId, setVendaSelecionadaId] = useState<string | null>(null);

  return (
    <div className="tela-caixa">
      <div className="cartao-caixa cartao-caixa-historico">
        <div className="cabecalho-devolucao">
          <h1>Histórico de vendas</h1>
          <button onClick={aoVoltar}>Voltar</button>
        </div>

        {vendaSelecionadaId ? (
          <DetalheVendaTela vendaId={vendaSelecionadaId} aoVoltar={() => setVendaSelecionadaId(null)} />
        ) : (
          <ListaVendas aoSelecionar={setVendaSelecionadaId} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ListaVendas({ aoSelecionar }: { aoSelecionar: (vendaId: string) => void }) {
  const [itens, setItens] = useState<LinhaHistoricoVenda[]>([]);
  const [cursor, setCursor] = useState<{ antesDe: string; ultimoId: string } | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [desde, setDesde] = useState('');
  const [ate, setAte] = useState('');

  const carregar = useCallback(
    async (reiniciar: boolean) => {
      setCarregando(true);
      setErro(null);
      try {
        const filtro: Parameters<typeof clienteApi.listarVendas>[0] = {};
        if (!reiniciar && cursor) {
          filtro.antesDe = cursor.antesDe;
          filtro.ultimoId = cursor.ultimoId;
        }
        if (desde) filtro.desde = new Date(desde).toISOString();
        if (ate) filtro.ate = new Date(ate).toISOString();

        const pagina = await clienteApi.listarVendas(filtro);
        setItens((atual) => (reiniciar ? pagina.itens : [...atual, ...pagina.itens]));
        setTemMais(pagina.temMais);
        setCursor(
          pagina.proximoAntesDe && pagina.proximoUltimoId
            ? { antesDe: pagina.proximoAntesDe, ultimoId: pagina.proximoUltimoId }
            : null,
        );
      } catch {
        setErro('Não foi possível carregar o histórico de vendas.');
      } finally {
        setCarregando(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [desde, ate],
  );

  // Recarrega do início sempre que o filtro de período muda.
  useEffect(() => {
    void carregar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, ate]);

  return (
    <div className="lista-historico">
      <div className="filtros-historico">
        <label>
          De
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
      </div>

      {erro && <p className="erro">{erro}</p>}

      {itens.length === 0 && !carregando ? (
        <p className="vazio">Nenhuma venda encontrada.</p>
      ) : (
        <table className="tabela-historico">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Data</th>
              <th>Operador</th>
              <th>Itens</th>
              <th>Pagamento</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {itens.map((venda) => (
              <tr key={venda.id} onClick={() => aoSelecionar(venda.id)} className="linha-clicavel">
                <td>#{venda.numero}</td>
                <td>{new Date(venda.registradaEm).toLocaleString('pt-BR')}</td>
                <td>{venda.operador.nome}</td>
                <td>{venda.quantidadeItens}</td>
                <td>{venda.formasPagamento.map((f) => NOME_DA_FORMA[f] ?? f).join(' + ')}</td>
                <td>
                  {formatarBRL(centavos(venda.totalCentavos))}
                  {venda.totalDevolvidoCentavos > 0 && (
                    <span className="marca-devolucao">
                      {' '}
                      (devolvido {formatarBRL(centavos(venda.totalDevolvidoCentavos))})
                    </span>
                  )}
                </td>
                <td className="ver-mais">Ver →</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {temMais && (
        <button className="carregar-mais" disabled={carregando} onClick={() => void carregar(false)}>
          {carregando ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DetalheVendaTela({ vendaId, aoVoltar }: { vendaId: string; aoVoltar: () => void }) {
  const [detalhe, setDetalhe] = useState<DetalheVenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    clienteApi
      .buscarDetalheVenda(vendaId)
      .then(setDetalhe)
      .catch(() => setErro('Não foi possível carregar o detalhe da venda.'));
  }, [vendaId]);

  if (erro) {
    return (
      <div className="detalhe-venda">
        <p className="erro">{erro}</p>
        <button onClick={aoVoltar}>Voltar à lista</button>
      </div>
    );
  }

  if (!detalhe) return <p>Carregando…</p>;

  return (
    <div className="detalhe-venda">
      <button className="voltar-lista" onClick={aoVoltar}>
        ← Voltar à lista
      </button>

      <p className="ajuda">
        Venda #{detalhe.numero} — {new Date(detalhe.registradaEm).toLocaleString('pt-BR')} — operador{' '}
        {detalhe.operador.nome}
        {detalhe.cliente && <> — cliente {detalhe.cliente.nome}</>}
      </p>

      <ul className="itens-devolucao">
        {detalhe.itens.map((item) => (
          <li key={item.id}>
            <div className="descricao">
              <strong>{item.descricao}</strong>
              <span>
                {item.sku}
                {(item.tamanho || item.cor) && (
                  <> · {[item.tamanho, item.cor].filter(Boolean).join(' · ')}</>
                )}{' '}
                · {item.quantidade}× {formatarBRL(centavos(item.precoUnitarioCentavos))}
              </span>
            </div>
            <span className="valor">{formatarBRL(centavos(item.totalCentavos))}</span>
          </li>
        ))}
      </ul>

      <div className="linha total">
        <span>Subtotal</span>
        <span>{formatarBRL(centavos(detalhe.subtotalCentavos))}</span>
      </div>
      {detalhe.descontoCentavos > 0 && (
        <div className="linha">
          <span>Desconto</span>
          <span>-{formatarBRL(centavos(detalhe.descontoCentavos))}</span>
        </div>
      )}
      <div className="linha total">
        <span>Total</span>
        <span>{formatarBRL(centavos(detalhe.totalCentavos))}</span>
      </div>

      <h3>Pagamento</h3>
      <ul>
        {detalhe.pagamentos.map((pagamento, indice) => (
          <li key={indice}>
            {NOME_DA_FORMA[pagamento.forma] ?? pagamento.forma}: {formatarBRL(centavos(pagamento.valorCentavos))}
            {pagamento.trocoCentavos > 0 && ` (troco ${formatarBRL(centavos(pagamento.trocoCentavos))})`}
          </li>
        ))}
      </ul>

      {detalhe.devolucoes.length > 0 && (
        <>
          <h3>Devoluções desta venda</h3>
          <ul className="devolucoes-historico">
            {detalhe.devolucoes.map((devolucao) => (
              <li key={devolucao.id}>
                <div className="descricao">
                  <strong>{new Date(devolucao.criadoEm).toLocaleString('pt-BR')}</strong>
                  <span>
                    {devolucao.motivo} · estorno em {NOME_DA_FORMA[devolucao.formaEstorno] ?? devolucao.formaEstorno}{' '}
                    · autorizado por {devolucao.autorizadoPor.nome}
                  </span>
                </div>
                <span className="valor">{formatarBRL(centavos(devolucao.valorCentavos))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
