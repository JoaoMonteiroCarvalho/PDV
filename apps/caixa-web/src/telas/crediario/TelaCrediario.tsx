import { formatarBRL, centavos } from '@pdv/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useNavegacao } from '@/estado/useNavegacao.js';
import { useSessao } from '@/estado/useSessao.js';
import { useSessaoCaixaAberta } from '@/servicos/caixa.js';
import { useBuscarClientes, useCrediarioCliente, type Cliente } from '@/servicos/clientes.js';
import { ModalReceberParcela } from './ModalReceberParcela.js';

export function TelaCrediario() {
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const terminalId = useSessao((estado) => estado.terminalId);
  const { data: sessaoCaixa } = useSessaoCaixaAberta(terminalId);

  const [busca, setBusca] = useState('');
  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null);
  const [parcelaEmRecebimento, setParcelaEmRecebimento] = useState<string | null>(null);

  const { data: resultadoBusca } = useBuscarClientes(busca);
  const { data: crediario, isLoading } = useCrediarioCliente(clienteSelecionado?.id ?? null);
  const queryClient = useQueryClient();

  function aoConcluirRecebimento() {
    setParcelaEmRecebimento(null);
    void queryClient.invalidateQueries({ queryKey: ['crediario-cliente', clienteSelecionado?.id] });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-valor">Crediário</h1>
        <Button variante="fantasma" onClick={irParaVenda}>
          Voltar pra venda
        </Button>
      </header>

      {!clienteSelecionado ? (
        <div className="space-y-3">
          <Input placeholder="Nome ou CPF do cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {resultadoBusca && resultadoBusca.itens.length === 0 && (
            <p className="text-rotulo text-texto-secundario">Nenhum cliente encontrado.</p>
          )}
          <ul className="space-y-1.5">
            {resultadoBusca?.itens.map((cliente) => (
              <li key={cliente.id}>
                <button
                  onClick={() => setClienteSelecionado(cliente)}
                  className="flex w-full items-center justify-between rounded border border-borda bg-superficie px-4 py-3 text-left hover:bg-superficie-alta"
                >
                  <span className="text-corpo">{cliente.nome}</span>
                  <span className="text-rotulo text-texto-secundario">
                    limite {formatarBRL(centavos(cliente.limiteCrediarioCentavos))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-corpo font-semibold">{clienteSelecionado.nome}</h2>
            <Button variante="fantasma" onClick={() => setClienteSelecionado(null)}>
              Trocar cliente
            </Button>
          </div>

          {isLoading && <p className="text-corpo text-texto-secundario">Carregando…</p>}

          {crediario && (
            <>
              <div className="rounded-lg border border-borda bg-superficie p-4">
                <p className="text-rotulo text-texto-secundario">Limite disponível</p>
                <p className="text-valor">{formatarBRL(centavos(crediario.limiteDisponivelCentavos))}</p>
                <p className="text-rotulo text-texto-secundario">
                  Em aberto: {formatarBRL(centavos(crediario.emAbertoCentavos))} de{' '}
                  {formatarBRL(centavos(crediario.limiteCrediarioCentavos))}
                </p>
              </div>

              {crediario.parcelas.length === 0 ? (
                <p className="text-corpo text-texto-secundario">Nenhuma parcela em aberto.</p>
              ) : (
                <ul className="space-y-2">
                  {crediario.parcelas.map((parcela) => (
                    <li
                      key={parcela.id}
                      className="flex items-center justify-between rounded border border-borda bg-superficie px-4 py-3"
                    >
                      <div>
                        <p className="text-corpo">Parcela {parcela.numero}</p>
                        <p className="text-rotulo text-texto-secundario">
                          vence em {new Date(parcela.vencimento).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-corpo font-semibold">
                          {formatarBRL(centavos(parcela.valorCentavos))}
                        </span>
                        <Button
                          variante="secundaria"
                          disabled={!sessaoCaixa}
                          title={!sessaoCaixa ? 'Abra o caixa para receber parcelas' : undefined}
                          onClick={() => setParcelaEmRecebimento(parcela.id)}
                        >
                          Receber
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {parcelaEmRecebimento && sessaoCaixa && (
        <ModalReceberParcela
          parcelaId={parcelaEmRecebimento}
          sessaoCaixaId={sessaoCaixa.id}
          valorCentavos={crediario?.parcelas.find((p) => p.id === parcelaEmRecebimento)?.valorCentavos ?? 0}
          aoConcluir={aoConcluirRecebimento}
          aoFechar={() => setParcelaEmRecebimento(null)}
        />
      )}
    </div>
  );
}
