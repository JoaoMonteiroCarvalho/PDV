/**
 * Aplica as migrations num banco alternativo ao de desenvolvimento (teste,
 * e2e...), escolhido pelo nome da variável de ambiente passada como argumento.
 *
 * Existe porque `DATABASE_URL=... comando` não funciona em npm script no
 * Windows (o cmd.exe não entende prefixo de variável de ambiente), e os bancos
 * de teste/e2e precisam ser migrados separadamente do de desenvolvimento —
 * `npm run db:migrate` sempre aponta para DATABASE_URL (o banco `pdv`).
 *
 * Uso: node scripts/migrar-banco.mjs DATABASE_URL_TESTE
 *      node scripts/migrar-banco.mjs DATABASE_URL_E2E
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const nomeVariavel = process.argv[2];
if (!nomeVariavel) {
  console.error('Uso: node scripts/migrar-banco.mjs <NOME_DA_VARIAVEL_NO_ENV>');
  console.error('Exemplo: node scripts/migrar-banco.mjs DATABASE_URL_TESTE');
  process.exit(1);
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ambiente = Object.fromEntries(
  readFileSync(resolve(raiz, '.env'), 'utf8')
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha && !linha.startsWith('#'))
    .map((linha) => {
      const separador = linha.indexOf('=');
      return [linha.slice(0, separador), linha.slice(separador + 1)];
    }),
);

const url = ambiente[nomeVariavel];
if (!url) {
  console.error(`${nomeVariavel} não definida no .env — veja .env.example.`);
  process.exit(1);
}

const resultado = spawnSync(
  'npx',
  ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'],
  {
    cwd: raiz,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: url },
  },
);

process.exit(resultado.status ?? 1);
