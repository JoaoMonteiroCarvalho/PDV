import { defineConfig } from 'vitest/config';

/**
 * Testes de integração: exigem o PostgreSQL de pé (`npm run db:up`).
 * Ficam separados da suíte unitária de propósito — `npm test` precisa rodar
 * em qualquer máquina, inclusive sem Docker.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integracao.test.ts'],
    setupFiles: ['./teste/ambiente.ts'],
    // Compartilham o mesmo banco: rodar em paralelo faria um teste apagar o
    // dado do outro no TRUNCATE.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
