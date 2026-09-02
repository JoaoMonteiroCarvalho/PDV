/**
 * Validação de entrada das rotas de usuários e configuração da loja.
 */

import { z } from 'zod';

/**
 * Senha mínima de 6 caracteres.
 *
 * Não é rigor de segurança de banco: é o mínimo para não virar "1234" na
 * primeira semana. O que protege de verdade é o scrypt no armazenamento; aqui
 * a regra existe para a senha do balcão não ser trivialmente adivinhável por
 * quem passa atrás do caixa.
 */
const senha = z.string().min(6).max(72);

export const esquemaCriarUsuario = z.object({
  nome: z.string().trim().min(2).max(80),
  /** Login é o que a operadora digita com pressa: sem espaço, sem acento. */
  login: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9._-]+$/, 'Use apenas letras sem acento, números, ponto, hífen ou sublinhado.'),
  senha,
  papel: z.enum(['OPERADOR', 'GERENTE', 'ADMIN']),
  /**
   * Alçada de desconto, em pontos-base. Zero é o padrão: quem não teve limite
   * definido não concede desconto sozinho, o que é mais seguro que herdar um
   * valor implícito.
   */
  limiteDescontoBps: z.number().int().min(0).max(10_000).default(0),
});

export const esquemaAtualizarUsuario = z.object({
  nome: z.string().trim().min(2).max(80).optional(),
  papel: z.enum(['OPERADOR', 'GERENTE', 'ADMIN']).optional(),
  limiteDescontoBps: z.number().int().min(0).max(10_000).optional(),
  ativo: z.boolean().optional(),
});

export const esquemaTrocarSenha = z.object({ senha });

export const esquemaConfiguracaoLoja = z.object({
  nome: z.string().trim().min(1).max(80),
  endereco: z.string().trim().max(120).optional(),
  telefone: z.string().trim().max(30).optional(),
  cnpj: z.string().trim().max(20).optional(),
  /**
   * Linha extra da política de troca. As regras legais — troca por defeito
   * garantida, restrição de higiene — NÃO passam por aqui: são fixas no
   * código porque não são configuráveis por opinião.
   */
  politicaTrocaExtra: z.string().trim().max(200).optional(),
});

export type CriarUsuarioEntrada = z.infer<typeof esquemaCriarUsuario>;
export type ConfiguracaoLojaEntrada = z.infer<typeof esquemaConfiguracaoLoja>;
