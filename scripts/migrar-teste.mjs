/**
 * Aplica as migrations no banco DE TESTE.
 *
 * Existe porque `DATABASE_URL=... comando` não funciona em npm script no
 * Windows (o cmd.exe não entende prefixo de variável de ambiente), e o banco
 * de teste precisa ser migrado separadamente do de desenvolvimento.
 *
 * A variável vem do AMBIENTE primeiro e do `.env` só como conveniência de
 * máquina de desenvolvimento. Lendo apenas o arquivo, este script seria
 * inutilizável em CI — onde não existe `.env` e as credenciais chegam pelo
 * ambiente, que é como credencial deve chegar.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function lerArquivoEnv() {
  const caminho = resolve(raiz, '.env');
  if (!existsSync(caminho)) return {};

  return Object.fromEntries(
    readFileSync(caminho, 'utf8')
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha && !linha.startsWith('#'))
      .map((linha) => {
        const separador = linha.indexOf('=');
        return [linha.slice(0, separador), linha.slice(separador + 1)];
      }),
  );
}

const ambiente = { ...lerArquivoEnv(), ...process.env };

if (!ambiente.DATABASE_URL_TESTE) {
  console.error(
    'DATABASE_URL_TESTE não definida. Defina no ambiente ou no .env — veja .env.example.',
  );
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
