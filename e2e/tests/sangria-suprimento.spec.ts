/**
 * Sangria e suprimento.
 *
 * O que estes testes protegem:
 *
 *   1. Nada é registrado sem gerente identificada — nem valor pequeno. É o
 *      ponto clássico de fraude interna, e uma exceção por valor seria a
 *      brecha.
 *   2. A operadora continua logada depois da autorização: a gerente prova
 *      identidade, não assume o terminal.
 *   3. O saldo da gaveta só aparece para a gerente — contrapartida da
 *      conferência às cegas do fechamento.
 *   4. O movimento entra no saldo esperado, e o fechamento prova isso.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, garantirTerminalFechado, irParaTelaCaixa } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

type Pagina = import('@playwright/test').Page;

/** Abre o caixa com R$ 500 de fundo e vai para a tela de movimentos. */
async function irParaMovimento(page: Pagina, fundo = '50000') {
  await irParaTelaCaixa(page);
  await page.getByLabel('Fundo de troco').fill('');
  await page.getByLabel('Fundo de troco').type(fundo);
  await page.getByRole('button', { name: /Abrir caixa/ }).click();
  await expect(page).toHaveURL(/\/venda/);

  await page.getByRole('link', { name: 'Caixa' }).click();
  await page.getByRole('button', { name: 'Sangria e suprimento' }).click();
  await expect(page).toHaveURL(/\/caixa\/movimento/);
}

async function autorizar(page: Pagina, login: string, senha: string) {
  await page.getByLabel('Gerente').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Autorizar' }).click();
}

async function digitarValor(page: Pagina, digitos: string) {
  await page.getByLabel(/Valor (retirado|colocado)/).type(digitos);
}

test.describe('autorização', () => {
  test('sem gerente, o registro fica travado — nem valor pequeno', async ({ page }) => {
    await irParaMovimento(page);
    await digitarValor(page, '100');
    await page.getByLabel(/Para onde foi/).fill('Cofre da loja');

    await expect(page.getByRole('button', { name: 'Registrar sangria' })).toBeDisabled();
    await expect(page.getByText(/exigem gerente identificada, sem exceção de valor/)).toBeVisible();
  });

  test('operadora com senha certa não autoriza, e a tela diz por quê', async ({ page }) => {
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.operador.login, DADOS_E2E.operador.senha);

    await expect(page.getByRole('alert')).toContainText(/não tem perfil de gerente/);
    await expect(page.getByText('Autorizado')).toHaveCount(0);
  });

  test('senha errada da gerente não autoriza', async ({ page }) => {
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, 'senha-errada');

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('Autorizado')).toHaveCount(0);
  });

  test('a operadora continua logada depois de a gerente autorizar', async ({ page }) => {
    // Trocar o token aqui deslogaria a operadora no meio do expediente.
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);

    await expect(page.getByText('Autorizado')).toBeVisible();
    await expect(page.getByRole('banner')).toContainText(DADOS_E2E.operador.nome);
    await expect(page.getByRole('banner')).not.toContainText(DADOS_E2E.gerente.nome);
  });
});

test.describe('o saldo só aparece para a gerente', () => {
  test('a operadora sozinha não vê o dinheiro da gaveta', async ({ page }) => {
    await irParaMovimento(page);
    await expect(page.getByTestId('efeito-no-caixa')).toHaveCount(0);
    await expect(page.getByText('R$ 500,00')).toHaveCount(0);
  });

  test('depois da autorização, mostra o que sai e o que fica', async ({ page }) => {
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);
    await expect(page.getByText('Autorizado')).toBeVisible();

    await digitarValor(page, '15000');

    const efeito = page.getByTestId('efeito-no-caixa');
    await expect(efeito).toContainText('R$ 500,00');
    await expect(efeito).toContainText('R$ 150,00');
    await expect(efeito).toContainText('R$ 350,00');
  });
});

