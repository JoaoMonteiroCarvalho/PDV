/**
 * Finalização da venda: formas de pagamento e troco.
 *
 * A regra que organiza esta tela é uma só — **o que falta receber está sempre
 * na cara da operadora**. Venda dividida (R$ 50 no Pix, R$ 80 no cartão, resto
 * em dinheiro) é rotina na loja, e o erro clássico é fechar achando que o
 * cliente pagou tudo. Por isso o saldo aparece grande e o botão de finalizar
 * só habilita quando ele zera.
 *
 * Troco: calculado ao vivo enquanto a operadora digita o valor em dinheiro,
 * porque ela conta a nota na mão antes de abrir a gaveta. Só existe troco em
 * DINHEIRO — a maquininha opera separada do PDV e não devolve nada.
 */

import { ZERO, centavos, formatarBRL, type FormaPagamento, type PagamentoEntrada } from '@pdv/shared';
import { useMemo, useState } from 'react';
import { Botao, Erro, cx } from '../componentes/base.js';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import type { ClienteDetalhe } from '../api/cliente.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { AVISO_NA_TELA, vendaExigeAvisoDeHigiene } from '../impressao/politicaTroca.js';
import { calcular, saldoAPagar } from './carrinho.js';
import { SeletorCliente } from './SeletorCliente.js';

const FORMAS: { readonly valor: FormaPagamento; readonly rotulo: string }[] = [
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'DEBITO', rotulo: 'Débito' },
  { valor: 'CREDITO', rotulo: 'Crédito' },
  { valor: 'CREDIARIO', rotulo: 'Fiado' },
];

/** Parcelamentos que a loja pratica. Além de 6x o risco não se justifica. */
const PARCELAS_POSSIVEIS = [1, 2, 3, 4, 5, 6];

/**
 * Primeiro vencimento: um mês depois, no mesmo dia.
 *
 * `calcularParcelas` no `@pdv/shared` respeita mês curto — compra dia 31 com
 * vencimento em fevereiro cai no último dia de fevereiro, não transborda para
 * março.
 */
function primeiroVencimentoPadrao(): Date {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
}

export interface PlanoCrediario {
  readonly clienteId: string;
  readonly quantidadeParcelas: number;
  readonly primeiroVencimento: Date;
}

interface Props {
  readonly aoFechar: () => void;
  readonly aoConfirmar: (
    pagamentos: readonly PagamentoEntrada[],
    crediario: PlanoCrediario | null,
  ) => Promise<void>;
}

