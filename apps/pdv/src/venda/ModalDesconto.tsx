/**
 * Desconto — no item ou no total da venda.
 *
 * Três coisas governam esta tela:
 *
 * 1. **A operadora vê o efeito antes de confirmar.** Desconto é dinheiro que
 *    sai da margem da loja; confirmar às cegas e descobrir no comprovante é
 *    como se erra 10% por 100%.
 *
 * 2. **A alçada é checada sobre a VENDA inteira, não sobre o desconto isolado.**
 *    É assim que `validarAlcadaDesconto` decide no servidor. Checar item a item
 *    aqui deixaria passar cinco descontos de 5% que somam 25% — e a venda seria
 *    recusada no fim, com a cliente já no balcão.
 *
 * 3. **Quem libera é a assinatura, não o nome.** O token da gerente é guardado
 *    no carrinho e enviado no fechamento. O servidor lê dele quem autorizou.
 */

import { formatarBRL, centavos, pontosBase, type PontosBase } from '@pdv/shared';
import { useMemo, useState } from 'react';
import { AutorizacaoGerente } from '../componentes/AutorizacaoGerente.js';
import { Botao, Campo, Erro, cx } from '../componentes/base.js';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { useSessao } from '../estado/sessaoStore.js';
import {
  calcular,
  definirDescontoDoItem,
  definirDescontoDoTotal,
  type EstadoCarrinho,
} from './carrinho.js';
import {
  descontoPorPercentual,
  exigeAutorizacao,
  formatarPercentual,
  percentualParaBps,
  type ModoDesconto,
} from './desconto.js';

/** Onde o desconto vai cair. `varianteId` ausente significa "no total". */
export type AlvoDesconto = { readonly tipo: 'TOTAL' } | { readonly tipo: 'ITEM'; readonly varianteId: string };

interface Props {
  readonly alvo: AlvoDesconto;
  readonly aoFechar: () => void;
}

