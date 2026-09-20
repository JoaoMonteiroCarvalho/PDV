/**
 * Carrinho da venda, sempre visível à direita.
 *
 * "Sempre visível" é requisito, não preferência: o total é a informação que a
 * cliente pergunta a cada peça adicionada. Um carrinho que precisa ser aberto
 * faz a operadora clicar para responder "quanto deu até agora?".
 *
 * O total exibido vem de `calcular()`, que é o MESMO código do servidor. O
 * valor final gravado ainda é o que o servidor devolve — mas eles não têm como
 * divergir, porque a conta é uma só.
 */

import { ZERO, centavos, formatarBRL } from '@pdv/shared';
import { useMemo, useState } from 'react';
import { Botao, Erro, cx } from '../componentes/base.js';
import { SwatchCor } from '../componentes/SwatchCor.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { useSessao } from '../estado/sessaoStore.js';
import { lerVendedores } from './vendedores.js';
import { calcular, totalDePecas, type ItemCarrinho } from './carrinho.js';
import { ModalDesconto, type AlvoDesconto } from './ModalDesconto.js';

export function PainelCarrinho({ aoFinalizar }: { aoFinalizar: () => void }) {
  const carrinho = useCarrinho((estado) => estado.carrinho);
  const mudarQuantidade = useCarrinho((estado) => estado.mudarQuantidade);
  const removerItem = useCarrinho((estado) => estado.removerItem);
  const limparVenda = useCarrinho((estado) => estado.limparVenda);
  const [alvoDesconto, setAlvoDesconto] = useState<AlvoDesconto | null>(null);

  const vazio = carrinho.itens.length === 0;

  /*
   * `calcular` lança quando o carrinho está vazio (uma venda sem item não é
   * venda). Isso é correto no domínio, mas a tela não pode explodir por isso —
   * o carrinho vazio é o estado inicial normal.
   */
  const calculo = useMemo(() => {
    if (vazio) return null;
    try {
      return { ok: true as const, venda: calcular(carrinho) };
    } catch (falha) {
      return {
        ok: false as const,
        mensagem: falha instanceof Error ? falha.message : 'Não foi possível calcular a venda.',
      };
    }
  }, [carrinho, vazio]);

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-surface">
      <header className="border-b border-line px-5 py-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-titulo text-[15px] font-medium">Venda atual</h2>
          <span className="num text-[13px] text-ink-faint">
            {totalDePecas(carrinho)} {totalDePecas(carrinho) === 1 ? 'peça' : 'peças'}
          </span>
        </div>
        <SeletorVendedora />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {vazio ? (
          <p className="px-5 py-8 text-center text-[14px] text-ink-faint">
            Nenhuma peça lançada. Bipe o código ou clique na grade ao lado.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {carrinho.itens.map((item) => (
              <LinhaItem
                key={item.varianteId}
                item={item}
                aoMudarQuantidade={(quantidade) => mudarQuantidade(item.varianteId, quantidade)}
                aoRemover={() => removerItem(item.varianteId)}
                aoDarDesconto={() =>
                  setAlvoDesconto({ tipo: 'ITEM', varianteId: item.varianteId })
                }
              />
            ))}
          </ul>
        )}
      </div>

      {/*
        A COSTURA do painel, em ouro — o mesmo recurso que divide as duas
        zonas do cartão de login. Em cima a lista, que se LÊ; embaixo o total e
        as ações, que se USAM.

        A divisão já existia, desenhada em cinza neutro. Trocá-la pelo ouro não
        acrescenta elemento nenhum à tela: dá cor de marca a uma linha que já
        estava lá, e emoldura o número que a cliente pergunta.
      */}
      <footer className="shrink-0 border-t border-realce px-5 py-4">
        {calculo?.ok === false && <Erro>{calculo.mensagem}</Erro>}

        {/*
          Subtotal só aparece quando há desconto, porque só aí ele é um número
          DIFERENTE do total.

          Antes ele vinha sempre, e sem desconto a tela mostrava "R$ 279,80"
          duas vezes, uma embaixo da outra. Passava despercebido enquanto os
          dois blocos eram uma pilha só; assim que entrou uma linha separando
          um do outro, ficou evidente que a linha separava um número dele
          mesmo. O ruído era antigo — a costura só o denunciou.
        */}
        {calculo?.ok && calculo.venda.descontoCentavos > 0 && (
          <dl className="mb-3 space-y-1 text-[14px]">
            <Linha rotulo="Subtotal" valor={calculo.venda.subtotalCentavos} />
            <Linha rotulo="Desconto" valor={-calculo.venda.descontoCentavos} tom="alerta" />
          </dl>
        )}

        {/*
          O desconto fica ACIMA do total, do lado do número que ele muda, e não
          entre os botões de ação: dar desconto não é um desfecho da venda como
          finalizar ou cancelar — é um ajuste na conta, e é da conta que ele
          tem que parecer parte.
        */}
        {!vazio && (
          <div className="mb-2 flex justify-end">
            <Botao
              variante="discreto"
              onClick={() => setAlvoDesconto({ tipo: 'TOTAL' })}
              className="h-8 px-2.5 text-[13px]"
            >
              {carrinho.descontoSobreTotalCentavos > 0
                ? `Desconto na venda: ${formatarBRL(carrinho.descontoSobreTotalCentavos)}`
                : 'Dar desconto na venda'}
            </Botao>
          </div>
        )}

        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-[14px] text-ink-soft">Total</span>
          {/*
            O testid marca qual número é O total. Ainda faz falta: o preço
            unitário de uma peça só no carrinho tem o mesmo valor, e com
            desconto o subtotal também aparece logo acima.
          */}
          <span
            data-testid="total-venda"
            className="num font-titulo text-[28px] font-semibold text-ink"
          >
            {formatarBRL(calculo?.ok ? calculo.venda.totalCentavos : ZERO)}
          </span>
        </div>

        <div className="flex gap-2">
          <Botao
            variante="primario"
            tamanho="grande"
            className="flex-1"
            disabled={!calculo?.ok}
            onClick={aoFinalizar}
          >
            Finalizar
          </Botao>
          <Botao
            variante="perigo"
            tamanho="grande"
            disabled={vazio}
            onClick={() => {
              // Cancelar venda descarta dinheiro que a operadora já lançou —
              // sempre confirma, e dizendo quantas peças somem.
              const pecas = totalDePecas(carrinho);
              const confirma = window.confirm(
                `Cancelar a venda e descartar ${pecas} ${pecas === 1 ? 'peça lançada' : 'peças lançadas'}?`,
              );
              if (confirma) limparVenda();
            }}
          >
            Cancelar
          </Botao>
        </div>
      </footer>

      {alvoDesconto && (
        <ModalDesconto alvo={alvoDesconto} aoFechar={() => setAlvoDesconto(null)} />
      )}
    </aside>
  );
}

