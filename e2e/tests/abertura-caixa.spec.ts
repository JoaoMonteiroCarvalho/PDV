/**
 * Abertura de caixa.
 *
 * Cobre os três estados da tela e, principalmente, a navegação: abrir leva à
 * venda, mas o resumo do caixa continua alcançável pelo menu. Na versão
 * anterior do app essa tela de resumo era inatingível — ela se auto-
 * substituía no instante em que detectava a sessão aberta.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, garantirTerminalFechado, loginOperador, terminalIdSemeado } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

async function configurar(page: import('@playwright/test').Page) {
  await page.evaluate((t) => localStorage.setItem('pdv.terminalId', t), terminalIdSemeado());
}

test.describe('configuração do terminal', () => {
  test('computador novo pede o identificador antes de qualquer coisa', async ({ page }) => {
    await loginOperador(page);
    await expect(page.getByRole('heading', { name: 'Configurar terminal' })).toBeVisible();
    await expect(page.getByText(/uma única vez/i)).toBeVisible();
  });

  test('salvar o terminal leva à abertura de caixa', async ({ page }) => {
    await loginOperador(page);
    await page.getByLabel('Identificador do terminal').fill(terminalIdSemeado());
    await page.getByRole('button', { name: 'Salvar terminal' }).click();

    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
  });
});

test.describe('abertura', () => {
  test('digitação em centavos mostra o valor formatado na hora', async ({ page }) => {
    await loginOperador(page);
    await configurar(page);
    await page.reload();

    const campo = page.getByLabel('Fundo de troco');
    await campo.type('20000');
    // Padrão de maquininha: dígitos entram pela direita.
    await expect(campo).toHaveValue('200,00');
  });

  test('avisa quando o fundo está zerado, mas não impede abrir', async ({ page }) => {
    await loginOperador(page);
    await configurar(page);
    await page.reload();

    // Loja que guarda o troco no cofre pode abrir com gaveta vazia.
    await expect(page.getByText(/fundo está zerado/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Abrir caixa/ })).toBeEnabled();
  });

  test('abrir o caixa leva direto para a venda', async ({ page }) => {
    await loginOperador(page);
    await configurar(page);
    await page.reload();

    await page.getByLabel('Fundo de troco').type('20000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();

    // Quem abre o caixa quer vender em seguida.
    await expect(page).toHaveURL(/\/venda/);
  });

  test('com o caixa aberto, a barra de estado passa a dizer isso', async ({ page }) => {
    await loginOperador(page);
    await configurar(page);
    await page.reload();
    await page.getByLabel('Fundo de troco').type('15000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();
    await expect(page).toHaveURL(/\/venda/);

    await expect(page.getByText('Caixa aberto')).toBeVisible();
  });
});

test.describe('resumo do caixa aberto', () => {
  test('é alcançável pelo menu e mostra o fundo, mas NÃO o saldo esperado', async ({ page }) => {
    await loginOperador(page);
    await configurar(page);
    await page.reload();
    await page.getByLabel('Fundo de troco').type('20000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();
    await expect(page).toHaveURL(/\/venda/);

    // O bug da versão antiga: esta tela nunca aparecia.
    await page.getByRole('link', { name: 'Caixa' }).click();

    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();
    await expect(page.getByText('Fundo de troco')).toBeVisible();
    await expect(page.getByText('R$ 200,00').first()).toBeVisible();

    /*
     * O saldo esperado NÃO pode aparecer aqui. O fechamento é conferência às
     * cegas; com o esperado a um clique do botão de fechar, bastaria ler o
     * número nesta tela e digitá-lo lá, e o controle inteiro se desfaz.
     */
    await expect(page.getByText('Saldo esperado')).toHaveCount(0);
  });

  test('oferece caminho de volta para a venda sem perder a sessão', async ({ page }) => {
    await loginOperador(page);
    await configurar(page);
    await page.reload();
    await page.getByLabel('Fundo de troco').type('20000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();
    // Espera a navegação da abertura terminar antes de navegar de novo —
    // sem isto, o clique seguinte corre contra o `navigate` do handler.
    await expect(page).toHaveURL(/\/venda/);

    await page.getByRole('link', { name: 'Caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();

    await page.getByRole('button', { name: 'Voltar para a venda' }).click();
    await expect(page).toHaveURL(/\/venda/);
  });

  test('recusa abrir um segundo caixa no mesmo terminal', async ({ page, request }) => {
    await loginOperador(page);
    await configurar(page);
    await page.reload();
    await page.getByLabel('Fundo de troco').type('10000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();
    await expect(page).toHaveURL(/\/venda/);

    // Confirma pela API: o servidor é quem impede, não só a interface.
    const login = await request.post('http://localhost:3334/sessao/login', {
      data: { login: DADOS_E2E.operador.login, senha: DADOS_E2E.operador.senha },
    });
    const { token } = (await login.json()) as { token: string };
    const segunda = await request.post('http://localhost:3334/sessoes-caixa', {
      headers: { Authorization: `Bearer ${token}` },
      data: { terminalId: terminalIdSemeado(), fundoTrocoCentavos: 5000 },
    });
    expect(segunda.status()).toBe(409);
  });
});
