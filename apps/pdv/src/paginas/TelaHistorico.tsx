/**
 * Histórico de vendas — para o operador localizar uma venda sem ter o
 * comprovante em mãos.
 *
 * Filtra pela sessão de caixa ATUAL por padrão. Sem esse filtro, a operadora
 * veria vendas de qualquer turno — inclusive de outro dia, outra operadora,
 * outro terminal — e a lista deixaria de responder "o que aconteceu no meu
 * caixa hoje" para virar um despejo de tudo que já foi vendido.
 *
 * Cada linha tem um atalho para "Devolver": é o caminho mais curto para o
 * caso comum (cliente na loja agora, comprou nesta sessão) sem obrigar a
 * operadora a copiar o número da venda para colar na tela de devolução.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clienteApi, type VendaResumo } from '../api/cliente.js';
import { Botao, Campo, Cartao, Erro, Selo } from '../componentes/base.js';
import { useCaixa } from '../estado/caixaStore.js';

const POR_PAGINA = 20;

export function TelaHistorico() {
  const navegar = useNavigate();
  const sessao = useCaixa((estado) => estado.sessao);

  const [cliente, setCliente] = useState('');
  const [termoBuscado, setTermoBuscado] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<{ itens: VendaResumo[]; total: number; totalPaginas: number } | null>(
    null,
  );
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Digitar reinicia a busca na página 1 — senão a operadora poderia ficar
  // "presa" numa página 3 que não existe mais para o filtro novo.
  useEffect(() => {
    const temporizador = setTimeout(() => setTermoBuscado(cliente.trim()), 180);
    return () => clearTimeout(temporizador);
  }, [cliente]);

  useEffect(() => {
    setPagina(1);
  }, [termoBuscado]);

  useEffect(() => {
    if (!sessao) {
      setCarregando(false);
      return;
    }
    let vivo = true;
    setCarregando(true);
    setErro(null);
    clienteApi
      .listarVendas({
        sessaoCaixaId: sessao.id,
        cliente: termoBuscado || undefined,
        pagina,
        porPagina: POR_PAGINA,
      })
      .then((resultado) => {
        if (vivo) setDados(resultado);
      })
      .catch((falha) => {
        if (vivo) setErro(falha instanceof Error ? falha.message : 'Não foi possível listar as vendas.');
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [sessao, termoBuscado, pagina]);

  if (!sessao) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="font-titulo text-[22px]">Não há caixa aberto</h1>
        <p className="mt-3 text-[15px] text-ink-soft">
          O histórico mostra as vendas da sessão de caixa em curso.
        </p>
        <Botao variante="neutro" className="mt-6" onClick={() => navegar('/caixa')}>
          Ir para o caixa
        </Botao>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-[24px]">Histórico de vendas</h1>
          <p className="mt-1 text-[13px] text-ink-faint">Vendas desta sessão de caixa.</p>
        </div>
        <div className="w-full max-w-xs">
          <Campo
            rotulo="Buscar"
            deBusca
            placeholder="Nome do cliente"
            value={cliente}
            onChange={(evento) => setCliente(evento.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      {erro && (
        <div className="mt-6">
          <Erro aoTentarNovamente={() => setPagina((p) => p)}>{erro}</Erro>
        </div>
      )}

      {!erro && !carregando && dados?.itens.length === 0 && (
        <p className="py-16 text-center text-[14px] text-ink-faint">
          {termoBuscado
            ? `Nenhuma venda de "${termoBuscado}" nesta sessão de caixa.`
            : 'Nenhuma venda registrada nesta sessão de caixa.'}
        </p>
      )}

      {dados && dados.itens.length > 0 && (
        <>
          <Cartao className="mt-6 overflow-hidden">
            <ul className="divide-y divide-line">
              {dados.itens.map((venda) => (
                <LinhaVenda key={venda.id} venda={venda} aoDevolver={() => navegar('/devolucao')} />
              ))}
            </ul>
          </Cartao>

          {dados.totalPaginas > 1 && (
            <div className="mt-4 flex items-center justify-between text-[13px] text-ink-soft">
              <span>
                Página {pagina} de {dados.totalPaginas} · {dados.total}{' '}
                {dados.total === 1 ? 'venda' : 'vendas'}
              </span>
              <div className="flex gap-2">
                <Botao
                  variante="neutro"
                  disabled={pagina <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  Anterior
                </Botao>
                <Botao
                  variante="neutro"
                  disabled={pagina >= dados.totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Próxima
                </Botao>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LinhaVenda({ venda, aoDevolver }: { venda: VendaResumo; aoDevolver: () => void }) {
  const hora = new Date(venda.registradaEm).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="num text-[14px] font-medium text-ink">Venda #{venda.numero}</span>
          {venda.temDevolucao && <Selo tom="alerta">já teve devolução</Selo>}
        </div>
        <p className="mt-0.5 truncate text-[13px] text-ink-faint">
          {hora} · {venda.operador}
          {venda.cliente && <> · {venda.cliente}</>}
        </p>
      </div>

      <span className="num text-[16px] font-semibold text-ink">
        {formatarBRL(centavos(venda.totalCentavos))}
      </span>

      <Botao variante="discreto" className="h-8 px-3 text-[13px]" onClick={aoDevolver}>
        Devolver
      </Botao>
    </li>
  );
}
