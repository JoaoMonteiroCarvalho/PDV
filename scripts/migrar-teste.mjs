/**
 * Aplica as migrations no banco DE TESTE.
 *
 * Existe porque `DATABASE_URL=... comando` não funciona em npm script no
 * Windows (o cmd.exe não entende prefixo de variável de ambiente), e o banco
 * de teste precisa ser migrado separadamente do de desenvolvimento.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

if (!ambiente.DATABASE_URL_TESTE) {
  console.error('DATABASE_URL_TESTE não definida no .env — veja .env.example.');
  process.exit(1);
}

const resultado = spawnSync(
  'npx',
  ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'],
  {
    cwd: raiz,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: ambiente.DATABASE_URL_TESTE },
  },
);

process.exit(resultado.status ?? 1);
