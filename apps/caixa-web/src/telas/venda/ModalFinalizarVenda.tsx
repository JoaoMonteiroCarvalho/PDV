import * as Dialog from '@radix-ui/react-dialog';
import { calcularVenda, centavos, formatarBRL, somar, subtrair, type FormaPagamento } from '@pdv/shared';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { enfileirarVenda } from '@/banco-local/motorSincronizacao.js';
import type { ClienteVinculado, ItemCarrinho } from '@/estado/useCarrinho.js';
import { useCrediarioCliente } from '@/servicos/clientes.js';
import type { CrediarioEntrada, PagamentoVendaEntrada } from '@/servicos/vendas.js';

const FORMAS: ReadonlyArray<{ forma: FormaPagamento; rotulo: string }> = [
  { forma: 'DINHEIRO', rotulo: 'Dinheiro' },
  { forma: 'PIX', rotulo: 'PIX' },
  { forma: 'DEBITO', rotulo: 'Débito' },
  { forma: 'CREDITO', rotulo: 'Crédito' },
  { forma: 'CREDIARIO', rotulo: 'Crediário' },
];

function dataDaquiA(dias: number): string {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 100);
}

export interface ResultadoFinalizacao {
  readonly vendaId: string;
  readonly totalCentavos: number;
  readonly pagamentos: readonly PagamentoVendaEntrada[];
}

interface Props {
  readonly itens: readonly ItemCarrinho[];
  readonly sessaoCaixaId: string;
  readonly cliente: ClienteVinculado | null;
  readonly aoConcluir: (resultado: ResultadoFinalizacao) => void;
  readonly aoFechar: () => void;
}

