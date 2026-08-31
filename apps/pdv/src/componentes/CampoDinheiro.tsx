/**
 * Campo de valor monetário.
 *
 * Trabalha em CENTAVOS o tempo todo — o `number` que entra e sai é sempre
 * inteiro. Nenhum float passa por aqui.
 *
 * Digitação no padrão de PDV: a operadora digita só dígitos, da direita para
 * a esquerda, como numa maquininha. `1250` vira `R$ 12,50`. Isso é
 * deliberado e não é o mesmo que um campo de texto comum:
 *
 *   - elimina a dúvida entre vírgula e ponto, que em campo livre gera
 *     "12.50" interpretado como R$ 1.250,00;
 *   - deixa a mão no teclado numérico, sem procurar separador;
 *   - o valor formatado aparece enquanto digita, então um engano de casa
 *     decimal é visto na hora, não na conferência do caixa.
 */

import { formatarBRL, centavos as paraCentavos } from '@pdv/shared';
import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cx } from './base.js';

/** Mantém só os dígitos e lê o resultado como centavos. */
export function digitosParaCentavos(texto: string): number {
  const digitos = texto.replace(/\D/g, '');
  if (digitos === '') return 0;
  // Corta zeros à esquerda para o valor não crescer sem limite ao digitar.
  const inteiro = Number.parseInt(digitos.slice(-15), 10);
  return Number.isFinite(inteiro) ? inteiro : 0;
}

/**
 * Teto de 13 dígitos (R$ 99.999.999.999,99). Bem acima de qualquer venda real
 * e bem abaixo de `Number.MAX_SAFE_INTEGER`, onde a aritmética de centavos
 * deixaria de ser exata.
 */
const MAXIMO_CENTAVOS = 9_999_999_999_999;

/**
 * Aplica uma tecla ao valor, como uma maquininha faz: dígito entra pela
 * direita, apagar sai pela direita. `null` significa "não é tecla minha".
 *
 * Isto é caret-INDEPENDENTE de propósito, e essa é a correção que motivou a
 * função existir. Antes o valor saía do texto do campo, então onde o cursor
 * estivesse mudava o resultado: com "0,00" na tela, digitar "4" no fim dava
 * R$ 0,04 e digitar "4" no começo dava R$ 40,00. Um clique no meio do número
 * — coisa que acontece o tempo todo — lançava outro valor sem a operadora
 * perceber.
 */
export function aplicarTecla(valorAtual: number, tecla: string): number | null {
  if (tecla === 'Backspace') return Math.floor(valorAtual / 10);
  if (tecla === 'Delete') return 0;
  if (!/^\d$/.test(tecla)) return null;

  const novo = valorAtual * 10 + Number(tecla);
  // Estourou o teto: ignora a tecla em vez de truncar em silêncio.
  return novo > MAXIMO_CENTAVOS ? valorAtual : novo;
}

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  readonly rotulo?: string;
  readonly valorCentavos: number;
  readonly aoMudar: (centavos: number) => void;
  readonly erro?: string | undefined;
  readonly ajuda?: string | undefined;
  readonly destaque?: boolean;
}

export const CampoDinheiro = forwardRef<HTMLInputElement, Props>(function CampoDinheiro(
  { rotulo, valorCentavos, aoMudar, erro, ajuda, destaque, className, ...resto },
  ref,
) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      {rotulo && (
        <label htmlFor={id} className="text-[13px] text-ink-soft">
          {rotulo}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        // `inputMode` numérico abre o teclado certo em tela sensível ao toque,
        // sem virar `type="number"` (que traz setinhas e aceita "e", "+", "-").
        inputMode="numeric"
        autoComplete="off"
        value={formatarBRL(paraCentavos(valorCentavos), { simbolo: false })}
        /*
          A digitação é tratada no keydown, não no change: assim o valor não
          depende de onde o cursor está. Ver `aplicarTecla`.
        */
        onKeyDown={(evento) => {
          if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
          const novo = aplicarTecla(valorCentavos, evento.key);
          if (novo === null) return;
          evento.preventDefault();
          aoMudar(novo);
        }}
        /*
          O change continua existindo para o que não passa pelo teclado: colar
          um valor, autofill, ou o campo sendo preenchido por script. Aí sim
          vale ler os dígitos do texto inteiro.
        */
        onChange={(evento) => aoMudar(digitosParaCentavos(evento.target.value))}
        // Cursor sempre no fim: o número cresce pela direita, e um caret no
        // meio de "1.250,00" não significa nada neste campo.
        onFocus={(evento) => {
          const fim = evento.target.value.length;
          evento.target.setSelectionRange(fim, fim);
        }}
        onClick={(evento) => {
          const alvo = evento.currentTarget;
          const fim = alvo.value.length;
          alvo.setSelectionRange(fim, fim);
        }}
        aria-invalid={erro ? true : undefined}
        aria-describedby={ajuda ? `${id}-ajuda` : undefined}
        /*
          Fonte de CORPO com `tabular-nums`, não a monoespaçada.

          A regra do design system é usar IBM Plex Mono em número que alinha
          em COLUNA (lista de itens, totais empilhados). Um campo de entrada
          é um valor solto — e na monoespaçada a vírgula ganha largura de
          dígito, deixando "200 , 00" com um vão feio no tamanho grande.
          `tabular-nums` preserva o que importa aqui: os dígitos não dançam
          de largura enquanto a operadora digita.
        */
        className={cx(
          'rounded-[12px] border bg-surface text-right text-ink tabular-nums transition-colors duration-200',
          destaque ? 'h-16 px-5 text-[30px] font-medium' : 'h-12 px-4 text-[16px]',
          erro ? 'border-perigo' : 'border-line focus:border-accent',
          className,
        )}
        {...resto}
      />
      {ajuda && !erro && (
        <span id={`${id}-ajuda`} className="text-[13px] text-ink-faint">
          {ajuda}
        </span>
      )}
      {erro && <span className="text-[13px] text-perigo">{erro}</span>}
    </div>
  );
});
