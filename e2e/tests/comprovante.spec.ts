/**
 * Venda concluída: confirmação, comprovante e política de troca.
 *
 * O que estes testes protegem:
 *
 *   1. A operadora sabe, sem dúvida, que a venda foi registrada — é isso que
 *      a solta para atender a próxima cliente.
 *   2. O comprovante sai DISCRETO. O papel vai para a bolsa, a mesa da
 *      cozinha, a prestação de contas de um casal; o nome do produto é a parte
 *      que expõe a cliente.
 *   3. Com peça íntima, a venda não fecha sem a operadora confirmar que
 *      avisou da política de troca — e a política impressa preserva a troca
 *      por defeito, que a loja não pode recusar.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, garantirTerminalFechado, irParaVenda } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

type Pagina = import('@playwright/test').Page;

/** Lança a peça e abre o modal de finalização, já estando na tela de venda. */
async function abrirFinalizacao(page: Pagina, busca = 'Conjunto Grade') {
  await page.getByLabel(/Buscar produto/).fill(busca);
  await page.getByRole('button', { name: /^Adicionar/ }).first().click();
  await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
  return page.getByRole('dialog');
}

/** Caminho completo do zero: abre o caixa, lança a peça e abre a finalização. */
async function irAteFinalizacao(page: Pagina, busca = 'Conjunto Grade') {
  await irParaVenda(page);
  return abrirFinalizacao(page, busca);
}

/** Fecha a venda inteira em dinheiro, confirmando a política se ela for exigida. */
async function fecharVenda(page: Pagina, modal: ReturnType<Pagina['getByRole']>) {
  await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
  const aviso = modal.getByRole('checkbox');
  if (await aviso.count()) await aviso.check();
  await modal.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page).toHaveURL(/\/venda\/concluida/);
}

test.describe('política de troca por higiene', () => {
  test('peça íntima não fecha sem a operadora confirmar o aviso', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();

    // A conta fechou, mas o botão continua travado.
    await expect(modal.getByText('Pago por completo')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Confirmar venda' })).toBeDisabled();

    await modal.getByRole('checkbox').check();
    await expect(modal.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled();
  });

  test('o aviso preserva a troca por defeito, que a loja não pode recusar', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await expect(modal.getByText(/exceto defeito de fabricação/i)).toBeVisible();
  });

  test('venda sem peça íntima não pede confirmação nenhuma', async ({ page }) => {
    // Pedir em toda venda treinaria a mão a marcar sem ler. Perfume não tem
    // restrição de higiene.
    const modal = await irAteFinalizacao(page, 'Perfume');
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();

    await expect(modal.getByRole('checkbox')).toHaveCount(0);
    await expect(modal.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled();
  });
});

test.describe('tela de venda concluída', () => {
  test('confirma a venda com total e código de rastreio', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await fecharVenda(page, modal);

    await expect(page.getByText('Venda registrada')).toBeVisible();
    await expect(page.getByTestId('total-recebido')).toHaveText('R$ 89,90');
  });

  test('o comprovante sai discreto: sem o nome do produto', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await fecharVenda(page, modal);

    const comprovante = page.getByLabel('Comprovante da venda');
    await expect(comprovante).toBeVisible();
    await expect(comprovante).not.toContainText(DADOS_E2E.produtoComGrade.nome);
    await expect(comprovante).toContainText('Peca intima');
  });

  test('a cliente pode pedir a via com o nome dos produtos', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await fecharVenda(page, modal);

    await page.getByRole('checkbox', { name: /nome dos produtos/ }).check();

    await expect(page.getByLabel('Comprovante da venda')).toContainText(
      DADOS_E2E.produtoComGrade.nome,
    );
  });

  test('a política de troca vai impressa, não só combinada de boca', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await fecharVenda(page, modal);

    const comprovante = page.getByLabel('Comprovante da venda');
    await expect(comprovante).toContainText('POLITICA DE TROCA');
    await expect(comprovante).toContainText('higiene');
    await expect(comprovante).toContainText('defeito de fabricacao');
  });

  test('o comprovante avisa que não é documento fiscal', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await fecharVenda(page, modal);

    await expect(page.getByLabel('Comprovante da venda')).toContainText('NAO E DOCUMENTO FISCAL');
  });

  test('a animação de confirmação carrega e é destruída ao sair', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await fecharVenda(page, modal);

    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Nova venda' }).click();
    await expect(page).toHaveURL(/\/venda$/);
    // Contexto WebGL vivo em segundo plano consumiria GPU o dia inteiro.
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('"Nova venda" devolve o caixa limpo para a próxima cliente', async ({ page }) => {
    const modal = await irAteFinalizacao(page);
    await fecharVenda(page, modal);

    await page.getByRole('button', { name: 'Nova venda' }).click();

    await expect(page.getByText('Nenhuma peça lançada.')).toBeVisible();
    await expect(page.getByTestId('total-venda')).toHaveText('R$ 0,00');
  });

  test('voltar à URL do comprovante sem venda cai na venda, não em tela vazia', async ({ page }) => {
    await irParaVenda(page);
    // Recarregar a página perde o comprovante, que vive em memória.
    await page.goto('/venda/concluida');

    /*
     * Prazo folgado: este é um cold load completo (bundle, sessão, consulta do
     * caixa) antes de a tela sequer decidir redirecionar. O padrão de 5 s do
     * Playwright não cobre isso no servidor de desenvolvimento.
     */
    await expect(page).toHaveURL(/\/venda$/, { timeout: 20_000 });
  });

  test('sem 3D, a confirmação cai no palco estático e o comprovante fica', async ({ page }) => {
    await irParaVenda(page);
    await page.evaluate(() => localStorage.setItem('pdv.efeitos3d', 'off'));

    // Já está na venda: abrir o caixa de novo daria "sessão já aberta".
    const modal = await abrirFinalizacao(page);
    await fecharVenda(page, modal);

    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Embalagem da marca' })).toBeVisible();
    await expect(page.getByLabel('Comprovante da venda')).toBeVisible();
  });
});