test.describe('regras do movimento', () => {
  test('sangria sem justificativa não passa', async ({ page }) => {
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);
    await expect(page.getByText('Autorizado')).toBeVisible();
    await digitarValor(page, '10000');

    await expect(page.getByText(/para onde o dinheiro foi/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar sangria' })).toBeDisabled();
  });

  test('suprimento não exige justificativa', async ({ page }) => {
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);
    await expect(page.getByText('Autorizado')).toBeVisible();

    await page.getByRole('button', { name: /Suprimento/ }).click();
    await digitarValor(page, '10000');

    await expect(page.getByRole('button', { name: 'Registrar suprimento' })).toBeEnabled();
  });

  test('não deixa tirar mais do que a gaveta tem', async ({ page }) => {
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);
    await expect(page.getByText('Autorizado')).toBeVisible();

    await digitarValor(page, '60000'); // R$ 600 numa gaveta de R$ 500
    await page.getByLabel(/Para onde foi/).fill('Cofre da loja');

    await expect(page.getByText(/maior do que o dinheiro que a gaveta tem/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar sangria' })).toBeDisabled();
  });
});

test.describe('efeito no fechamento', () => {
  test('a sangria sai do saldo esperado, e o fechamento prova', async ({ page }) => {
    // Fundo R$ 500 − sangria R$ 150 = esperado R$ 350 na gaveta.
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);
    await expect(page.getByText('Autorizado')).toBeVisible();

    await digitarValor(page, '15000');
    await page.getByLabel(/Para onde foi/).fill('Cofre da loja');
    await page.getByRole('button', { name: 'Registrar sangria' }).click();
    await expect(page.getByText('Sangria registrada')).toBeVisible();

    await page.getByRole('button', { name: 'Voltar ao caixa' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await page.getByLabel('Quantidade de R$ 50', { exact: true }).fill('7');
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await expect(page.getByText('Sem divergência')).toBeVisible();
    await expect(page.getByTestId('diferenca')).toHaveText('R$ 0,00');
  });

  test('o suprimento entra no saldo esperado', async ({ page }) => {
    // Fundo R$ 500 + suprimento R$ 100 = esperado R$ 600.
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);
    await expect(page.getByText('Autorizado')).toBeVisible();

    await page.getByRole('button', { name: /Suprimento/ }).click();
    await digitarValor(page, '10000');
    await page.getByRole('button', { name: 'Registrar suprimento' }).click();
    await expect(page.getByText('Suprimento registrada')).toBeVisible();

    await page.getByRole('button', { name: 'Voltar ao caixa' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await page.getByLabel('Quantidade de R$ 100', { exact: true }).fill('6');
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await expect(page.getByText('Sem divergência')).toBeVisible();
  });

  test('dá para fazer dois movimentos sem pedir a senha de novo', async ({ page }) => {
    // A gerente costuma fazer dois seguidos; repedir a senha só atrasa.
    await irParaMovimento(page);
    await autorizar(page, DADOS_E2E.gerente.login, DADOS_E2E.gerente.senha);
    await expect(page.getByText('Autorizado')).toBeVisible();

    await digitarValor(page, '10000');
    await page.getByLabel(/Para onde foi/).fill('Cofre da loja');
    await page.getByRole('button', { name: 'Registrar sangria' }).click();
    await expect(page.getByText('Sangria registrada')).toBeVisible();

    await page.getByRole('button', { name: 'Outro movimento' }).click();

    await expect(page.getByText('Autorizado')).toBeVisible();
    await expect(page.getByLabel('Gerente')).toHaveCount(0);
  });
});

test.describe('sem caixa aberto', () => {
  test('a tela explica em vez de mostrar formulário vazio', async ({ page }) => {
    await irParaTelaCaixa(page);
    await page.goto('/caixa/movimento');

    await expect(page.getByText('Não há caixa aberto')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Registrar sangria' })).toHaveCount(0);
  });
});
