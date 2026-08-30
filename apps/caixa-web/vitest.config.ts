import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Config própria para teste, em vez de reaproveitar vite.config.ts inteiro:
 * o VitePWA hookeia o build de produção e não faz sentido (nem é seguro)
 * dentro do ambiente de teste. Só o que os componentes realmente precisam
 * pra renderizar — plugin do React e o alias `@` — é repetido aqui.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/testes/configuracao.ts'],
    passWithNoTests: true,
  },
});
