import type { HTMLAttributes } from 'react';
import { cn } from './utils.js';

/**
 * Indicador curto de estado — usado no indicador de conexão (online/offline/
 * sincronizando/N pendentes) e em qualquer outro "rótulo de status" do
 * sistema. Sempre com texto, nunca só cor ou ícone: cor sozinha não é
 * acessível e, sob luz de loja ruim, é fácil de confundir.
 */
const tons = {
  neutro: 'bg-superficie-alta text-texto-secundario',
  sucesso: 'bg-sucesso/15 text-sucesso',
  alerta: 'bg-alerta/15 text-alerta',
  perigo: 'bg-perigo/15 text-perigo',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tom?: keyof typeof tons;
}

export function Badge({ className, tom = 'neutro', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-rotulo font-medium',
        tons[tom],
        className,
      )}
      {...props}
    />
  );
}
