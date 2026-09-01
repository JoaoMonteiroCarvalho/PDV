/**
 * Fluxo completo do caixa: login → configurar terminal → abrir caixa →
 * vender → sangria com autorização de gerente → fechar caixa.
 *
 * Este é o teste mais importante do E2E: prova que as peças construídas em
 * fases separadas (autenticação, sessão de caixa, carrinho, fila de
 * sincronização, comprovante, conferência às cegas) realmente se encaixam
 * quando um humano clica na tela, não só quando cada módulo é testado
 * isoladamente.
 *
 * Reativado na Fase 7. Ficou pendente desde a Fase 0 porque exercitava a UI
 * antiga; voltou quando a última tela que ele percorre — sangria — passou a
 * existir. As telas mudaram, as regras de negócio que ele prova não.
 *
 * COMPORTAMENTO REAL DO APP: ao clicar "Abrir caixa", o roteador vai
 * IMEDIATAMENTE para a tela de venda — "Caixa aberto" não fica visível nesse
 * instante. Ela só aparece ao voltar pelo menu.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, irParaTelaCaixa } from '../fixtures.js';

test.describe('fluxo completo de venda', () => {
  test.beforeEach(async () => {
    await garantirTerminalFechado();
  });

  test('login, abertura de caixa, venda, sangria e fechamento', async ({ page }) => {
    // --- Login e configuração inicial --------------------------------------
    await irParaTelaCaixa(page);

    // --- Abertura de caixa: abrir leva direto para a tela de venda ---------
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
    await page.getByLabel('Fundo de troco').fill('');
    await page.getByLabel('Fundo de troco').type('20000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();

    await expect(page).toHaveURL(/\/venda/);
    await esperarCatalogoSincronizado(page, 4);

    // --- Venda: camiseta de R$ 50, paga com R$ 100 em dinheiro -------------
    await page.getByLabel(/Buscar produto/).fill('camiseta');
    await page.getByRole('button', { name: /Adicionar Azul M,/ }).click();
    await expect(page.getByTestId('total-venda')).toHaveText('R$ 50,00');

    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Valor recebido').type('10000');
    await expect(modal.getByText('Troco a devolver')).toBeVisible();
    await expect(page.getByTestId('troco')).toHaveText('R$ 50,00');
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();

    // --- Comprovante em tela ----------------------------------------------
    await expect(page).toHaveURL(/\/venda\/concluida/);
    const comprovante = page.getByLabel('Comprovante da venda');
    await expect(comprovante).toContainText('NAO E DOCUMENTO FISCAL');
    await expect(comprovante).toContainText('TROCO');
    // Vestuário sai como "Vestuario" no papel: o nome do produto fica de fora.
    await expect(comprovante).not.toContainText(DADOS_E2E.produto.nome);

    await page.getByRole('button', { name: 'Nova venda' }).click();
    await expect(page.getByText('Nenhuma peça lançada.')).toBeVisible();

    // --- Sangria: exige gerente, mesmo para valor pequeno ------------------
    await page.getByRole('link', { name: 'Caixa' }).click();
    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();
    await page.getByRole('button', { name: 'Sangria e suprimento' }).click();

    await page.getByLabel('Gerente').fill(DADOS_E2E.gerente.login);
    await page.getByLabel('Senha').fill(DADOS_E2E.gerente.senha);
    await page.getByRole('button', { name: 'Autorizar' }).click();
    await expect(page.getByText('Autorizado')).toBeVisible();

    await page.getByLabel(/Valor retirado/).type('3000');
    await page.getByLabel(/Para onde foi/).fill('Cofre da loja');
    await page.getByRole('button', { name: 'Registrar sangria' }).click();
    await expect(page.getByText('Sangria registrada')).toBeVisible();

    // --- Fechamento sem divergência ----------------------------------------
    // Fundo 200 + venda líquida do troco 50 − sangria 30 = R$ 220 na gaveta.
    await page.getByRole('button', { name: 'Voltar ao caixa' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await page.getByLabel('Quantidade de R$ 100', { exact: true }).fill('2');
    await page.getByLabel('Quantidade de R$ 20', { exact: true }).fill('1');
    await expect(page.getByTestId('total-contado')).toHaveText('R$ 220,00');

    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await expect(page.getByText('Sem divergência')).toBeVisible();
    await expect(page.getByTestId('diferenca')).toHaveText('R$ 0,00');

    // Depois de fechar, o mesmo terminal volta à ABERTURA — a sessão anterior
    // não existe mais para ser reaberta.
    await page.getByRole('button', { name: 'Concluir' }).click();
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
  });

  test('sangria é bloqueada sem gerente válido', async ({ page }) => {
    await irParaTelaCaixa(page);
    await page.getByLabel('Fundo de troco').fill('');
    await page.getByLabel('Fundo de troco').type('10000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();
    await expect(page).toHaveURL(/\/venda/);

    await page.getByRole('link', { name: 'Caixa' }).click();
    await page.getByRole('button', { name: 'Sangria e suprimento' }).click();

    // Credenciais do OPERADOR, não do gerente.
    await page.getByLabel('Gerente').fill(DADOS_E2E.operador.login);
    await page.getByLabel('Senha').fill(DADOS_E2E.operador.senha);
    await page.getByRole('button', { name: 'Autorizar' }).click();

    await expect(page.getByText(/não tem perfil de gerente/i)).toBeVisible();
    // A operação não foi concluída: o formulário continua pedindo autorização.
    await expect(page.getByRole('button', { name: 'Autorizar' })).toBeVisible();
    await expect(page.getByText('Autorizado')).toHaveCount(0);
  });

  test('fechamento com divergência é aceito e avisa da diferença', async ({ page }) => {
    await irParaTelaCaixa(page);
    await page.getByLabel('Fundo de troco').fill('');
    await page.getByLabel('Fundo de troco').type('10000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();
    await expect(page).toHaveURL(/\/venda/);

    await page.getByRole('link', { name: 'Caixa' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    // Conta R$ 95 numa gaveta que deveria ter R$ 100.
    await page.getByLabel('Quantidade de R$ 50', { exact: true }).fill('1');
    await page.getByLabel('Quantidade de R$ 20', { exact: true }).fill('2');
    await page.getByLabel('Quantidade de R$ 5', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    // A divergência NÃO bloqueia o fechamento — a loja precisa encerrar o dia.
    await expect(page.getByText('Faltou')).toBeVisible();
    await expect(page.getByTestId('diferenca')).toHaveText('R$ 5,00');

    await page.getByRole('button', { name: 'Concluir' }).click();
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
  });
});
