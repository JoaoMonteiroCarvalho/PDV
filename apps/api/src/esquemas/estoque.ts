/**
 * Validação de entrada da rota de estoque.
 *
 * Zod só confere FORMATO. A regra de negócio — se a variante existe, se quem
 * pediu tem permissão — fica no serviço, como no resto da API.
 */

import { z } from 'zod';

const itemEntrada = z.object({
  varianteId: z.string().uuid(),
  /**
   * Quantidade inteira e positiva. Entrada de estoque com fração existiria
   * para granel; esta loja vende peça, e aceitar fração aqui só abriria espaço
   * para saldo quebrado que ninguém sabe conferir na arara.
   */
  quantidade: z.number().int().positive(),
  /** Custo da nota, em centavos. Zero é aceito: brinde e bonificação existem. */
  custoUnitarioCentavos: z.number().int().min(0),
});

export const esquemaEntradaEstoque = z.object({
  /**
   * Limite de 500 itens por requisição. Nota de confecção grande passa de 100
   * linhas; 500 cobre com folga e evita que um arquivo corrompido vire uma
   * transação de milhares de linhas.
   */
  itens: z.array(itemEntrada).min(1).max(500),
  /** Documento de origem: número da NF-e, ou o que a loja usar de referência. */
  documento: z.string().trim().min(1).max(60).optional(),
  observacao: z.string().trim().max(300).optional(),
});

export type EntradaEstoqueEntrada = z.infer<typeof esquemaEntradaEstoque>;