export function ModalFinalizarVenda({ itens, sessaoCaixaId, cliente, aoConcluir, aoFechar }: Props) {
  // `itens` pode ficar vazio por um instante entre a venda ser concluída (o
  // carrinho é limpo) e este modal desmontar — calcularVenda([]) lança
  // ErroVenda de propósito (uma venda sem item não existe), então aqui isso
  // vira "nada pra mostrar", não uma tela quebrada.
  const venda = useMemo(() => {
    if (itens.length === 0) return null;
    return calcularVenda(
      itens.map((item) => ({
        varianteId: item.varianteId,
        quantidade: item.quantidade,
        precoUnitarioCentavos: centavos(item.precoCentavos),
        descontoCentavos: centavos(0),
      })),
    );
  }, [itens]);

  const [pagamentos, setPagamentos] = useState<PagamentoVendaEntrada[]>([]);
  const [formaEmEdicao, setFormaEmEdicao] = useState<FormaPagamento | null>(null);
  const [valorDigitado, setValorDigitado] = useState('');
  const [quantidadeParcelas, setQuantidadeParcelas] = useState('3');
  const [primeiroVencimento, setPrimeiroVencimento] = useState(() => dataDaquiA(30));
  const [crediario, setCrediario] = useState<CrediarioEntrada | null>(null);
  const [enfileirando, setEnfileirando] = useState(false);
  const [erroAoEnfileirar, setErroAoEnfileirar] = useState<string | null>(null);
  const refValor = useRef<HTMLInputElement>(null);

  const { data: dadosCrediario } = useCrediarioCliente(cliente?.id ?? null);
  const jaTemCrediario = pagamentos.some((p) => p.forma === 'CREDIARIO');

  const recebidoLiquido = pagamentos.length
    ? subtrair(
        somar(...pagamentos.map((p) => centavos(p.valorCentavos))),
        somar(...pagamentos.map((p) => centavos(p.trocoCentavos))),
      )
    : centavos(0);
  const totalVenda = venda?.totalCentavos ?? centavos(0);
  const saldoRestante = Math.max(0, totalVenda - recebidoLiquido);
  const trocoTotal = pagamentos.reduce((soma, p) => soma + p.trocoCentavos, 0);
  const pagamentoCompleto = saldoRestante === 0 && recebidoLiquido === totalVenda;

  function abrirValorPara(forma: FormaPagamento) {
    setFormaEmEdicao(forma);
    setValorDigitado(saldoRestante > 0 ? (saldoRestante / 100).toFixed(2).replace('.', ',') : '');
    setTimeout(() => refValor.current?.focus(), 0);
  }

  function confirmarValor() {
    if (!formaEmEdicao) return;
    const valor = paraCentavos(valorDigitado);
    if (valor === null || valor <= 0) return;

    if (formaEmEdicao === 'CREDIARIO') {
      const parcelas = Number(quantidadeParcelas);
      if (!Number.isInteger(parcelas) || parcelas < 1 || !primeiroVencimento) return;
      if (dadosCrediario && valor > dadosCrediario.limiteDisponivelCentavos) return;
      const valorFinal = Math.min(valor, saldoRestante);
      setPagamentos((atual) => [...atual, { forma: 'CREDIARIO', valorCentavos: valorFinal, trocoCentavos: 0 }]);
      setCrediario({ quantidadeParcelas: parcelas, primeiroVencimento });
      setFormaEmEdicao(null);
      setValorDigitado('');
      return;
    }

    const troco = formaEmEdicao === 'DINHEIRO' ? Math.max(0, valor - saldoRestante) : 0;
    // Formas sem troco não podem passar do que falta — a maquininha não
    // devolve dinheiro, então limito ao saldo em vez de deixar sobrar.
    const valorFinal = formaEmEdicao === 'DINHEIRO' ? valor : Math.min(valor, saldoRestante);

    setPagamentos((atual) => [...atual, { forma: formaEmEdicao, valorCentavos: valorFinal, trocoCentavos: troco }]);
    setFormaEmEdicao(null);
    setValorDigitado('');
  }

  function removerPagamento(indice: number) {
    setPagamentos((atual) => {
      const removido = atual[indice];
      if (removido?.forma === 'CREDIARIO') setCrediario(null);
      return atual.filter((_, i) => i !== indice);
    });
  }

  async function finalizar() {
    setErroAoEnfileirar(null);
    setEnfileirando(true);
    // Gerado ANTES de qualquer coisa: é este id, gerado no cliente, que faz a
    // sincronização ser idempotente — reenviar a mesma venda nunca cria duas.
    const id = crypto.randomUUID();
    try {
      // Grava no Dexie e devolve na hora — o envio pro servidor acontece em
      // segundo plano (banco-local/motorSincronizacao.ts). A venda já
      // aconteceu no mundo real; a tela não pode ficar esperando a rede pra
      // confirmar isso ao operador.
      await enfileirarVenda({
        id,
        sessaoCaixaId,
        ...(cliente && { clienteId: cliente.id }),
        criadaEmCliente: new Date().toISOString(),
        itens: itens.map((item) => ({
          varianteId: item.varianteId,
          quantidade: item.quantidade,
          precoUnitarioCentavos: item.precoCentavos,
          descontoCentavos: 0,
        })),
        descontoSobreTotalCentavos: 0,
        pagamentos,
        ...(crediario && { crediario }),
      });
      aoConcluir({ vendaId: id, totalCentavos: totalVenda, pagamentos });
    } catch {
      // Isto só falha se o próprio IndexedDB recusar a escrita (quota
      // cheia, navegador em modo privado sem suporte) — não é erro de rede,
      // que o motor de sincronização já absorve sozinho.
      setErroAoEnfileirar('Não foi possível gravar a venda neste dispositivo. Tente novamente.');
    } finally {
      setEnfileirando(false);
    }
  }

  // Estado transitório entre "venda concluída" e este modal desmontar — ver
  // comentário no useMemo de `venda`, acima.
  if (!venda) return null;

  return (
    <Dialog.Root
      open
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8"
          onEscapeKeyDown={(e) => {
            if (formaEmEdicao) {
              e.preventDefault();
              setFormaEmEdicao(null);
            }
          }}
        >
          <Dialog.Title className="text-valor">Finalizar venda</Dialog.Title>
          <Dialog.Description className="sr-only">
            Adicione uma ou mais formas de pagamento até completar o total da venda.
          </Dialog.Description>

          <div className="flex items-baseline justify-between">
            <span className="text-corpo text-texto-secundario">Total</span>
            <span className="text-total">{formatarBRL(totalVenda)}</span>
          </div>

          {pagamentos.length > 0 && (
            <ul className="space-y-1.5">
              {pagamentos.map((pagamento, indice) => (
                <li key={indice} className="flex items-center justify-between rounded bg-superficie-alta px-3 py-2 text-corpo">
                  <span>
                    {FORMAS.find((f) => f.forma === pagamento.forma)?.rotulo}
                    {pagamento.trocoCentavos > 0 && (
                      <span className="ml-2 text-rotulo text-texto-secundario">
                        (troco {formatarBRL(centavos(pagamento.trocoCentavos))})
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-semibold">{formatarBRL(centavos(pagamento.valorCentavos))}</span>
                    <button
                      type="button"
                      aria-label={`Remover pagamento em ${FORMAS.find((f) => f.forma === pagamento.forma)?.rotulo}`}
                      onClick={() => removerPagamento(indice)}
                      className="text-texto-secundario hover:text-perigo"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {pagamentoCompleto ? (
            <p className="text-valor text-sucesso">
              Pagamento completo{trocoTotal > 0 && ` — troco ${formatarBRL(centavos(trocoTotal))}`}
            </p>
          ) : (
            <p className="text-valor text-alerta">Falta {formatarBRL(centavos(saldoRestante))}</p>
          )}

          {formaEmEdicao ? (
            <div className="space-y-3 rounded border border-acento bg-superficie-alta p-3">
              <div className="flex items-center gap-3">
                <span className="text-corpo">{FORMAS.find((f) => f.forma === formaEmEdicao)?.rotulo}:</span>
                <Input
                  ref={refValor}
                  value={valorDigitado}
                  onChange={(e) => setValorDigitado(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      confirmarValor();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setFormaEmEdicao(null);
                    }
                  }}
                />
                {formaEmEdicao === 'DINHEIRO' && (() => {
                  const valor = paraCentavos(valorDigitado);
                  const trocoPrevisto = valor !== null ? Math.max(0, valor - saldoRestante) : 0;
                  return trocoPrevisto > 0 ? (
                    <span className="text-rotulo text-texto-secundario">
                      Troco: {formatarBRL(centavos(trocoPrevisto))}
                    </span>
                  ) : null;
                })()}
              </div>

              {formaEmEdicao === 'CREDIARIO' && (
                <>
                  <div className="flex items-center gap-3">
                    <label htmlFor="crediario-parcelas" className="text-rotulo text-texto-secundario">
                      Parcelas
                    </label>
                    <Input
                      id="crediario-parcelas"
                      type="number"
                      min={1}
                      max={24}
                      className="w-20"
                      value={quantidadeParcelas}
                      onChange={(e) => setQuantidadeParcelas(e.target.value)}
                    />
                    <label htmlFor="crediario-vencimento" className="text-rotulo text-texto-secundario">
                      1º vencimento
                    </label>
                    <Input
                      id="crediario-vencimento"
                      type="date"
                      value={primeiroVencimento}
                      onChange={(e) => setPrimeiroVencimento(e.target.value)}
                    />
                  </div>
                  {dadosCrediario && (
                    <p className="text-rotulo text-texto-secundario">
                      Limite disponível: {formatarBRL(centavos(dadosCrediario.limiteDisponivelCentavos))}
                    </p>
                  )}
                  {dadosCrediario &&
                    (paraCentavos(valorDigitado) ?? 0) > dadosCrediario.limiteDisponivelCentavos && (
                      <p role="alert" className="text-rotulo text-perigo">
                        Valor acima do limite disponível para este cliente.
                      </p>
                    )}
                </>
              )}
            </div>
          ) : (
            !pagamentoCompleto && (
              <div className="grid grid-cols-4 gap-2">
                {FORMAS.map(({ forma, rotulo }) => {
                  const desabilitada =
                    forma === 'CREDIARIO' && (!cliente || jaTemCrediario || !dadosCrediario || dadosCrediario.limiteDisponivelCentavos <= 0);
                  return (
                    <Button
                      key={forma}
                      variante="secundaria"
                      disabled={desabilitada}
                      title={forma === 'CREDIARIO' && !cliente ? 'Vincule um cliente (F6) para usar crediário' : undefined}
                      onClick={() => abrirValorPara(forma)}
                    >
                      {rotulo}
                    </Button>
                  );
                })}
              </div>
            )
          )}

          {erroAoEnfileirar && (
            <p role="alert" className="text-rotulo text-perigo">
              {erroAoEnfileirar}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button type="button" variante="fantasma">
                Voltar (Esc)
              </Button>
            </Dialog.Close>
            <Button
              variante="primaria"
              tamanho="grande"
              disabled={!pagamentoCompleto || enfileirando}
              onClick={() => void finalizar()}
            >
              {enfileirando ? 'Registrando…' : 'Finalizar (F9)'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
