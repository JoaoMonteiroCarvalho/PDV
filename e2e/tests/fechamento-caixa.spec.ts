/**
 * Fechamento de caixa — conferência às cegas.
 *
 * O que estes testes protegem:
 *
 *   1. O valor esperado NÃO aparece em lugar nenhum antes de a operadora
 *      dizer quanto contou. Se aparecer, conferir vira copiar e o controle
 *      inteiro deixa de existir.
 *   2. A diferença é revelada depois, com sinal em palavras — "faltou",
 *      "sobrou" — e fica na tela para ser anotada.
 *   3. Venda ainda na fila bloqueia o fechamento: o esperado vem do servidor
 *      e sairia menor que a gaveta.
 */

import { expect, test } from '@playwright/test';
import { garantirTerminalFechado, irParaVenda, irParaTelaCaixa } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

type Pagina = import('@playwright/test').Page;

/** Abre o caixa com R$ 200 de fundo e vai para a tela de fechamento. */
async function irParaFechamento(page: Pagina) {
  await irParaTelaCaixa(page);
  await page.getByLabel('Fundo de troco').fill('');
  await page.getByLabel('Fundo de troco').type('20000');
  await page.getByRole('button', { name: /Abrir caixa/ }).click();
  await expect(page).toHaveURL(/\/venda/);

  await page.getByRole('link', { name: 'Caixa' }).click();
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  await expect(page).toHaveURL(/\/caixa\/fechar/);
}

/**
 * Conta `quantidade` cédulas de `rotulo` na grade.
 *
 * `exact` é obrigatório: o `getByLabel` do Playwright casa por SUBSTRING, e
 * "Quantidade de R$ 10" também encontraria a linha de R$ 100. Os rótulos em si
 * são distintos — quem usa leitor de tela ouve os dois sem ambiguidade.
 */
async function contar(page: Pagina, rotulo: string, quantidade: number) {
  await page.getByLabel(`Quantidade de ${rotulo}`, { exact: true }).fill(String(quantidade));
}

test.describe('conferência às cegas', () => {
  test('o esperado não aparece antes de a operadora contar', async ({ page }) => {
    await irParaFechamento(page);

    // R$ 200,00 é o fundo, e o esperado de um caixa sem venda. Nem o rótulo
    // nem o valor podem estar na tela antes da contagem.
    await expect(page.getByText('Esperado pelo sistema')).toHaveCount(0);
    await expect(page.getByText(/só mostra o esperado depois que você confirmar/i)).toBeVisible();
  });

  test('o resumo do caixa aberto também não entrega o esperado', async ({ page }) => {
    // Estava a um clique do botão de fechar — bastava ler ali e digitar aqui.
    await irParaTelaCaixa(page);
    await page.getByLabel('Fundo de troco').fill('');
    await page.getByLabel('Fundo de troco').type('20000');
    await page.getByRole('button', { name: /Abrir caixa/ }).click();
    await expect(page).toHaveURL(/\/venda/);
    await page.getByRole('link', { name: 'Caixa' }).click();

    await expect(page.getByRole('heading', { name: 'Caixa aberto' })).toBeVisible();
    await expect(page.getByText('Saldo esperado')).toHaveCount(0);
  });

  test('a contagem por cédula soma ao vivo', async ({ page }) => {
    await irParaFechamento(page);

    await contar(page, 'R$ 50', 3);
    await contar(page, 'R$ 10', 2);
    await contar(page, '25 centavos', 4);

    // 150 + 20 + 1 = R$ 171,00
    await expect(page.getByTestId('total-contado')).toHaveText('R$ 171,00');
  });

  test('dá para digitar o total direto, para quem já contou', async ({ page }) => {
    await irParaFechamento(page);

    await page.getByRole('button', { name: 'Total direto' }).click();
    await page.getByLabel('Total contado na gaveta').type('20000');

    await expect(page.getByTestId('total-contado')).toHaveText('R$ 200,00');
  });

  test('não deixa fechar sem contagem nenhuma', async ({ page }) => {
    await irParaFechamento(page);
    await expect(page.getByRole('button', { name: 'Conferir e fechar' })).toBeDisabled();
  });

  test('a confirmação avisa que a sessão não reabre', async ({ page }) => {
    await irParaFechamento(page);
    await contar(page, 'R$ 50', 4);
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toContainText(/não pode ser reaberta/i);
    await expect(modal).toContainText('R$ 200,00');
  });
});

test.describe('resultado da conferência', () => {
  test('caixa que bate certo fecha sem divergência', async ({ page }) => {
    await irParaFechamento(page);
    // Fundo de R$ 200, nenhuma venda: o esperado é exatamente R$ 200.
    await contar(page, 'R$ 50', 4);
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await expect(page.getByText('Sem divergência')).toBeVisible();
    await expect(page.getByText('Esperado pelo sistema')).toBeVisible();
    await expect(page.getByTestId('diferenca')).toHaveText('R$ 0,00');
  });

  test('falta aparece como "Faltou", com valor positivo', async ({ page }) => {
    await irParaFechamento(page);
    // Contou R$ 190 numa gaveta que deveria ter R$ 200.
    await contar(page, 'R$ 50', 3);
    await contar(page, 'R$ 20', 2);
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await expect(page.getByText('Faltou')).toBeVisible();
    await expect(page.getByTestId('diferenca')).toHaveText('R$ 10,00');
    await expect(page.getByText(/Anote o que puder ter causado/)).toBeVisible();
  });

  test('sobra aparece como "Sobrou"', async ({ page }) => {
    await irParaFechamento(page);
    await contar(page, 'R$ 50', 4);
    await contar(page, 'R$ 5', 1);
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await expect(page.getByText('Sobrou')).toBeVisible();
    await expect(page.getByTestId('diferenca')).toHaveText('R$ 5,00');
  });

  test('a venda em dinheiro entra no esperado', async ({ page }) => {
    // Fundo R$ 200 + perfume R$ 120 pago em dinheiro = esperado R$ 320.
    await irParaVenda(page, '20000');
    await page.getByLabel(/Buscar produto/).fill('Perfume');
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page).toHaveURL(/\/venda\/concluida/);

    await page.getByRole('link', { name: 'Caixa' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await contar(page, 'R$ 100', 3);
    await contar(page, 'R$ 20', 1);
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();

    await expect(page.getByText('Sem divergência')).toBeVisible();
    await expect(page.getByTestId('diferenca')).toHaveText('R$ 0,00');
  });

  test('depois de fechar, não dá para vender neste terminal', async ({ page }) => {
    await irParaFechamento(page);
    await contar(page, 'R$ 50', 4);
    await page.getByRole('button', { name: 'Conferir e fechar' }).click();
    await page.getByRole('button', { name: 'Fechar caixa' }).click();
    await expect(page.getByText('Sem divergência')).toBeVisible();

    await page.getByRole('button', { name: 'Concluir' }).click();
    await page.goto('/venda');

    // O guard manda de volta: sem caixa aberto não existe onde lançar venda.
    await expect(page).toHaveURL(/\/caixa/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
  });
});

test.describe('sem caixa aberto', () => {
  test('a tela explica em vez de mostrar formulário vazio', async ({ page }) => {
    await irParaTelaCaixa(page);
    await page.goto('/caixa/fechar');

    await expect(page.getByText('Não há caixa aberto')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Conferir e fechar' })).toHaveCount(0);
  });
});
