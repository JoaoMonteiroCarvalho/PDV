import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useNavegacao } from '@/estado/useNavegacao.js';
import { useHistoricoVendas, type LinhaHistoricoVenda } from '@/servicos/historico.js';
import { useOperadores } from '@/servicos/relatorios.js';
import { ModalDetalheVenda } from './ModalDetalheVenda.js';

export function TelaHistorico() {
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const [desde, setDesde] = useState('');
  const [ate, setAte] = useState('');
  const [operadorId, setOperadorId] = useState('');
  const [paginas, setPaginas] = useState<readonly (readonly LinhaHistoricoVenda[])[]>([]);
  const [cursor, setCursor] = useState<{ antesDe?: string; ultimoId?: string }>({});
  const [vendaSelecionada, setVendaSelecionada] = useState<string | null>(null);

  const { data: operadoresData } = useOperadores();
  const filtro = {
    ...(desde && { desde: new Date(desde).toISOString() }),
    ...(ate && { ate: new Date(ate).toISOString() }),
    ...(operadorId && { operadorId }),
    ...cursor,
  };
  const { data, isLoading, isError } = useHistoricoVendas(filtro);

  const itens = [...paginas.flat(), ...(data?.itens ?? [])];

  function aplicarFiltroPeriodo() {
    setPaginas([]);
    setCursor({});
  }

  function carregarMais() {
    if (!data?.temMais || !data.proximoAntesDe) return;
    setPaginas((atual) => [...atual, data.itens]);
    setCursor({ antesDe: data.proximoAntesDe, ...(data.proximoUltimoId && { ultimoId: data.proximoUltimoId }) });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-valor">Histórico de vendas</h1>
        <Button variante="fantasma" onClick={irParaVenda}>
          Voltar pra venda
        </Button>
      </header>

      <div className="flex items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="historico-desde" className="text-rotulo text-texto-secundario">
            Desde
          </label>
          <Input id="historico-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="historico-ate" className="text-rotulo text-texto-secundario">
            Até
          </label>
          <Input id="historico-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="historico-operador" className="text-rotulo text-texto-secundario">
            Operador
          </label>
          <select
            id="historico-operador"
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
        <Button variante="secundaria" onClick={aplicarFiltroPeriodo}>
          Filtrar
        </Button>
      </div>

      {isLoading && paginas.length === 0 && <p className="text-corpo text-texto-secundario">Carregando…</p>}
      {isError && (
        <p role="alert" className="text-corpo text-perigo">
          Não foi possível carregar o histórico. Verifique a conexão.
        </p>
      )}

      <div className="space-y-2">
        {itens.map((venda) => (
          <button
            key={venda.id}
            onClick={() => setVendaSelecionada(venda.id)}
            className="flex w-full items-center justify-between rounded-lg border border-borda bg-superficie p-4 text-left hover:bg-superficie-alta"
          >
            <div>
              <p className="text-corpo">
                Venda #{venda.numero} · {venda.operador.nome}
              </p>
              <p className="text-rotulo text-texto-secundario">
                {new Date(venda.registradaEm).toLocaleString('pt-BR')} · {venda.quantidadeItens} item(ns) ·{' '}
                {venda.formasPagamento.join(', ')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {venda.totalDevolvidoCentavos > 0 && <Badge tom="alerta">devolução</Badge>}
              <span className="text-corpo font-semibold">{formatarBRL(centavos(venda.totalCentavos))}</span>
            </div>
          </button>
        ))}
      </div>

      {data?.temMais && (
        <Button variante="secundaria" className="w-full" onClick={carregarMais} disabled={isLoading}>
          {isLoading ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}

      {vendaSelecionada && (
        <ModalDetalheVenda vendaId={vendaSelecionada} aoFechar={() => setVendaSelecionada(null)} />
      )}
    </div>
  );
}