export function ModalDesconto({ alvo, aoFechar }: Props) {
  const carrinho = useCarrinho((estado) => estado.carrinho);
  const aplicarNoItem = useCarrinho((estado) => estado.aplicarDescontoNoItem);
  const aplicarNoTotal = useCarrinho((estado) => estado.aplicarDescontoNoTotal);
  const autorizacao = useCarrinho((estado) => estado.autorizacaoDesconto);
  const definirAutorizacao = useCarrinho((estado) => estado.definirAutorizacaoDesconto);
  const operadora = useSessao((estado) => estado.operadora);

  const item =
    alvo.tipo === 'ITEM'
      ? carrinho.itens.find((linha) => linha.varianteId === alvo.varianteId)
      : undefined;

  const [modo, setModo] = useState<ModoDesconto>('VALOR');
  /*
   * Abre com o desconto que JÁ existe, não em zero. Abrir zerado faria a
   * prévia mostrar a venda sem o desconto que está aplicado — a operadora leria
   * aquilo como o estado atual e acharia que o desconto se perdeu.
   */
  const [valorDigitado, setValorDigitado] = useState<number>(
    () => item?.descontoCentavos ?? carrinho.descontoSobreTotalCentavos,
  );
  const [percentualDigitado, setPercentualDigitado] = useState('');

  /*
   * Base do percentual.
   *
   * No item, é o valor bruto daquela linha. No total, é o que sobra DEPOIS dos
   * descontos já dados item a item — que é exatamente a base sobre a qual
   * `calcularVenda` rateia o desconto do total. Usar o subtotal cheio aqui
   * faria "10%" na tela virar mais de 10% na conta.
   */
  const base = useMemo(() => {
    if (item) return centavos(item.precoUnitarioCentavos * item.quantidade);
    const bruto = carrinho.itens.reduce(
      (soma, linha) =>
        soma + linha.precoUnitarioCentavos * linha.quantidade - linha.descontoCentavos,
      0,
    );
    return centavos(bruto);
  }, [carrinho.itens, item]);

  const bpsDigitado = percentualParaBps(percentualDigitado);
  const percentualInvalido = modo === 'PERCENTUAL' && percentualDigitado.trim() !== '' && bpsDigitado === null;

  const descontoCentavos =
    modo === 'VALOR'
      ? centavos(valorDigitado)
      : bpsDigitado === null
        ? centavos(0)
        : descontoPorPercentual(base, bpsDigitado);

  /*
   * Simula o carrinho JÁ COM o desconto e recalcula com a mesma função do
   * servidor. É daqui que sai o total que a cliente vai ouvir e o `descontoBps`
   * que decide a alçada — nada é recontado à mão nesta tela.
   */
  const previa = useMemo(() => {
    const candidato: EstadoCarrinho = item
      ? definirDescontoDoItem(carrinho, item.varianteId, descontoCentavos)
      : definirDescontoDoTotal(carrinho, descontoCentavos);
    try {
      return { ok: true as const, venda: calcular(candidato) };
    } catch (falha) {
      return {
        ok: false as const,
        mensagem: falha instanceof Error ? falha.message : 'Desconto inválido.',
      };
    }
  }, [carrinho, descontoCentavos, item]);

  const limite: PontosBase = pontosBase(operadora?.limiteDescontoBps ?? 0);
  const descontoBps = previa.ok ? previa.venda.descontoBps : pontosBase(0);
  const precisaGerente = previa.ok && exigeAutorizacao(descontoBps, limite);
  const podeConfirmar = previa.ok && !percentualInvalido && (!precisaGerente || autorizacao !== null);

  function confirmar() {
    if (!podeConfirmar) return;
    if (item) aplicarNoItem(item.varianteId, descontoCentavos);
    else aplicarNoTotal(descontoCentavos);
    // Sem alçada estourada não há o que provar: guardar um token aqui o levaria
    // para uma venda que não precisava dele.
    definirAutorizacao(precisaGerente ? autorizacao : null);
    aoFechar();
  }

  const titulo = item ? `Desconto em ${item.nome}` : 'Desconto no total da venda';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-desconto"
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) aoFechar();
      }}
    >
      <div className="elevado flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-card border border-line bg-surface">
        <header className="border-b border-line px-6 py-4">
          <h2 id="titulo-desconto" className="font-titulo text-[18px] font-medium">
            {titulo}
          </h2>
          <p className="num mt-1 text-[13px] text-ink-faint">
            Sobre {formatarBRL(base)}
            {item ? ` · ${item.quantidade}× ${formatarBRL(item.precoUnitarioCentavos)}` : ''}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-2">
            <BotaoModo ativo={modo === 'VALOR'} onClick={() => setModo('VALOR')}>
              Em reais
            </BotaoModo>
            <BotaoModo ativo={modo === 'PERCENTUAL'} onClick={() => setModo('PERCENTUAL')}>
              Em porcentagem
            </BotaoModo>
          </div>

          <div className="mt-5">
            {modo === 'VALOR' ? (
              <CampoDinheiro
                rotulo="Desconto"
                destaque
                valorCentavos={valorDigitado}
                aoMudar={setValorDigitado}
                ajuda="Zero remove o desconto."
              />
            ) : (
              <>
                <Campo
                  rotulo="Desconto (%)"
                  numerico
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="10 ou 10,5"
                  value={percentualDigitado}
                  onChange={(evento) => setPercentualDigitado(evento.target.value)}
                  erro={
                    percentualInvalido
                      ? 'Informe um percentual de 0 a 100, com até duas casas.'
                      : undefined
                  }
                  className="h-14 text-[17px]"
                />
                {bpsDigitado !== null && (
                  <p className="num mt-1.5 text-[13px] text-ink-faint">
                    {formatarPercentual(bpsDigitado)} de {formatarBRL(base)} ={' '}
                    {formatarBRL(descontoCentavos)}
                  </p>
                )}
              </>
            )}
          </div>

          {previa.ok ? (
            <dl
              data-testid="previa-desconto"
              className="mt-5 divide-y divide-line rounded-[8px] border border-line"
            >
              <LinhaPrevia rotulo="Subtotal" valor={previa.venda.subtotalCentavos} />
              <LinhaPrevia
                rotulo="Desconto da venda"
                valor={-previa.venda.descontoCentavos}
                tom="alerta"
              />
              <LinhaPrevia rotulo="Total" valor={previa.venda.totalCentavos} forte />
            </dl>
          ) : (
            <div className="mt-5">
              <Erro>{previa.mensagem}</Erro>
            </div>
          )}

          {/*
            O percentual efetivo da VENDA aparece sempre que há desconto, não só
            quando estoura a alçada: é o número pelo qual a gerente vai cobrar
            depois, e a operadora precisa vê-lo enquanto ainda dá para mudar.
          */}
          {previa.ok && descontoBps > 0 && (
            <p
              className={cx(
                'mt-3 text-[13px]',
                precisaGerente ? 'text-alerta' : 'text-ink-faint',
              )}
            >
              Desconto efetivo da venda: {formatarPercentual(descontoBps)}
              {precisaGerente
                ? ` — acima da sua alçada de ${formatarPercentual(limite)}.`
                : ` · sua alçada vai até ${formatarPercentual(limite)}.`}
            </p>
          )}

          {precisaGerente && (
            <AutorizacaoGerente
              autorizacao={autorizacao}
              aoAutenticar={definirAutorizacao}
              aoSair={() => definirAutorizacao(null)}
              explicacao="Este desconto passa da alçada da operadora. A gerente libera sem derrubar a sessão de quem está vendendo."
            />
          )}
        </div>

        <footer className="flex gap-2 border-t border-line px-6 py-4">
          <Botao variante="discreto" onClick={aoFechar} className="flex-1">
            Voltar
          </Botao>
          <Botao
            variante="primario"
            tamanho="grande"
            className="flex-[2]"
            disabled={!podeConfirmar}
            onClick={confirmar}
          >
            Aplicar desconto
          </Botao>
        </footer>
      </div>
    </div>
  );
}

function BotaoModo({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cx(
        'h-11 rounded-[8px] text-[14px] font-medium transition-colors duration-200',
        ativo ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-soft hover:bg-line hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function LinhaPrevia({
  rotulo,
  valor,
  tom,
  forte,
}: {
  rotulo: string;
  valor: number;
  tom?: 'alerta';
  forte?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className={cx('text-[14px]', forte ? 'font-medium text-ink' : 'text-ink-soft')}>
        {rotulo}
      </dt>
      <dd
        className={cx(
          'num',
          forte ? 'text-[17px] font-semibold' : 'text-[15px]',
          tom === 'alerta' ? 'text-alerta' : 'text-ink',
        )}
      >
        {formatarBRL(centavos(valor))}
      </dd>
    </div>
  );
}
