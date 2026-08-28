import { config } from 'dotenv';
import { resolve } from 'node:path';

// O .env vive na raiz do monorepo, não dentro de apps/api.
config({ path: resolve(__dirname, '../../../.env') });

/**
 * Os testes de integração fazem TRUNCATE em todas as tabelas a cada caso.
 * Se rodassem no banco de desenvolvimento, cada execução apagaria o catálogo
 * e as vendas. Então eles têm banco próprio — e a troca acontece aqui, antes
 * de qualquer PrismaClient ser instanciado.
 */
if (!process.env.DATABASE_URL_TESTE) {
  throw new Error(
    'DATABASE_URL_TESTE não definida. Veja .env.example — os testes de integração ' +
      'exigem um banco separado do de desenvolvimento.',
  );
}

if (process.env.DATABASE_URL_TESTE === process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL_TESTE aponta para o mesmo banco de DATABASE_URL. ' +
      'Os testes apagariam os dados de desenvolvimento.',
  );
}

process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