export function ModalFinalizacao({ aoFechar, aoConfirmar }: Props) {
  const carrinho = useCarrinho((estado) => estado.carrinho);
  const pagamentos = useCarrinho((estado) => estado.pagamentos);
  const lancarPagamento = useCarrinho((estado) => estado.lancarPagamento);
  const removerPagamento = useCarrinho((estado) => estado.removerPagamento);

  const [forma, setForma] = useState<FormaPagamento>('DINHEIRO');
  const [valorDigitado, setValorDigitado] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [avisouTroca, setAvisouTroca] = useState(false);
  const [cliente, setCliente] = useState<ClienteDetalhe | null>(null);
  const [parcelas, setParcelas] = useState(1);

  const venda = useMemo(() => calcular(carrinho), [carrinho]);
  const saldo = saldoAPagar(venda, pagamentos);

  /*
   * A confirmação da política só aparece quando a venda TEM peça sujeita à
   * restrição de higiene. Pedir em toda venda treinaria a mão a marcar sem
   * ler, que é o mesmo que não pedir.
   */
  const exigeAviso = useMemo(
    () => vendaExigeAvisoDeHigiene(carrinho.itens.map((item) => ({ categoria: item.categoria }))),
    [carrinho.itens],
  );
  /*
   * Quanto da venda foi lançado no fiado. É esse valor que precisa caber no
   * limite DISPONÍVEL da cliente — não o total da venda, porque parte pode ter
   * sido paga em dinheiro.
   */
  const totalNoCrediario = pagamentos
    .filter((pagamento) => pagamento.forma === 'CREDIARIO')
    .reduce((soma, pagamento) => soma + pagamento.valorCentavos, 0);

  const temCrediario = totalNoCrediario > 0;
  const estouraLimite =
    temCrediario && cliente !== null && totalNoCrediario > cliente.limiteDisponivelCentavos;

  const podeConfirmar =
    saldo === ZERO &&
    (!exigeAviso || avisouTroca) &&
    // Fiado sem cliente identificada é dívida de ninguém, e o servidor recusa.
    (!temCrediario || (cliente !== null && !estouraLimite));

  // Em dinheiro, o valor sugerido é o saldo exato; em cartão e Pix o valor é
  // sempre exatamente o saldo, porque não existe "pagar a mais".
  const valorEfetivo = valorDigitado === 0 ? saldo : valorDigitado;

  /*
   * Troco desta parcela, não da venda inteira. Só em dinheiro, e só sobre o
   * que sobra do saldo ATUAL — se a cliente já pagou metade no Pix, o troco
   * da nota de 100 é calculado sobre a metade que falta.
   */
  const troco = forma === 'DINHEIRO' ? Math.max(0, valorEfetivo - saldo) : 0;

  function lancar() {
    setErro(null);
    if (valorEfetivo <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    if (forma !== 'DINHEIRO' && valorEfetivo > saldo) {
      setErro('Só existe troco em dinheiro. Em cartão e Pix, lance no máximo o saldo.');
      return;
    }
    if (forma === 'CREDIARIO') {
      if (!cliente) {
        setErro('Escolha a cliente antes de lançar no fiado.');
        return;
      }
      const jaNoFiado = totalNoCrediario;
      if (jaNoFiado + valorEfetivo > cliente.limiteDisponivelCentavos) {
        setErro(
          `${cliente.nome} pode levar no máximo ${formatarBRL(centavos(cliente.limiteDisponivelCentavos))} no fiado.`,
        );
        return;
      }
    }
    lancarPagamento({
      forma,
      valorCentavos: centavos(valorEfetivo),
      trocoCentavos: centavos(troco),
    });
    setValorDigitado(0);
  }

  async function confirmar() {
    setErro(null);
    setEnviando(true);
    try {
      await aoConfirmar(
        pagamentos,
        temCrediario && cliente
          ? {
              clienteId: cliente.id,
              quantidadeParcelas: parcelas,
              primeiroVencimento: primeiroVencimentoPadrao(),
            }
          : null,
      );
    } catch (falha) {
      // Erro aparece AQUI, no botão que falhou — nunca uma tela em branco.
      setErro(falha instanceof Error ? falha.message : 'Não foi possível finalizar a venda.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-finalizacao"
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"
      onClick={(evento) => {
        // Clique fora fecha, mas só no fundo — não em qualquer clique interno.
        if (evento.target === evento.currentTarget && !enviando) aoFechar();
      }}
    >
      <div className="elevado flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-card border border-line bg-surface">
        <header className="border-b border-line px-6 py-4">
          <h2 id="titulo-finalizacao" className="font-titulo text-[18px] font-medium">
            Finalizar venda
          </h2>
          <p className="num mt-1 text-[13px] text-ink-faint">
            Total {formatarBRL(venda.totalCentavos)}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* O saldo é o número mais importante da tela e é dimensionado assim. */}
          <div
            className={cx(
              'mb-5 flex items-baseline justify-between rounded-[14px] px-4 py-3',
              saldo === 0 ? 'bg-ok/10' : 'bg-sunken',
            )}
          >
            <span className="text-[14px] text-ink-soft">
              {saldo === 0 ? 'Pago por completo' : 'Ainda falta receber'}
            </span>
            <span
              className={cx(
                'num font-titulo text-[26px] font-semibold',
                saldo === 0 ? 'text-ok' : 'text-ink',
              )}
            >
              {formatarBRL(centavos(saldo))}
            </span>
          </div>

          {pagamentos.length > 0 && (
            <ul className="mb-5 divide-y divide-line rounded-[12px] border border-line">
              {pagamentos.map((pagamento, indice) => (
                <li key={indice} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-[14px]">
                    {FORMAS.find((f) => f.valor === pagamento.forma)?.rotulo ?? pagamento.forma}
                  </span>
                  <span className="num text-[14px]">{formatarBRL(pagamento.valorCentavos)}</span>
                  {pagamento.trocoCentavos > 0 && (
                    <span className="num text-[13px] text-alerta">
                      troco {formatarBRL(pagamento.trocoCentavos)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removerPagamento(indice)}
                    aria-label={`Remover pagamento em ${pagamento.forma}`}
                    className="rounded-[8px] px-2 py-0.5 text-[13px] text-ink-faint hover:bg-perigo/10 hover:text-perigo"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {saldo > 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {FORMAS.map((opcao) => (
                  <button
                    key={opcao.valor}
                    type="button"
                    onClick={() => setForma(opcao.valor)}
                    aria-pressed={forma === opcao.valor}
                    className={cx(
                      'h-11 rounded-[12px] text-[14px] font-medium transition-colors duration-200',
                      forma === opcao.valor
                        ? 'bg-accent text-accent-ink'
                        : 'bg-sunken text-ink-soft hover:bg-line hover:text-ink',
                    )}
                  >
                    {opcao.rotulo}
                  </button>
                ))}
              </div>

              {forma === 'CREDIARIO' && (
                <div className="space-y-3">
                  <SeletorCliente escolhida={cliente} aoEscolher={setCliente} />

                  {cliente && (
                    <div>
                      <span className="text-[13px] text-ink-soft">Em quantas vezes</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {PARCELAS_POSSIVEIS.map((quantidade) => (
                          <button
                            key={quantidade}
                            type="button"
                            onClick={() => setParcelas(quantidade)}
                            aria-pressed={parcelas === quantidade}
                            aria-label={`${quantidade}x`}
                            className={cx(
                              'num h-10 w-12 rounded-[10px] text-[14px] font-medium transition-colors duration-200',
                              parcelas === quantidade
                                ? 'bg-accent text-accent-ink'
                                : 'bg-sunken text-ink-soft hover:bg-line hover:text-ink',
                            )}
                          >
                            {quantidade}x
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[12px] text-ink-faint">
                        Primeiro vencimento em{' '}
                        {primeiroVencimentoPadrao().toLocaleDateString('pt-BR')}.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <CampoDinheiro
                rotulo="Valor recebido"
                destaque
                valorCentavos={valorDigitado}
                aoMudar={setValorDigitado}
                ajuda={
                  valorDigitado === 0
                    ? `Vazio lança o saldo inteiro: ${formatarBRL(centavos(saldo))}`
                    : undefined
                }
              />

              {troco > 0 && (
                <div className="flex items-baseline justify-between rounded-[12px] bg-alerta/10 px-4 py-3">
                  <span className="text-[14px] text-ink-soft">Troco a devolver</span>
                  {/*
                    O mesmo valor pode coincidir com o total ou com o saldo —
                    o testid marca qual deles é O troco.
                  */}
                  <span
                    data-testid="troco"
                    className="num font-titulo text-[22px] font-semibold text-alerta"
                  >
                    {formatarBRL(centavos(troco))}
                  </span>
                </div>
              )}

              <Botao variante="neutro" className="w-full" onClick={lancar}>
                Lançar pagamento
              </Botao>
            </div>
          )}

          {exigeAviso && (
            <label
              className={cx(
                'mt-5 flex cursor-pointer items-start gap-3 rounded-[12px] border px-4 py-3',
                avisouTroca ? 'border-line bg-sunken' : 'border-alerta/40 bg-alerta/5',
              )}
            >
              <input
                type="checkbox"
                checked={avisouTroca}
                onChange={(evento) => setAvisouTroca(evento.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="text-[13px] leading-relaxed text-ink">{AVISO_NA_TELA}</span>
            </label>
          )}

          {estouraLimite && cliente && (
            <div className="mt-4">
              <Erro>
                O fiado lançado passa do que {cliente.nome} pode levar (
                {formatarBRL(centavos(cliente.limiteDisponivelCentavos))}). Remova o pagamento e
                lance um valor menor.
              </Erro>
            </div>
          )}

          {erro && (
            <div className="mt-4">
              <Erro>{erro}</Erro>
            </div>
          )}
        </div>

        <footer className="flex gap-2 border-t border-line px-6 py-4">
          <Botao variante="discreto" onClick={aoFechar} disabled={enviando} className="flex-1">
            Voltar
          </Botao>
          <Botao
            variante="primario"
            tamanho="grande"
            className="flex-[2]"
            /*
              Só habilita com a conta fechada E com a política confirmada.
              `validarPagamentos` recusaria o pagamento errado depois, mas aí o
              erro chegaria tarde demais; e a política ninguém valida por nós.
            */
            disabled={!podeConfirmar || enviando}
            onClick={() => void confirmar()}
          >
            {enviando ? 'Registrando…' : 'Confirmar venda'}
          </Botao>
        </footer>
      </div>
    </div>
  );
}
