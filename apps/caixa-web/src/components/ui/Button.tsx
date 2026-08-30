import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './utils.js';

/**
 * Botão genérico do sistema. Todo botão do PDV passa por aqui — nunca
 * estilizado solto numa tela, para não acabar com três aparências
 * diferentes do "mesmo" botão de finalizar.
 *
 * Altura mínima de 44px (var `alvo`) mesmo no tamanho pequeno: é o alvo de
 * clique recomendado, e ajuda quem clica com pressa no balcão.
 */

const variantes = {
  primaria: 'bg-acento text-acento-texto shadow-suave hover:bg-acento-hover hover:shadow-suave-lg',
  secundaria: 'bg-superficie-alta text-texto border border-borda/60 hover:bg-borda',
  perigo: 'bg-perigo text-texto shadow-suave hover:bg-perigo-hover hover:shadow-suave-lg',
  fantasma: 'bg-transparent text-texto-secundario hover:text-texto hover:bg-superficie-alta',
} as const;

const tamanhos = {
  padrao: 'h-alvo px-5 text-corpo',
  grande: 'h-14 px-6 text-valor',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: keyof typeof variantes;
  tamanho?: keyof typeof tamanhos;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variante = 'primaria', tamanho = 'padrao', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-full font-semibold',
          'transition-all duration-150 ease-out active:scale-[0.97]',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
          variantes[variante],
          tamanhos[tamanho],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
