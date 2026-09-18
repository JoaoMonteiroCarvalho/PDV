import { z } from 'zod';

const centavosNaoNegativos = z.number().int('Valor deve ser inteiro em centavos').nonnegative();
const centavosPositivos = centavosNaoNegativos.positive();

export const esquemaAbrirSessao = z.object({
  terminalId: z.string().uuid(),
  fundoTrocoCentavos: centavosNaoNegativos,
});
export type EntradaAbrirSessao = z.infer<typeof esquemaAbrirSessao>;

export const esquemaMovimentoManual = z.object({
  tipo: z.enum(['SANGRIA', 'SUPRIMENTO']),
  valorCentavos: centavosPositivos,
  observacao: z.string().max(500).optional(),
  /** Token assinado de `POST /sessao/autorizar` — ver esquemas/devolucao.ts. */
  tokenAutorizacao: z.string().min(1, 'Autorização de gerente é obrigatória'),
});
export type EntradaMovimentoManual = z.infer<typeof esquemaMovimentoManual>;

export const esquemaFecharSessao = z.object({
  valorContadoCentavos: centavosNaoNegativos,
});
export type EntradaFecharSessao = z.infer<typeof esquemaFecharSessao>;
