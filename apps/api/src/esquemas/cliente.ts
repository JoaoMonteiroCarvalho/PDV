/**
 * Validação de entrada das rotas de cliente e crediário.
 *
 * O CPF é validado com `cpfValido` do `@pdv/shared` — o MESMO código que o
 * caixa usa. Duas implementações divergiriam, e o caixa aceitaria um cadastro
 * que a API recusa depois, sem ninguém perceber na hora.
 */

import { cpfValido } from '@pdv/shared';
import { z } from 'zod';

const cpfOpcional = z
  .string()
  .trim()
  .optional()
  /*
   * String vazia vira `undefined`: o campo é opcional na tela, e um formulário
   * enviando "" não pode virar um CPF vazio gravado no banco — o índice único
   * deixaria só a primeira cliente sem CPF ser cadastrada.
   */
  .transform((valor) => (valor === '' ? undefined : valor))
  .refine((valor) => valor === undefined || cpfValido(valor), {
    message: 'CPF inválido.',
  });

export const esquemaCriarCliente = z.object({
  nome: z.string().trim().min(2).max(120),
  cpf: cpfOpcional,
  telefone: z.string().trim().max(20).optional(),
  /**
   * Limite de crediário. Zero é o padrão e significa "não vende fiado para
   * esta cliente" — mais seguro que um limite implícito.
   */
  limiteCrediarioCentavos: z.number().int().min(0).max(100_000_00).default(0),
  observacao: z.string().trim().max(300).optional(),
});

export const esquemaAtualizarCliente = esquemaCriarCliente.partial();

export const esquemaBuscarClientes = z.object({
  busca: z.string().trim().max(120).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});

export const esquemaReceberParcela = z.object({
  sessaoCaixaId: z.string().uuid(),
  valorCentavos: z.number().int().positive(),
  forma: z.enum(['DINHEIRO', 'DEBITO', 'CREDITO', 'PIX']),
});

export type CriarClienteEntrada = z.infer<typeof esquemaCriarCliente>;
export type ReceberParcelaEntrada = z.infer<typeof esquemaReceberParcela>;
