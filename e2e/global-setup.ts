/**
 * Roda uma vez antes de toda a suíte: garante o banco de E2E limpo e
 * semeado. Sem isso, um teste que rodou ontem deixaria dado que faz o de
 * hoje passar ou falhar por acidente.
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)));
  execFileSync('npx', ['tsx', resolve(raiz, 'seed-e2e.ts')], {
    cwd: resolve(raiz, '..'),
    stdio: 'inherit',
    shell: true,
  });
}
