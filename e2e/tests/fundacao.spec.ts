/**
 * Fundação da nova interface — o que já existe depois da Fase 0.
 *
 * Cobre login, os dois guards de rota e a regra de tema. As telas de venda,
 * caixa e devolução ainda não foram reconstruídas; os specs delas estão
 * marcados como pendentes e voltam conforme cada fase entrega.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, garantirTerminalFechado, loginOperador } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

test.describe('tema', () => {
  test('abre em tema claro e NUNCA herda o modo escuro do sistema', async ({ browser }) => {
    // Simula um computador de loja com o Windows em modo escuro. Foi
    // exatamente esse cenário que fazia a tela abrir escura sem ninguém pedir.
    const contexto = await browser.newContext({ colorScheme: 'dark' });
    const pagina = await contexto.newPage();

    await pagina.goto('/entrar');

    await expect(pagina.locator('html')).toHaveAttribute('data-theme', 'light');
    const fundo = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fundo).toBe('rgb(251, 251, 253)'); // --bg do tema claro

    await contexto.close();
  });
});

test.describe('login', () => {
  test('entra com credencial válida e chega ao app', async ({ page }) => {
    await loginOperador(page);
    await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
    await expect(page.getByText(DADOS_E2E.operador.nome)).toBeVisible();
  });

  test('recusa senha errada mostrando o erro junto do formulário', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('Operadora').fill(DADOS_E2E.operador.login);
    await page.getByLabel('Senha').fill('senha-errada');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // Erro no lugar da ação que falhou — não em tela em branco nem alerta solto.
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test('valida campo vazio sem ir à rede', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByText('Informe o usuário')).toBeVisible();
    await expect(page.getByText('Informe a senha')).toBeVisible();
  });
});

test.describe('guards de rota', () => {
  test('sem login, qualquer rota manda para a tela de entrada', async ({ page }) => {
    await page.goto('/historico');
    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('depois de entrar, volta para a rota que a operadora tentou abrir', async ({ page }) => {
    await page.goto('/historico');
    await expect(page).toHaveURL(/\/entrar/);

    await page.getByLabel('Operadora').fill(DADOS_E2E.operador.login);
    await page.getByLabel('Senha').fill(DADOS_E2E.operador.senha);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL(/\/historico/);
  });

  test('sem caixa aberto, a venda é bloqueada antes de lançar qualquer item', async ({ page }) => {
    await loginOperador(page);
    await page.goto('/venda');
    // Bloquear na rota evita a operadora lançar dez itens e só descobrir o
    // problema na hora de finalizar.
    await expect(page).toHaveURL(/\/caixa/);
  });
});

test.describe('barra de estado', () => {
  test('mostra a conexão em palavras, não só por ícone', async ({ page }) => {
    await loginOperador(page);
    await expect(page.getByText('Online')).toBeVisible();
  });

  test('offline avisa que a venda continua possível', async ({ page, context }) => {
    await loginOperador(page);
    await context.setOffline(true);
    // O indicador reage ao evento `offline` do navegador.
    await expect(page.getByText(/vendendo normalmente/i)).toBeVisible({ timeout: 10_000 });
    await context.setOffline(false);
  });
});
