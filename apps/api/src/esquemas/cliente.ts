import { z } from 'zod';

const centavosNaoNegativos = z.number().int().nonnegative();

export const esquemaCriarCliente = z.object({
  nome: z.string().min(1).max(200),
  cpf: z.string().max(20).optional(),
  telefone: z.string().max(30).optional(),
  email: z.string().email().max(200).optional(),
  limiteCrediarioCentavos: centavosNaoNegativos.default(0),
  observacao: z.string().max(500).optional(),
});
export type EntradaCriarCliente = z.infer<typeof esquemaCriarCliente>;

export const esquemaAtualizarCliente = z.object({
  nome: z.string().min(1).max(200).optional(),
  cpf: z.string().max(20).optional(),
  telefone: z.string().max(30).optional(),
  email: z.string().email().max(200).optional(),
  limiteCrediarioCentavos: centavosNaoNegativos.optional(),
  observacao: z.string().max(500).optional(),
  ativo: z.boolean().optional(),
});
export type EntradaAtualizarCliente = z.infer<typeof esquemaAtualizarCliente>;

export const esquemaListarClientes = z.object({
  busca: z.string().max(200).optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type EntradaListarClientes = z.infer<typeof esquemaListarClientes>;

export const esquemaReceberParcela = z.object({
  sessaoCaixaId: z.string().uuid(),
  valorCentavos: z.number().int().positive(),
  forma: z.enum(['DINHEIRO', 'DEBITO', 'CREDITO', 'PIX']),
});
export type EntradaReceberParcela = z.infer<typeof esquemaReceberParcela>;
