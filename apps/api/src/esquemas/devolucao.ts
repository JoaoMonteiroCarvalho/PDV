import { z } from 'zod';

export const esquemaItemDevolucao = z.object({
  itemVendaId: z.string().uuid(),
  quantidade: z.number().int().positive(),
});

export const esquemaRegistrarDevolucao = z.object({
  motivo: z.string().min(3, 'Informe o motivo da devolução').max(500),
  formaEstorno: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'VALE_TROCA']),
  itens: z.array(esquemaItemDevolucao).min(1, 'Selecione ao menos um item para devolver'),
  /** Devolução SEMPRE exige gerente. Sem exceção de valor. */
  autorizadoPorId: z.string().uuid(),
});
export type EntradaRegistrarDevolucao = z.infer<typeof esquemaRegistrarDevolucao>;
