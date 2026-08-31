/**
 * Cena 3D do login.
 *
 * O que estes testes protegem não é a beleza da peça — é a garantia de que
 * ela NUNCA atrapalha quem só quer abrir o caixa. O 3D é enfeite; o login é
 * trabalho. Se a cena falhar, travar ou não existir, a operadora entra do
 * mesmo jeito.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E } from '../fixtures.js';

test.describe('cena 3D', () => {
  test('carrega a peça quando a máquina tem WebGL', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Arraste para girar')).toBeVisible();
  });

  test('o formulário aparece e recebe foco ANTES da cena carregar', async ({ page }) => {
    await page.goto('/entrar');
    // Sem esperar o canvas: o campo tem que estar pronto de imediato, porque
    // o Three.js entra por chunk separado e pode demorar.
    await expect(page.getByLabel('Operadora')).toBeFocused();
  });

  test('dá para logar sem nunca esperar a cena', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('Operadora').fill(DADOS_E2E.operador.login);
    await page.getByLabel('Senha').fill(DADOS_E2E.operador.senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  });

  test('a cena é destruída ao sair da tela, liberando a GPU', async ({ page }) => {
    await page.goto('/entrar');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    await page.getByLabel('Operadora').fill(DADOS_E2E.operador.login);
    await page.getByLabel('Senha').fill(DADOS_E2E.operador.senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();

    // Um contexto WebGL vivo em segundo plano consumiria GPU o dia inteiro.
    await expect(page.locator('canvas')).toHaveCount(0);
  });
});

test.describe('quando não há 3D', () => {
  test('operadora que desligou os efeitos vê o palco estático, não um erro', async ({ page }) => {
    await page.goto('/entrar');
    await page.evaluate(() => localStorage.setItem('pdv.efeitos3d', 'off'));
    await page.reload();

    await expect(page.locator('canvas')).toHaveCount(0);
    // Fallback elegante: a mesma embalagem em SVG, sem ícone quebrado.
    await expect(page.getByRole('img', { name: 'Embalagem da marca' })).toBeVisible();
    await expect(page.getByLabel('Operadora')).toBeVisible();
  });

  test('sem WebGL, o login continua inteiro e utilizável', async ({ browser }) => {
    // Simula mini-PC com driver antigo ou WebGL bloqueado por política.
    const contexto = await browser.newContext();
    await contexto.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = function () {
        return null;
      } as never;
    });
    const pagina = await contexto.newPage();

    await pagina.goto('/entrar');

    await expect(pagina.getByRole('img', { name: 'Embalagem da marca' })).toBeVisible();
    await expect(pagina.locator('canvas')).toHaveCount(0);

    // O que importa: dá para trabalhar.
    await pagina.getByLabel('Operadora').fill(DADOS_E2E.operador.login);
    await pagina.getByLabel('Senha').fill(DADOS_E2E.operador.senha);
    await pagina.getByRole('button', { name: 'Entrar' }).click();
    await expect(pagina.getByRole('button', { name: 'Sair' })).toBeVisible();

    await contexto.close();
  });
});
