/**
 * Devolução de item com quantidade parcial, de ponta a ponta: vende 2
 * unidades, devolve 1, confirma que a segunda continua disponível.
 *
 * Cobre o caso real de moda íntima que motivou remodelar o schema: cliente
 * compra várias peças iguais e devolve só uma.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, irParaTelaCaixa } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

test('vende 2 unidades, devolve 1 e a outra continua disponível para devolução futura', async ({
  page,
  context,
}) => {
  await irParaTelaCaixa(page);

  await page.getByPlaceholder('0,00').fill('200,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();
  await esperarCatalogoSincronizado(page, 2);

  // --- Venda de 2 unidades ---------------------------------------------
  const busca = page.getByPlaceholder(/Bipe o código de barras/);
  const itemDaBusca = page.getByRole('button', { name: new RegExp(DADOS_E2E.produto.nome) });
  await busca.fill('camiseta');
  await itemDaBusca.click();
  await busca.fill('camiseta');
  await itemDaBusca.click();

  await expect(page.locator('.itens .valor')).toHaveText('R$ 100,00');

  await page.getByPlaceholder(/Falta/).fill('100,00');
  await page.getByRole('button', { name: 'Débito' }).click();

  const [janelaImpressao] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Finalizar e imprimir' }).click(),
  ]);
  await janelaImpressao.waitForLoadState();
  const textoComprovante = await janelaImpressao.locator('pre').innerText();
  await janelaImpressao.close();

  // A venda ainda não sincronizou no instante da impressão ("Venda: pendente"),
  // então a busca usa o código curto do UUID, impresso sozinho numa linha —
  // 8 caracteres hexadecimais, sempre em maiúsculo.
  const codigoMatch = /^\s*([0-9A-F]{8})\s*$/m.exec(textoComprovante);
  expect(codigoMatch).not.toBeNull();
  const codigoVenda = codigoMatch![1];

  await expect(page.getByText(/Venda de R\$ 100,00 finalizada/)).toBeVisible();

  // --- Devolução de 1 das 2 unidades -------------------------------------
  await page.getByRole('button', { name: 'Devolução' }).click();
  await expect(page.getByRole('heading', { name: 'Devolução' })).toBeVisible();

  await page.getByPlaceholder('Ex.: 42 ou ABC12345').fill(codigoVenda!);
  await page.getByRole('button', { name: 'Buscar venda' }).click();

  await expect(page.getByText(/Venda #\d+/)).toBeVisible();
  await expect(page.getByText(/disponível 2/)).toBeVisible();

  // Incrementa a quantidade a devolver para 1.
  await page.locator('.itens-devolucao li').getByRole('button', { name: '+' }).click();
  await expect(page.getByText('Total a devolver: R$ 50,00')).toBeVisible();

  await page.getByPlaceholder('Ex.: peça com defeito').fill('Cliente comprou o tamanho errado');
  await page.locator('label', { hasText: 'Login do gerente' }).locator('input').fill(DADOS_E2E.gerente.login);
  await page.locator('label', { hasText: 'Senha do gerente' }).locator('input').fill(DADOS_E2E.gerente.senha);
  await page.getByRole('button', { name: 'Confirmar devolução' }).click();

  await expect(page.getByText(/Devolução de R\$ 50,00 registrada/)).toBeVisible();
  await page.getByRole('button', { name: 'Ok' }).click();

  // Volta pra tela de venda.
  await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();

  // --- Confere que só 1 unidade foi devolvida, a outra continua disponível ---
  await page.getByRole('button', { name: 'Devolução' }).click();
  await page.getByPlaceholder('Ex.: 42 ou ABC12345').fill(codigoVenda!);
  await page.getByRole('button', { name: 'Buscar venda' }).click();

  await expect(page.getByText(/já devolvido 1/)).toBeVisible();
  await expect(page.getByText(/disponível 1/)).toBeVisible();
});

test('devolução exige gerente válido — operador comum é recusado', async ({ page, context }) => {
  await irParaTelaCaixa(page);
  await page.getByPlaceholder('0,00').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();
  await esperarCatalogoSincronizado(page, 2);

  const busca = page.getByPlaceholder(/Bipe o código de barras/);
  await busca.fill('camiseta');
  await page.getByRole('button', { name: new RegExp(DADOS_E2E.produto.nome) }).click();

  await page.getByPlaceholder(/Falta/).fill('50,00');
  await page.getByRole('button', { name: 'Débito' }).click();

  const [janelaImpressao] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Finalizar e imprimir' }).click(),
  ]);
  const texto = await janelaImpressao.locator('pre').innerText();
  await janelaImpressao.close();
  const codigoVenda = /^\s*([0-9A-F]{8})\s*$/m.exec(texto)![1];

  await page.getByRole('button', { name: 'Devolução' }).click();
  await page.getByPlaceholder('Ex.: 42 ou ABC12345').fill(codigoVenda!);
  await page.getByRole('button', { name: 'Buscar venda' }).click();

  await page.locator('.itens-devolucao li').getByRole('button', { name: '+' }).click();
  await page.getByPlaceholder('Ex.: peça com defeito').fill('Teste sem gerente');
  // Credenciais do OPERADOR, não do gerente.
  await page.locator('label', { hasText: 'Login do gerente' }).locator('input').fill(DADOS_E2E.operador.login);
  await page.locator('label', { hasText: 'Senha do gerente' }).locator('input').fill(DADOS_E2E.operador.senha);
  await page.getByRole('button', { name: 'Confirmar devolução' }).click();

  await expect(page.getByText(/não tem perfil de gerente/i)).toBeVisible();
});