/**
 * Quem atendeu esta venda.
 *
 * Fica no TOPO do carrinho, visível a venda inteira, e não escondido na
 * finalização. Vendedora errada manda a comissão para a pessoa errada, e isso
 * é o tipo de erro que ninguém percebe no momento — só no fim do mês, quando
 * já não dá para reconstituir quem atendeu quem.
 *
 * Some quando a loja tem uma pessoa só: um seletor de uma opção não é escolha,
 * é ruído numa tela que precisa ser lida com pressa.
 */
function SeletorVendedora() {
  const vendedorId = useCarrinho((estado) => estado.vendedorId);
  const definirVendedor = useCarrinho((estado) => estado.definirVendedor);
  const operadora = useSessao((estado) => estado.operadora);
  const vendedores = lerVendedores();

  if (vendedores.length <= 1) return null;

  return (
    <label className="mt-2 flex items-center gap-2">
      <span className="shrink-0 text-[12px] text-ink-faint">Vendeu</span>
      <select
        value={vendedorId ?? operadora?.id ?? ''}
        onChange={(evento) => definirVendedor(evento.target.value)}
        aria-label="Quem atendeu esta venda"
        className="min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2 py-1 text-[13px] text-ink focus:border-accent focus:outline-none"
      >
        {vendedores.map((vendedora) => (
          <option key={vendedora.id} value={vendedora.id}>
            {vendedora.nome}
          </option>
        ))}
      </select>
    </label>
  );
}

function Linha({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: number;
  tom?: 'alerta';
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-soft">{rotulo}</dt>
      <dd className={cx('num', tom === 'alerta' ? 'text-alerta' : 'text-ink')}>
        {formatarBRL(centavos(valor))}
      </dd>
    </div>
  );
}

function LinhaItem({
  item,
  aoMudarQuantidade,
  aoRemover,
  aoDarDesconto,
}: {
  item: ItemCarrinho;
  aoMudarQuantidade: (quantidade: number) => void;
  aoRemover: () => void;
  aoDarDesconto: () => void;
}) {
  const detalhe = [item.cor, item.tamanho].filter(Boolean).join(' · ');

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      {item.cor && <SwatchCor cor={item.cor} tamanho={18} />}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-ink">{item.nome}</p>
        <p className="num truncate text-[12px] text-ink-faint">
          {detalhe ? `${detalhe} · ` : ''}
          {formatarBRL(item.precoUnitarioCentavos)}
        </p>
        {/*
          O desconto do item aparece na própria linha. Sem isso ele só existiria
          dentro do total, e a operadora não teria como conferir em qual peça
          deu desconto — nem descobrir que deu na peça errada.
        */}
        {item.descontoCentavos > 0 && (
          <p className="num truncate text-[12px] text-alerta">
            desconto {formatarBRL(item.descontoCentavos)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <BotaoQuantidade
          rotulo={`Diminuir ${item.nome}`}
          onClick={() => aoMudarQuantidade(item.quantidade - 1)}
        >
          −
        </BotaoQuantidade>
        <span className="num w-7 text-center text-[15px] font-medium">{item.quantidade}</span>
        <BotaoQuantidade
          rotulo={`Aumentar ${item.nome}`}
          onClick={() => aoMudarQuantidade(item.quantidade + 1)}
        >
          +
        </BotaoQuantidade>
      </div>

      <button
        type="button"
        onClick={aoDarDesconto}
        aria-label={`Desconto em ${item.nome}`}
        className={cx(
          'rounded-[8px] px-2 py-1 text-[13px] transition-colors hover:bg-sunken hover:text-ink',
          item.descontoCentavos > 0 ? 'text-alerta' : 'text-ink-faint',
        )}
      >
        %
      </button>

      <button
        type="button"
        onClick={aoRemover}
        aria-label={`Remover ${item.nome}`}
        className="rounded-[8px] px-2 py-1 text-[13px] text-ink-faint transition-colors hover:bg-perigo/10 hover:text-perigo"
      >
        ✕
      </button>
    </li>
  );
}

function BotaoQuantidade({
  children,
  rotulo,
  onClick,
}: {
  children: string;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className="h-7 w-7 rounded-[8px] bg-sunken text-[15px] text-ink-soft transition-colors hover:bg-line hover:text-ink"
    >
      {children}
    </button>
  );
}
