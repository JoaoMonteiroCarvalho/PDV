/**
 * Contrato HTTP do relatório de vendas.
 */

import { z } from 'zod';

export const esquemaRelatorioResumo = z
  .object({
    /** Default: início dos últimos 30 dias, para o endpoint ser usável sem argumento. */
    desde: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    operadorId: z.string().uuid().optional(),
  })
  .transform((entrada) => {
    const agora = new Date();
    const ate = entrada.ate ?? agora;
    const desde = entrada.desde ?? new Date(ate.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { desde, ate, operadorId: entrada.operadorId };
  })
  .refine((entrada) => entrada.desde.getTime() <= entrada.ate.getTime(), {
    message: '"desde" precisa ser anterior ou igual a "ate"',
    path: ['desde'],
  });

export type EntradaRelatorioResumo = z.infer<typeof esquemaRelatorioResumo>;
