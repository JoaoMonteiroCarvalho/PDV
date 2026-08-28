/**
 * Configuração da API.
 *
 * Todo segredo vem de variável de ambiente e é validado na partida. Se algo
 * obrigatório estiver faltando, o processo morre AQUI, com mensagem clara, em
 * vez de subir e falhar no meio de uma venda.
 */

import { z } from 'zod';

const esquemaAmbiente = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL é obrigatória — veja .env.example')
    .startsWith('postgresql://', 'DATABASE_URL deve ser uma conexão PostgreSQL'),

  PORTA: z.coerce.number().int().positive().default(3333),

  JWT_SEGREDO: z
    .string()
    .min(32, 'JWT_SEGREDO precisa de ao menos 32 caracteres — gere com: openssl rand -hex 32'),

  /**
   * Módulo fiscal. Esta versão NÃO emite NFC-e: imprime comprovante não
   * fiscal. A flag existe para que ligar o fiscal seja configuração, não
   * refatoração. Enquanto false, nada no caminho da venda a consulta.
   */
  FISCAL_HABILITADO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
});

export type Configuracao = z.infer<typeof esquemaAmbiente>;

export function carregarConfiguracao(ambiente: NodeJS.ProcessEnv = process.env): Configuracao {
  const resultado = esquemaAmbiente.safeParse(ambiente);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((problema) => `  - ${problema.path.join('.')}: ${problema.message}`)
      .join('\n');
    throw new Error(
      `Configuração inválida. A API não vai subir com ambiente incompleto:\n${problemas}\n\n` +
        `Copie .env.example para .env e preencha os campos obrigatórios.`,
    );
  }

  if (resultado.data.FISCAL_HABILITADO) {
    throw new Error(
      'FISCAL_HABILITADO=true, mas o módulo fiscal não está implementado nesta versão. ' +
        'O sistema emite apenas comprovante NÃO FISCAL. Mantenha a flag em false.',
    );
  }

  return resultado.data;
}
