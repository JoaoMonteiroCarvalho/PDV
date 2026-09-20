/**
 * Roda uma vez antes de toda a suíte: garante o banco de E2E MIGRADO, limpo e
 * semeado. Sem isso, um teste que rodou ontem deixaria dado que faz o de
 * hoje passar ou falhar por acidente.
 *
 * As migrations rodam aqui, e não à mão, por causa de um sintoma real: a
 * migration da `ConfiguracaoLoja` entrou no projeto e o banco de E2E ficou
 * para trás, porque só o de desenvolvimento e o de integração tinham comando
 * de migração. O teste que salva os dados da loja passou a receber 500 —
 * "a tabela não existe" — e a falha parecia bug da aplicação, não banco
 * desatualizado. Semear um schema velho é pior que não semear: o erro aponta
 * para o lugar errado.
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)));
  const projeto = resolve(raiz, '..');

  const bancoE2E = process.env.DATABASE_URL_E2E;
  if (!bancoE2E) {
    throw new Error('DATABASE_URL_E2E não definida no .env — veja .env.example.');
  }

  // `deploy` só aplica migrations já versionadas: nunca gera uma nova nem
  // pergunta nada, que é o comportamento certo para rodar sem ninguém olhando.
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], {
    cwd: projeto,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: bancoE2E },
  });

  execFileSync('npx', ['tsx', resolve(raiz, 'seed-e2e.ts')], {
    cwd: projeto,
    stdio: 'inherit',
    shell: true,
  });
}
