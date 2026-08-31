/**
 * Histórico de vendas.
 *
 * Existe para o operador localizar uma venda sem precisar do comprovante
 * físico em mãos — cliente sem nota, nota rasgada ou perdida. Lista as
 * vendas da sessão de caixa atual (não mistura turnos), com busca por nome
 * do cliente e paginação.
 *
 * Clicar numa linha leva direto para a devolução daquela venda, já com o
 * identificador resolvido — evita o operador ter que digitar de novo o
 * número que acabou de ver na lista.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { clienteApi, ErroApi, type VendaResumo } from '../api/cliente.js';
import { TelaDevolucao } from '../devolucao/TelaDevolucao.js';

interface Props {
  readonly sessaoCaixaId: string;
  readonly aoVoltar: () => void;
}

export function TelaHistorico({ sessaoCaixaId, aoVoltar }: Props) {
  const [vendaParaDevolver, setVendaParaDevolver] = useState<VendaResumo | null>(null);

  if (vendaParaDevolver) {
    return (
      <TelaDevolucao
        aoVoltar={() => setVendaParaDevolver(null)}
        vendaInicial={{
          id: vendaParaDevolver.id,
          numero: vendaParaDevolver.numero,
          totalCentavos: vendaParaDevolver.totalCentavos,
        }}
      />
    );
  }

  return (
    <div className="tela-caixa">
      <div className="cartao-caixa cartao-caixa-largo">
        <div className="cabecalho-devolucao">
          <h1>Histórico de vendas</h1>
          <button onClick={aoVoltar}>Voltar</button>
        </div>

        <ListaVendas sessaoCaixaId={sessaoCaixaId} aoEscolherDevolucao={setVendaParaDevolver} />
      </div>
    </div>
  );
}

function ListaVendas({
  sessaoCaixaId,
  aoEscolherDevolucao,
}: {
  sessaoCaixaId: string;
  aoEscolherDevolucao: (venda: VendaResumo) => void;
}) {
  const [cliente, setCliente] = useState('');
  const [pagina, setPagina] = useState(1);
  const [itens, setItens] = useState<VendaResumo[] | null>(null);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [erro, setErro] = useState<string | null>(null);

  // Volta para a primeira página sempre que o filtro de busca muda — senão o
  // operador pode ficar numa página que não existe mais no resultado filtrado.
  useEffect(() => {
    setPagina(1);
  }, [cliente]);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    clienteApi
      .listarVendas({ sessaoCaixaId, cliente: cliente.trim() || undefined, pagina, porPagina: 10 })
      .then((resposta) => {
        if (cancelado) return;
        setItens(resposta.itens);
        setTotalPaginas(resposta.totalPaginas);
      })
      .catch((falha) => {
        if (cancelado) return;
        setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o histórico.');
      });
    return () => {
      cancelado = true;
    };
  }, [sessaoCaixaId, cliente, pagina]);

  return (
    <div className="historico-vendas">
      <label>
        Buscar por cliente
        <input
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          placeholder="Nome do cliente"
          autoFocus
        />
      </label>

      {erro && <p className="erro">{erro}</p>}

      {!itens ? (
        <p>Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="vazio">Nenhuma venda encontrada nesta sessão de caixa.</p>
      ) : (
        <>
          <ul className="lista-historico">
            {itens.map((venda) => (
              <li key={venda.id}>
                <div className="descricao">
                  <strong>Venda #{venda.numero}</strong>
                  <span>
                    {venda.operador}
                    {venda.cliente ? ` · ${venda.cliente}` : ''} ·{' '}
                    {new Date(venda.registradaEm).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {venda.temDevolucao ? ' · já teve devolução' : ''}
                  </span>
                </div>
                <span className="valor">{formatarBRL(centavos(venda.totalCentavos))}</span>
                <button onClick={() => aoEscolherDevolucao(venda)}>Devolver</button>
              </li>
            ))}
          </ul>

          {totalPaginas > 1 && (
            <div className="paginacao-historico">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                Anterior
              </button>
              <span>
                Página {pagina} de {totalPaginas}
              </span>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
