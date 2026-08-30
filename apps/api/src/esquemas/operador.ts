import { z } from 'zod';

export const esquemaCriarOperador = z.object({
  nome: z.string().min(1).max(200),
  login: z.string().min(3).max(60),
  senha: z.string().min(6).max(100),
  papel: z.enum(['OPERADOR', 'GERENTE', 'ADMIN']).default('OPERADOR'),
  limiteDescontoBps: z.number().int().nonnegative().max(10_000).default(0),
});
export type EntradaCriarOperador = z.infer<typeof esquemaCriarOperador>;

export const esquemaAtualizarOperador = z.object({
  nome: z.string().min(1).max(200).optional(),
  papel: z.enum(['OPERADOR', 'GERENTE', 'ADMIN']).optional(),
  limiteDescontoBps: z.number().int().nonnegative().max(10_000).optional(),
  ativo: z.boolean().optional(),
  /** Redefinição de senha — opcional, só quando o gerente decide trocar. */
  novaSenha: z.string().min(6).max(100).optional(),
});
export type EntradaAtualizarOperador = z.infer<typeof esquemaAtualizarOperador>;
