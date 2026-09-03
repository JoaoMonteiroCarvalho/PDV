/**
 * Primitivos de UI.
 *
 * Poucos componentes, cada um com bastante peso — o oposto de uma biblioteca
 * com trinta variantes. Todo botão, card e modal do sistema usa o mesmo
 * `--raio` e a mesma sombra difusa, para a interface parecer uma peça só.
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

/** Junta classes ignorando falsy — evita depender de `clsx` só para isto. */
export function cx(...partes: Array<string | false | null | undefined>): string {
  return partes.filter(Boolean).join(' ');
}

type VarianteBotao = 'primario' | 'neutro' | 'discreto' | 'destaque' | 'perigo';
type TamanhoBotao = 'medio' | 'grande';

/*
 * Três níveis de peso, e a distância entre eles é o que orienta a mão:
 * o vinho CHEIO é a ação da tela, o vinho de CONTORNO é a alternativa, e o
 * fantasma é o que quase não se usa. Dois botões cheios lado a lado
 * anulariam essa hierarquia.
 *
 * `hover:brightness` não serve mais: sobre o vinho ele lavava a cor. Agora o
 * hover troca para o vinho profundo, que é um valor da marca.
 */
const VARIANTES: Record<VarianteBotao, string> = {
  primario: 'bg-accent text-accent-ink hover:bg-accent-forte active:bg-accent-forte',
  neutro: 'border border-accent/45 bg-transparent text-accent hover:bg-accent hover:text-accent-ink',
  discreto: 'bg-transparent text-ink-soft hover:text-ink hover:bg-sunken',
  /*
   * Ouro. É o único lugar da interface onde ele preenche área, e serve para
   * a exceção que precisa ser vista de longe — desconto, cortesia. Texto em
   * vinho profundo porque branco sobre ouro dá 2,1:1 e some.
   */
  destaque: 'bg-realce text-realce-ink hover:brightness-95 active:brightness-90',
  // Destrutivo não é vermelho-cheio: é discreto até o hover, para não convidar
  // ao clique acidental num botão que cancela venda.
  perigo: 'bg-transparent text-perigo hover:bg-perigo hover:text-white',
};

const TAMANHOS: Record<TamanhoBotao, string> = {
  medio: 'h-11 px-5 text-[15px]',
  // Alvos grandes: a operadora usa com pressa, às vezes com a mão ocupada.
  grande: 'h-14 px-7 text-[17px]',
};

export interface PropsBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
}

export const Botao = forwardRef<HTMLButtonElement, PropsBotao>(function Botao(
  { variante = 'neutro', tamanho = 'medio', className, ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[8px] font-medium',
        'transition-[filter,background-color,color] duration-200 ease-[var(--ease-suave)]',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTES[variante],
        TAMANHOS[tamanho],
        className,
      )}
      {...resto}
    />
  );
});

export interface PropsCampo extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string;
  /** Mensagem de erro exibida junto ao campo — nunca num alerta solto. */
  erro?: string | undefined;
  /** Preço, código, quantidade: alinha em coluna com largura tabular. */
  numerico?: boolean;
}

export const Campo = forwardRef<HTMLInputElement, PropsCampo>(function Campo(
  { rotulo, erro, numerico, className, id, ...resto },
  ref,
) {
  const idCampo = id ?? resto.name;
  return (
    <label className="flex flex-col gap-1.5">
      {rotulo && <span className="text-[13px] text-ink-soft">{rotulo}</span>}
      <input
        ref={ref}
        id={idCampo}
        aria-invalid={erro ? true : undefined}
        className={cx(
          'h-12 rounded-[8px] border bg-surface px-4 text-[16px] text-ink',
          'placeholder:text-ink-faint transition-colors duration-200',
          numerico && 'num',
          /*
           * Foco com anel, não só troca de borda: sobre o marfim uma borda de
           * 1px mudando de cor é sutil demais para quem opera de pé e com
           * pressa. O anel usa a mesma cor da borda, então não pisca.
           */
          erro
            ? 'border-perigo focus:ring-2 focus:ring-perigo/30'
            : 'border-line focus:border-accent focus:ring-2 focus:ring-accent/25',
          'focus:outline-none',
          className,
        )}
        {...resto}
      />
      {erro && <span className="text-[13px] text-perigo">{erro}</span>}
    </label>
  );
});

export function Cartao({
  children,
  className,
  elevado = true,
}: {
  children: ReactNode;
  className?: string;
  elevado?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-card border border-line bg-surface',
        elevado && 'elevado',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Rótulo pequeno de estado. Cor semântica, nunca decorativa. */
export function Selo({
  children,
  tom = 'neutro',
}: {
  children: ReactNode;
  tom?: 'neutro' | 'ok' | 'alerta' | 'perigo' | 'accent';
}) {
  /*
   * Pílulas de status do PDV. O fundo é a própria cor a 12% e o texto é ela
   * cheia — legível sobre marfim e sobre branco, sem precisar de uma variante
   * por superfície. `accent` (blush com texto vinho) é o tom do fiado.
   */
  const tons = {
    neutro: 'bg-sunken text-ink-soft',
    ok: 'bg-ok/12 text-ok',
    alerta: 'bg-alerta/12 text-alerta',
    perigo: 'bg-perigo/12 text-perigo',
    accent: 'bg-accent-soft text-accent',
  } as const;

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
        tons[tom],
      )}
    >
      {children}
    </span>
  );
}

/**
 * Erro no lugar da ação que falhou — nunca uma tela em branco.
 * Sempre traz o que fazer a seguir, não só o que deu errado.
 */
export function Erro({ children, aoTentarNovamente }: { children: ReactNode; aoTentarNovamente?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-[8px] border border-perigo/25 bg-perigo/8 px-4 py-3"
    >
      <span className="mt-0.5 text-perigo" aria-hidden>
        !
      </span>
      <div className="flex-1 text-[14px] text-ink">{children}</div>
      {aoTentarNovamente && (
        <Botao variante="discreto" onClick={aoTentarNovamente}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}
