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
import { useMemo } from 'react';
import { Botao, Erro, cx } from '../componentes/base.js';
import { SwatchCor } from '../componentes/SwatchCor.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { calcular, totalDePecas, type ItemCarrinho } from './carrinho.js';

export function PainelCarrinho({ aoFinalizar }: { aoFinalizar: () => void }) {
  const carrinho = useCarrinho((estado) => estado.carrinho);
  const mudarQuantidade = useCarrinho((estado) => estado.mudarQuantidade);
  const removerItem = useCarrinho((estado) => estado.removerItem);
  const limparVenda = useCarrinho((estado) => estado.limparVenda);

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
      <header className="flex items-baseline justify-between border-b border-line px-5 py-3">
        <h2 className="font-titulo text-[15px] font-medium">Venda atual</h2>
        <span className="num text-[13px] text-ink-faint">
          {totalDePecas(carrinho)} {totalDePecas(carrinho) === 1 ? 'peça' : 'peças'}
        </span>
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
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="shrink-0 border-t border-line px-5 py-4">
        {calculo?.ok === false && <Erro>{calculo.mensagem}</Erro>}

        {calculo?.ok && (
          <dl className="mb-3 space-y-1 text-[14px]">
            <Linha rotulo="Subtotal" valor={calculo.venda.subtotalCentavos} />
            {calculo.venda.descontoCentavos > 0 && (
              <Linha rotulo="Desconto" valor={-calculo.venda.descontoCentavos} tom="alerta" />
            )}
          </dl>
        )}

        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-[14px] text-ink-soft">Total</span>
          {/*
            O total repete o subtotal quando não há desconto, então "R$ 89,90"
            aparece três vezes no painel. O testid marca qual deles é O total —
            o número que a cliente pergunta.
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
    </aside>
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
}: {
  item: ItemCarrinho;
  aoMudarQuantidade: (quantidade: number) => void;
  aoRemover: () => void;
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
