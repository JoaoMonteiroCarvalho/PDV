import * as Dialog from '@radix-ui/react-dialog';
import { formatarBRL, centavos } from '@pdv/shared';
import { useDetalheVenda } from '@/servicos/historico.js';

interface Props {
  readonly vendaId: string;
  readonly aoFechar: () => void;
}

const NOME_FORMA_PAGAMENTO: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_DEBITO: 'Cartão débito',
  CARTAO_CREDITO: 'Cartão crédito',
  CREDIARIO: 'Crediário',
};

/** Somente leitura — histórico não modifica nada, é a auditoria do que já aconteceu. */
export function ModalDetalheVenda({ vendaId, aoFechar }: Props) {
  const { data: venda, isLoading, isError } = useDetalheVenda(vendaId);

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 space-y-5 overflow-auto rounded-lg border border-borda bg-superficie p-8">
          {isLoading && <p className="text-corpo text-texto-secundario">Carregando…</p>}
          {isError && (
            <p role="alert" className="text-corpo text-perigo">
              Não foi possível carregar o detalhe desta venda.
            </p>
          )}

          {venda && (
            <>
              <Dialog.Title className="text-valor">Venda #{venda.numero}</Dialog.Title>
              <Dialog.Description className="text-rotulo text-texto-secundario">
                {new Date(venda.registradaEm).toLocaleString('pt-BR')} · {venda.operador.nome}
                {venda.cliente && ` · ${venda.cliente.nome}`}
              </Dialog.Description>

              <div className="space-y-2">
                <h2 className="text-corpo font-semibold">Itens</h2>
                {venda.itens.map((item) => (
                  <div key={item.id} className="flex justify-between text-corpo">
                    <span>
                      {item.quantidade}× {item.descricao}
                      {(item.tamanho || item.cor) && (
                        <span className="text-rotulo text-texto-secundario">
                          {' '}
                          ({[item.tamanho, item.cor].filter(Boolean).join(' ')})
                        </span>
                      )}
                    </span>
                    <span>{formatarBRL(centavos(item.totalCentavos))}</span>
                  </div>
                ))}
              </div>

              <dl className="space-y-1 border-t border-borda pt-3">
                <div className="flex justify-between text-rotulo text-texto-secundario">
                  <dt>Subtotal</dt>
                  <dd>{formatarBRL(centavos(venda.subtotalCentavos))}</dd>
                </div>
                {venda.descontoCentavos > 0 && (
                  <div className="flex justify-between text-rotulo text-texto-secundario">
                    <dt>Desconto</dt>
                    <dd>-{formatarBRL(centavos(venda.descontoCentavos))}</dd>
                  </div>
                )}
                <div className="flex justify-between text-corpo font-semibold">
                  <dt>Total</dt>
                  <dd>{formatarBRL(centavos(venda.totalCentavos))}</dd>
                </div>
              </dl>

              <div className="space-y-1">
                <h2 className="text-corpo font-semibold">Pagamento</h2>
                {venda.pagamentos.map((pagamento, indice) => (
                  <div key={indice} className="flex justify-between text-corpo">
                    <span>{NOME_FORMA_PAGAMENTO[pagamento.forma] ?? pagamento.forma}</span>
                    <span>{formatarBRL(centavos(pagamento.valorCentavos))}</span>
                  </div>
                ))}
              </div>

              {venda.devolucoes.length > 0 && (
                <div className="space-y-2 border-t border-alerta/40 pt-3">
                  <h2 className="text-corpo font-semibold text-alerta">Devoluções</h2>
                  {venda.devolucoes.map((devolucao) => (
                    <div key={devolucao.id} className="text-rotulo">
                      <p className="text-corpo text-perigo">
                        -{formatarBRL(centavos(devolucao.valorCentavos))} ({devolucao.formaEstorno})
                      </p>
                      <p className="text-texto-secundario">
                        {devolucao.motivo} · autorizado por {devolucao.autorizadoPor.nome} ·{' '}
                        {new Date(devolucao.criadoEm).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <Dialog.Close asChild>
            <button className="text-rotulo text-texto-secundario underline">Fechar</button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
