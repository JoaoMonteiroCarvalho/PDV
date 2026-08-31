/**
 * Venda de produto sem variação (perfume) — para garantir que o catálogo
 * com tamanho/cor opcionais funciona no caminho real da tela, não só nos
 * testes unitários do carrinho.
 *
 * Reativado na Fase 3, que entregou a tela de venda. Antes disso o arquivo
 * ficou marcado como pendente: exercitava a UI antiga, removida na Fase 0.
 * A grade de variação tem cobertura própria em `venda-grade.spec.ts`; aqui o
 * foco é o produto que NÃO tem grade nenhuma.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, garantirTerminalFechado, irParaVenda } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

test('vende produto sem tamanho/cor e paga com débito', async ({ page }) => {
  await irParaVenda(page);

  await page.getByLabel(/Buscar produto/).fill('perfume');
  await page.getByRole('button', { name: 'Adicionar' }).click();

  await expect(page.getByTestId('total-venda')).toHaveText('R$ 120,00');

  await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
  const modal = page.getByRole('dialog');

  // Débito não gera troco: o lançamento fecha o saldo exatamente.
  await modal.getByRole('button', { name: 'Débito' }).click();
  await modal.getByRole('button', { name: 'Lançar pagamento' }).click();

  await expect(modal.getByText('Pago por completo')).toBeVisible();
  await expect(modal.getByText('Troco a devolver')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled();
});

test('produto simples não desenha grade de uma célula só', async ({ page }) => {
  await irParaVenda(page);
  await page.getByLabel(/Buscar produto/).fill('perfume');

  // Perfume não tem tamanho nem cor. Montar uma tabela com uma célula seria
  // ruído no lugar onde a operadora só quer clicar "adicionar".
  await expect(page.getByRole('button', { name: 'Adicionar' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('bipar o mesmo produto duas vezes soma a quantidade', async ({ page }) => {
  await irParaVenda(page);

  const busca = page.getByLabel(/Buscar produto/);
  const naGrade = page.getByRole('button', { name: /Adicionar Azul M,/ });

  await busca.fill('camiseta');
  await naGrade.click();

  await busca.fill('camiseta');
  await naGrade.click();

  // Uma linha só, quantidade 2 — não duas linhas.
  const carrinho = page.getByRole('complementary');
  await expect(carrinho.getByRole('listitem')).toHaveCount(1);
  await expect(carrinho.getByText('2 peças')).toBeVisible();
  await expect(page.getByTestId('total-venda')).toHaveText('R$ 100,00');
  await expect(carrinho.getByText(DADOS_E2E.produto.nome)).toBeVisible();
});
