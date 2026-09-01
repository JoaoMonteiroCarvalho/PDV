/**
 * Relatórios de venda.
 *
 * O que estes testes protegem:
 *
 *   1. Uma venda feita agora aparece no relatório de hoje — o caminho inteiro,
 *      do clique no caixa até o número na tela.
 *   2. O gráfico não é 3D, e os mesmos números existem em texto para quem usa
 *      leitor de tela.
 *   3. O CSV sai no formato que o Excel em português abre: `;` como separador
 *      e vírgula decimal.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, garantirTerminalFechado, irParaVenda, loginOperador } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

type Pagina = import('@playwright/test').Page;

async function irParaRelatorios(page: Pagina) {
  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  await page.getByRole('button', { name: 'Hoje' }).click();
}

/** Vende o perfume (R$ 120) à vista em dinheiro. */
async function venderPerfume(page: Pagina) {
  await irParaVenda(page);
  await page.getByLabel(/Buscar produto/).fill('Perfume');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
  await modal.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page).toHaveURL(/\/venda\/concluida/);
}

test.describe('números do período', () => {
  test('a venda feita agora aparece no relatório de hoje', async ({ page }) => {
    await venderPerfume(page);
    await irParaRelatorios(page);

    // Outros testes podem ter vendido hoje também: o que importa é que este
    // valor entrou, não que o total seja exatamente ele.
    await expect(page.getByTestId('qtd-vendas')).not.toHaveText('0');
    await expect(page.getByTestId('faturamento')).not.toHaveText('R$ 0,00');
    await expect(page.getByTestId('ticket-medio')).toBeVisible();
  });

  test('mostra como as clientes pagaram', async ({ page }) => {
    await venderPerfume(page);
    await irParaRelatorios(page);

    await expect(page.getByRole('heading', { name: 'Como pagaram' })).toBeVisible();
    await expect(page.getByText('Dinheiro')).toBeVisible();
  });

  test('lista o que mais saiu, com SKU', async ({ page }) => {
    await venderPerfume(page);
    await irParaRelatorios(page);

    await expect(page.getByText(DADOS_E2E.produtoSemVariacao.sku)).toBeVisible();
  });

  test('período sem venda diz isso, em vez de tela vazia', async ({ page }) => {
    await loginOperador(page);
    await page.getByRole('link', { name: 'Relatórios' }).click();

    // Um período no passado onde o seed não criou nada.
    await page.getByLabel('De').fill('2020-01-01');
    await page.getByLabel('Até').fill('2020-01-02');

    await expect(page.getByText('Sem movimento no período.')).toBeVisible();
    await expect(page.getByTestId('faturamento')).toHaveText('R$ 0,00');
  });
});

test.describe('gráfico', () => {
  test('é SVG, nunca 3D', async ({ page }) => {
    /*
     * Barra em perspectiva é o exemplo clássico de gráfico que engana: a face
     * frontal fica mais baixa que o topo real. Num relatório de faturamento
     * isso não é enfeite ruim, é número errado.
     */
    await venderPerfume(page);
    await irParaRelatorios(page);

    await expect(page.locator('main svg')).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('os mesmos números existem em texto, para leitor de tela', async ({ page }) => {
    await venderPerfume(page);
    await irParaRelatorios(page);

    // O SVG é aria-hidden; a tabela oculta é o conteúdo de verdade.
    await expect(page.getByRole('table', { name: 'Faturamento por dia' })).toBeAttached();
  });
});

test.describe('exportação CSV', () => {
  test('baixa no formato que o Excel em português abre', async ({ page }) => {
    await venderPerfume(page);
    await irParaRelatorios(page);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).first().click();
    const arquivo = await download;

    expect(arquivo.suggestedFilename()).toMatch(/^vendas-por-dia-.*\.csv$/);

    const fluxo = await arquivo.createReadStream();
    const partes: Buffer[] = [];
    for await (const parte of fluxo) partes.push(parte as Buffer);
    const conteudo = Buffer.concat(partes).toString('utf-8');

    // BOM: sem ele o Excel lê como Latin-1 e estraga todo acento.
    expect(conteudo.charCodeAt(0)).toBe(0xfeff);
    // Ponto e vírgula: com vírgula o Excel pt-BR abre tudo numa coluna só.
    expect(conteudo).toContain('Dia;Vendas;Faturamento');
    // Vírgula decimal: com ponto, a soma da coluna dá zero.
    expect(conteudo).toMatch(/;\d+,\d{2}/);
  });

  test('não deixa exportar período sem venda', async ({ page }) => {
    // Um CSV só com cabeçalho parece download quebrado para quem clicou.
    await loginOperador(page);
    await page.getByRole('link', { name: 'Relatórios' }).click();
    await page.getByLabel('De').fill('2020-01-01');
    await page.getByLabel('Até').fill('2020-01-02');

    await expect(page.getByRole('button', { name: 'Exportar CSV' }).first()).toBeDisabled();
  });
});
