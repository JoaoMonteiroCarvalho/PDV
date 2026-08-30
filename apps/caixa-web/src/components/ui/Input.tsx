import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './utils.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marca visual de erro — usado pelo React Hook Form + Zod nas telas de formulário. */
  invalido?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalido, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalido || undefined}
        className={cn(
          'h-alvo w-full rounded border bg-fundo px-4 text-corpo text-texto',
          'placeholder:text-texto-secundario',
          'border-borda focus-visible:border-acento',
          invalido && 'border-perigo focus-visible:border-perigo',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
