import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from './utils.js';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * `<select>` nativo estilizado igual ao `Input` — mantém o comportamento
 * nativo (teclado, leitor de tela, mobile) em vez de reimplementar um
 * dropdown customizado, só troca a aparência default do navegador pela seta
 * do design system.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => {
  return (
    <select
      ref={ref}
      className={cn(
        'h-alvo w-full appearance-none rounded border border-borda bg-fundo bg-no-repeat px-4 pr-10 text-corpo text-texto',
        'focus-visible:border-acento',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%239AA6BF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 7l5 5 5-5'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.75rem center',
        backgroundSize: '1rem',
      }}
      {...props}
    />
  );
});
Select.displayName = 'Select';
