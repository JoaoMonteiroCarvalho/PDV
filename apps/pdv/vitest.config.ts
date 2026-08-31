import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /*
     * jsdom para todos: os testes de lógica pura (carrinho, fila, comprovante)
     * rodam igual nele, e o `fake-indexeddb` também. Um ambiente só evita a
     * classe de bug em que o teste passa num ambiente e falha no outro.
     */
    environment: 'jsdom',
    setupFiles: ['./teste/preparo.ts'],
    passWithNoTests: true,
  },
});
