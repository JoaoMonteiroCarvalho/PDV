import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combina classes condicionais e resolve conflito de utilitário Tailwind (a última vence). */
export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas));
}
