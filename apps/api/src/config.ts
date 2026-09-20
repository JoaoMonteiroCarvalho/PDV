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
   * Origens que podem falar com a API, separadas por vírgula.
   *
   * Sem allowlist, qualquer página aberta no navegador do caixa consegue
   * disparar requisições autenticadas contra a API (o navegador anexa a
   * credencial sozinho). Numa máquina de loja, que também navega na internet,
   * isso é exposição real — não teoria.
   *
   * O padrão cobre as portas de desenvolvimento e de E2E. Em produção, defina
   * explicitamente o endereço do PWA.
   */
  ORIGENS_PERMITIDAS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174')
    .transform((valor) =>
      valor
        .split(',')
        .map((origem) => origem.trim())
        .filter((origem) => origem.length > 0),
    ),

  /**
   * Módulo fiscal. Esta versão NÃO emite NFC-e: imprime comprovante não
   * fiscal.
   *
   * A flag existe para que ligar o fiscal seja configuração, não refatoração —
   * e desde a porta em `fiscal/porta.ts` isso é literal: `criarEmissorFiscal`
   * é o único lugar que precisa ganhar um ramo novo. Enquanto false, nada no
   * caminho da venda consulta nada de fiscal.
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

  /*
   * Recusa subir com a flag ligada, e isso continua certo mesmo agora que a
   * porta fiscal existe.
   *
   * A porta é o ENCAIXE; não há emissor para encaixar nela. Subir com
   * `FISCAL_HABILITADO=true` faria a loja acreditar que está emitindo
   * documento fiscal enquanto não emite — que é pior do que assumir que não
   * emite. Falhar na partida, com mensagem dizendo o que falta, é o único
   * desfecho honesto.
   */
  if (resultado.data.FISCAL_HABILITADO) {
    throw new Error(
      'FISCAL_HABILITADO=true, mas nenhum emissor fiscal está implementado nesta versão. ' +
        'O sistema emite apenas comprovante NÃO FISCAL.\n' +
        'Para ligar: implemente a interface `EmissorFiscal` (apps/api/src/fiscal/porta.ts) ' +
        'e devolva-a em `criarEmissorFiscal` (apps/api/src/fiscal/desligado.ts). ' +
        'Até lá, mantenha a flag em false.',
    );
  }

  return resultado.data;
}
