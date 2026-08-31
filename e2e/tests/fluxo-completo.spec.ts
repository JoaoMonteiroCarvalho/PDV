/**
 * Fluxo completo do caixa: login → configurar terminal → abrir caixa →
 * vender → sangria com autorização de gerente → fechar caixa.
 *
 * Este é o teste mais importante do E2E: prova que as peças construídas em
 * incrementos separados (autenticação, sessão de caixa, carrinho, fila de
 * sincronização, impressão) realmente se encaixam quando um humano clica na
 * tela, não só quando cada módulo é testado isoladamente.
 *
 * COMPORTAMENTO REAL DO APP (descoberto rodando este teste, não presumido):
 * ao clicar "Abrir caixa", o App.tsx troca IMEDIATAMENTE para a tela de
 * venda — a tela "Caixa aberto" não fica visível nesse instante. Ela só
 * aparece ao voltar da venda pelo botão "Caixa".
 */

/*
 * PENDENTE — aguardando reconstrucao da interface.
 *
 * Este spec exercita a UI ANTIGA (dark, sem rotas), removida na Fase 0.
 * Ele nao esta "quebrado": a funcionalidade continua existindo e coberta
 * por teste de integracao no backend. O que sumiu foi a tela.
 *
 * Volta a rodar quando Fase 2, 3 e 6 entregar: abertura de caixa, tela de venda, sangria e fechamento.
 * Deixar como skip e registro de divida, nao conserto.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, irParaTelaCaixa } from '../fixtures.js';

test.describe.skip('fluxo completo de venda', () => {
  test.beforeEach(async () => {
    await garantirTerminalFechado();
  });

  test('login, abertura de caixa, venda, sangria e fechamento', async ({ page, context }) => {
    // --- Login e configuração inicial --------------------------------------
    await irParaTelaCaixa(page);

    // --- Abertura de caixa: abrir leva direto para a tela de venda ---------
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
    await page.getByPlaceholder('0,00').fill('200,00');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();

    await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();
    await esperarCatalogoSincronizado(page, 2);

    // --- Venda -----------------------------------------------------------
    await page.getByPlaceholder(/Bipe o código de barras/).fill('camiseta');
    await expect(page.getByText(DADOS_E2E.produto.nome)).toBeVisible();
    await page.getByText(DADOS_E2E.produto.nome).click();

    await expect(page.locator('.itens li')).toHaveCount(1);
    await expect(page.locator('.itens .valor')).toHaveText('R$ 50,00');

    await page.getByPlaceholder(/Falta/).fill('100,00');
    await page.getByRole('button', { name: 'Dinheiro' }).click();
    await expect(page.getByText(/Troco: R\$ 50,00/)).toBeVisible();

    const [janelaImpressao] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Finalizar e imprimir' }).click(),
    ]);
    await janelaImpressao.waitForLoadState();
    await expect(janelaImpressao.locator('pre')).toContainText('NAO E DOCUMENTO FISCAL');
    await expect(janelaImpressao.locator('pre')).toContainText(DADOS_E2E.produto.nome);
    await janelaImpressao.close();

    await expect(page.getByText(/Venda de R\$ 50,00 finalizada/)).toBeVisible();
    await expect(page.locator('.itens li')).toHaveCount(0);

    // --- Volta ao caixa para conferir e fechar ------------------------------
    await page.getByRole('button', { name: 'Caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();

    // Fundo (200) + venda em dinheiro líquida do troco (50) = 250 esperados.
    await expect(page.getByText('R$ 250,00')).toBeVisible();

    // --- Sangria: exige autenticação de gerente, mesmo para valor pequeno --
    await page.getByRole('button', { name: 'Sangria' }).click();
    await page.locator('label', { hasText: 'Valor' }).locator('input').fill('30,00');
    await page.locator('label', { hasText: 'Login do gerente' }).locator('input').fill(DADOS_E2E.gerente.login);
    await page.locator('label', { hasText: 'Senha do gerente' }).locator('input').fill(DADOS_E2E.gerente.senha);
    await page.getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.getByText(/Sangria de R\$ 30,00 registrada/)).toBeVisible();
    // Esperado cai para 250 - 30 = 220.
    await expect(page.getByText('R$ 220,00')).toBeVisible();

    // --- Fechamento sem divergência ------------------------------------------
    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    await page.locator('label', { hasText: 'Valor contado' }).locator('input').fill('220,00');
    await page.getByRole('button', { name: 'Confirmar fechamento' }).click();

    await expect(page.getByText('A gaveta bateu certinho com o esperado.')).toBeVisible();
    await page.getByRole('button', { name: 'Ok' }).click();

    // Depois de fechar, o mesmo terminal volta à tela de ABERTURA — a sessão
    // anterior não existe mais para ser reaberta.
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
  });

  test('sangria é bloqueada sem gerente válido', async ({ page }) => {
    await irParaTelaCaixa(page);

    await page.getByPlaceholder('0,00').fill('100,00');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();

    await page.getByRole('button', { name: 'Caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();

    await page.getByRole('button', { name: 'Sangria' }).click();
    await page.locator('label', { hasText: 'Valor' }).locator('input').fill('10,00');
    // Credenciais do OPERADOR, não do gerente — a API deve recusar com 403.
    await page.locator('label', { hasText: 'Login do gerente' }).locator('input').fill(DADOS_E2E.operador.login);
    await page.locator('label', { hasText: 'Senha do gerente' }).locator('input').fill(DADOS_E2E.operador.senha);
    await page.getByRole('button', { name: 'Confirmar' }).click();

    // Mensagem de erro especifica da API, nao o rotulo generico dos campos.
    await expect(page.getByText(/não tem perfil de gerente/i)).toBeVisible();
    // O painel de sangria continua aberto — a operação não foi concluída.
    await expect(page.getByRole('heading', { name: 'Sangria (retirada)' })).toBeVisible();
  });

  test('fechamento com divergência é aceito e avisa da diferença', async ({ page }) => {
    await irParaTelaCaixa(page);

    await page.getByPlaceholder('0,00').fill('100,00');
    await page.getByRole('button', { name: 'Abrir caixa' }).click();
    await expect(page.getByPlaceholder(/Bipe o código de barras/)).toBeVisible();

    await page.getByRole('button', { name: 'Caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();

    // Conta a menos do que deveria: divergência de R$ 5,00.
    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    await page.locator('label', { hasText: 'Valor contado' }).locator('input').fill('95,00');
    await page.getByRole('button', { name: 'Confirmar fechamento' }).click();

    // O fechamento NÃO é bloqueado pela divergência — só avisa.
    await expect(page.getByText(/Divergência de R\$ 5,00 \(falta\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Ok' }).click();
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
  });
});
