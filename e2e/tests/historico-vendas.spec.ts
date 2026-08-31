/**
 * Histórico de vendas, de ponta a ponta.
 *
 * Cobre o caso de o operador não ter o comprovante em mãos: em vez de digitar
 * número ou código, ele abre o histórico, encontra a venda na lista da
 * sessão atual e clica em "Devolver" direto dali.
 */

/*
 * PENDENTE — aguardando reconstrucao da interface.
 *
 * Este spec exercita a UI ANTIGA (dark, sem rotas), removida na Fase 0.
 * Ele nao esta "quebrado": a funcionalidade continua existindo e coberta
 * por teste de integracao no backend. O que sumiu foi a tela.
 *
 * Volta a rodar quando Fase 5 entregar: histórico de vendas.
 * Deixar como skip e registro de divida, nao conserto.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, irParaTelaCaixa } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

test.skip('lista a venda no histórico e devolve direto pela lista, sem digitar número', async ({
  page,
  context,
}) => {
  await irParaTelaCaixa(page);

  await page.getByPlaceholder('0,00').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();
  await esperarCatalogoSincronizado(page, 2);

  // --- Venda -------------------------------------------------------------
  const busca = page.getByPlaceholder(/Bipe o código de barras/);
  await busca.fill('camiseta');
  await page.getByRole('button', { name: new RegExp(DADOS_E2E.produto.nome) }).click();

  await page.getByPlaceholder(/Falta/).fill('50,00');
  await page.getByRole('button', { name: 'Débito' }).click();

  const [janelaImpressao] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Finalizar e imprimir' }).click(),
  ]);
  await janelaImpressao.waitForLoadState();
  await janelaImpressao.close();
  await expect(page.getByText(/Venda de R\$ 50,00 finalizada/)).toBeVisible();

  // --- Histórico -----------------------------------------------------------
  await page.getByRole('button', { name: 'Histórico' }).click();
  await expect(page.getByRole('heading', { name: 'Histórico de vendas' })).toBeVisible();

  await expect(page.locator('.lista-historico li')).toHaveCount(1);
  await expect(page.locator('.lista-historico .valor')).toHaveText('R$ 50,00');
  await expect(page.getByText(new RegExp(DADOS_E2E.operador.nome))).toBeVisible();

  // --- Devolução direto pela lista, sem digitar número/código -------------
  await page.getByRole('button', { name: 'Devolver' }).click();
  await expect(page.getByText(/Venda #\d+/)).toBeVisible();
  await expect(page.getByText(/disponível 1/)).toBeVisible();

  await page.locator('.itens-devolucao li').getByRole('button', { name: '+' }).click();
  await page.getByPlaceholder('Ex.: peça com defeito').fill('Cliente trocou de ideia');
  await page.locator('label', { hasText: 'Login do gerente' }).locator('input').fill(DADOS_E2E.gerente.login);
  await page.locator('label', { hasText: 'Senha do gerente' }).locator('input').fill(DADOS_E2E.gerente.senha);
  await page.getByRole('button', { name: 'Confirmar devolução' }).click();

  await expect(page.getByText(/Devolução de R\$ 50,00 registrada/)).toBeVisible();
  await page.getByRole('button', { name: 'Ok' }).click();

  // Concluir a devolução a partir do histórico volta pra lista do histórico
  // (não pra tela de venda) — e já mostra o resultado atualizado.
  await expect(page.getByRole('heading', { name: 'Histórico de vendas' })).toBeVisible();
  await expect(page.getByText(/já teve devolução/)).toBeVisible();
});

test.skip('busca por cliente filtra a lista do histórico', async ({ page, context }) => {
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
  await janelaImpressao.waitForLoadState();
  await janelaImpressao.close();
  await expect(page.getByText(/Venda de R\$ 50,00 finalizada/)).toBeVisible();

  await page.getByRole('button', { name: 'Histórico' }).click();
  await expect(page.locator('.lista-historico li')).toHaveCount(1);

  // Busca por um nome que não corresponde a nenhum cliente da venda (venda
  // não teve cliente identificado) — a lista deve esvaziar.
  await page.getByPlaceholder('Nome do cliente').fill('Cliente Inexistente');
  await expect(page.getByText('Nenhuma venda encontrada nesta sessão de caixa.')).toBeVisible();
});
