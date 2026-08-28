/**
 * Venda de produto sem variação (perfume) — para garantir que o catálogo
 * com tamanho/cor opcionais funciona no caminho real da tela, não só nos
 * testes unitários do carrinho.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, irParaTelaCaixa } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

test('vende produto sem tamanho/cor e paga com débito', async ({ page }) => {
  await irParaTelaCaixa(page);

  await page.getByPlaceholder('0,00').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();
  await esperarCatalogoSincronizado(page, 2);

  await page.getByPlaceholder(/Bipe o código de barras/).fill('perfume');
  await expect(page.getByText(DADOS_E2E.produtoSemVariacao.nome)).toBeVisible();
  await page.getByText(DADOS_E2E.produtoSemVariacao.nome).click();

  await expect(page.locator('.itens .valor')).toHaveText('R$ 120,00');

  // Débito não gera troco — o botão de pagamento fecha o saldo exatamente.
  await page.getByPlaceholder(/Falta/).fill('120,00');
  await page.getByRole('button', { name: 'Débito' }).click();

  await expect(page.getByRole('button', { name: 'Finalizar e imprimir' })).toBeEnabled();
});

test('bipar o mesmo produto duas vezes soma a quantidade', async ({ page }) => {
  await irParaTelaCaixa(page);

  await page.getByPlaceholder('0,00').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();
  await esperarCatalogoSincronizado(page, 2);

  const busca = page.getByPlaceholder(/Bipe o código de barras/);
  // getByRole('button') evita a ambiguidade entre o item da lista de busca
  // (um <button>) e o <strong> que exibe o mesmo nome dentro do carrinho.
  const itemDaBusca = page.getByRole('button', { name: new RegExp(DADOS_E2E.produto.nome) });

  await busca.fill('camiseta');
  await itemDaBusca.click();

  await busca.fill('camiseta');
  await itemDaBusca.click();

  // Uma linha só, quantidade 2 — não duas linhas.
  await expect(page.locator('.itens li')).toHaveCount(1);
  await expect(page.locator('.itens .quantidade span')).toHaveText('2');
  await expect(page.locator('.itens .valor')).toHaveText('R$ 100,00');
});
