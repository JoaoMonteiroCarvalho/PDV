/**
 * Contrato HTTP do histórico de vendas — consulta, não escreve nada.
 */

import { z } from 'zod';

/**
 * Lista paginada por CHAVE (`registradaEm`, `id`), decrescente — a mais
 * recente primeiro, que é como o operador quer ver o histórico. Mesmo motivo
 * do `/catalogo`: com offset, uma venda registrada no meio da consulta
 * desloca as páginas seguintes e faz uma venda sumir ou repetir na tela.
 */
export const esquemaListarVendas = z.object({
  /** Marca d'água da última venda já recebida nesta consulta. */
  antesDe: z.coerce.date().optional(),
  /** Desempate do cursor: id da última venda recebida com aquele `antesDe`. */
  ultimoId: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  /** Filtro de período pela data em que o servidor registrou a venda. */
  desde: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  operadorId: z.string().uuid().optional(),
});
export type EntradaListarVendas = z.infer<typeof esquemaListarVendas>;
