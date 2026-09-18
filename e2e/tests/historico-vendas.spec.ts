/**
 * Histórico de vendas, de ponta a ponta.
 *
 * Cobre o caso de o operador não ter o comprovante em mãos: em vez de digitar
 * número ou código, ele abre o histórico, encontra a venda na lista da
 * sessão atual e clica em "Devolver" direto dali.
 */

import { expect, test } from '@playwright/test';
import {
  DADOS_E2E,
  esperarCatalogoSincronizado,
  garantirTerminalFechado,
  irParaVenda,
} from '../fixtures.js';

test.describe('histórico de vendas', () => {
  test.beforeEach(async () => {
    await garantirTerminalFechado();
  });

  test('lista a venda da sessão atual, com operador e total', async ({ page }) => {
    await irParaVenda(page);

    await page.getByLabel(/Buscar produto/).fill('perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByTestId('total-venda')).toHaveText('R$ 120,00');

    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Débito' }).click();
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page).toHaveURL(/\/venda\/concluida/);

    await page.getByRole('link', { name: 'Histórico' }).click();
    await expect(page.getByRole('heading', { name: 'Histórico de vendas' })).toBeVisible();

    await expect(page.getByText(/Venda #\d+/)).toBeVisible();
    await expect(page.getByText('R$ 120,00')).toBeVisible();
    // O nome da operadora aparece duas vezes na tela (cabeçalho do Shell e a
    // linha da venda) — a busca fica restrita à linha da venda.
    await expect(page.getByText(new RegExp(`·\\s*${DADOS_E2E.operador.nome}`))).toBeVisible();
    // Venda recém-feita não pode aparecer como já tendo devolução.
    await expect(page.getByText('já teve devolução')).toHaveCount(0);
  });

  test('busca por cliente filtra a lista, e nome inexistente esvazia', async ({ page }) => {
    await irParaVenda(page);

    await page.getByLabel(/Buscar produto/).fill('perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Débito' }).click();
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page).toHaveURL(/\/venda\/concluida/);

    await page.getByRole('link', { name: 'Histórico' }).click();
    await expect(page.getByText(/Venda #\d+/)).toBeVisible();

    // A venda não teve cliente identificado — buscar por qualquer nome some
    // com ela, inclusive um nome real de outro cadastro.
    await page.getByLabel('Buscar').fill(DADOS_E2E.clienteFiado.nome);
    await expect(
      page.getByText(`Nenhuma venda de "${DADOS_E2E.clienteFiado.nome}" nesta sessão de caixa.`),
    ).toBeVisible();
  });

  test('sem caixa aberto, explica em vez de listar', async ({ page }) => {
    const { loginOperador, configurarTerminal } = await import('../fixtures.js');
    await loginOperador(page);
    await configurarTerminal(page);
    await page.goto('/historico');

    await expect(page.getByRole('heading', { name: 'Não há caixa aberto' })).toBeVisible();
  });

  test('devolver a partir da lista leva à tela de devolução', async ({ page }) => {
    await irParaVenda(page);
    await esperarCatalogoSincronizado(page, 4);

    await page.getByLabel(/Buscar produto/).fill('perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Débito' }).click();
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page).toHaveURL(/\/venda\/concluida/);

    await page.getByRole('link', { name: 'Histórico' }).click();
    await page.getByRole('button', { name: 'Devolver' }).click();

    await expect(page).toHaveURL(/\/devolucao/);
    await expect(page.getByRole('heading', { name: 'Devolução' })).toBeVisible();
  });
});
