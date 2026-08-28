import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../.env') });

/**
 * Portas dedicadas ao E2E — diferentes das de desenvolvimento (3333/5173) —
 * para o Playwright poder rodar em paralelo com um `npm run dev` que já
 * esteja aberto, sem os dois brigarem pela mesma porta.
 */
const PORTA_API_E2E = 3334;
const PORTA_PWA_E2E = 5174;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // todos os testes compartilham o mesmo banco de E2E
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  globalSetup: resolve(import.meta.dirname, './global-setup.ts'),

  use: {
    baseURL: `http://localhost:${PORTA_PWA_E2E}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev -w @pdv/api',
      cwd: resolve(import.meta.dirname, '..'),
      url: `http://localhost:${PORTA_API_E2E}/saude`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL_E2E ?? '',
        PORTA: String(PORTA_API_E2E),
        NODE_ENV: 'test',
      } as Record<string, string>,
    },
    {
      command: 'npm run dev -w @pdv/caixa -- --port 5174',
      cwd: resolve(import.meta.dirname, '..'),
      url: `http://localhost:${PORTA_PWA_E2E}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...process.env,
        VITE_API_URL: `http://localhost:${PORTA_API_E2E}`,
      } as Record<string, string>,
    },
  ],
});
