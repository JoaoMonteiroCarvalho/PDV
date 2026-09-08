/**
 * Atalho dos mais vendidos na tela de venda.
 *
 * O que estes testes protegem:
 *
 *   1. O atalho aparece com dado REAL — o que a loja vendeu de verdade, não
 *      uma lista fixa.
 *   2. Clicar nele lança a peça no carrinho, igual ao resultado de busca. Um
 *      atalho que só decora não é atalho.
 *   3. A tela de venda continua funcionando igual quando ele não existe. O
 *      atalho é bônus; vender é o trabalho.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  DADOS_E2E,
  configurarTerminal,
  esperarCatalogoSincronizado,
  garantirTerminalFechado,
  irParaVenda,
  loginOperador,
} from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

/** Vende o perfume à vista e espera a venda CHEGAR ao servidor. */
async function venderPerfume(page: Page) {
  await irParaVenda(page);
  await page.getByLabel(/Buscar produto/).fill('Perfume');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();

  const envio = page.waitForResponse(
    (resposta) => resposta.url().includes('/vendas') && resposta.request().method() === 'POST',
  );

  await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
  await modal.getByRole('button', { name: 'Confirmar venda' }).click();

  /*
   * Espera o POST, não só a tela de conclusão. A venda entra numa fila local
   * e sobe depois; o relatório do servidor só a conhece quando ela chega lá.
   * Sem esta espera o teste seria uma corrida contra a sincronização.
   */
  await envio;
}

/**
 * Faz a tela de venda remontar o estado vazio.
 *
 * Digitar troca o vazio pelo resultado da busca; limpar traz o vazio de volta,
 * montado do zero. É o mesmo caminho que a operadora percorre o dia todo — e é
 * ele que dá ao atalho uma segunda chance quando o catálogo local ainda não
 * tinha chegado na primeira montagem.
 */
async function remontarEstadoVazio(page: Page) {
  const busca = page.getByLabel(/Buscar produto/);
  await busca.fill('perfume');
  await busca.fill('');
}

test('o que a loja vendeu vira atalho na tela de venda', async ({ page, browser }) => {
  await venderPerfume(page);

  /*
   * Contexto novo = IndexedDB vazio = caixa recém-instalado. É o cenário em
   * que o ranking precisa ser buscado do servidor, e o único jeito honesto de
   * testar isso — reaproveitar o contexto anterior leria o cache e não
   * provaria nada.
   */
  const contexto = await browser.newContext();
  const caixaNovo = await contexto.newPage();

  try {
    await loginOperador(caixaNovo);
    await configurarTerminal(caixaNovo);
    await caixaNovo.reload();
    await caixaNovo.goto('/venda');

    // O atalho depende do catálogo local para saber a que produto o SKU
    // vendido pertence.
    await esperarCatalogoSincronizado(caixaNovo, 4);
    await remontarEstadoVazio(caixaNovo);

    await expect(caixaNovo.getByRole('heading', { name: 'Mais vendidos do mês' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      caixaNovo.getByText(DADOS_E2E.produtoSemVariacao.nome, { exact: false }).first(),
    ).toBeVisible();
  } finally {
    await contexto.close();
  }
});

test('clicar no atalho lança a peça no carrinho', async ({ page }) => {
  await venderPerfume(page);

  // Volta para a venda: a de agora terminou e a tela abre limpa.
  await page.getByRole('button', { name: 'Nova venda' }).click();
  await expect(page).toHaveURL(/\/venda$/);
  await esperarCatalogoSincronizado(page, 4);
  await remontarEstadoVazio(page);

  const atalho = page.getByRole('heading', { name: 'Mais vendidos do mês' });
  await expect(atalho).toBeVisible({ timeout: 15_000 });

  /*
   * O perfume não tem grade, então o card traz um botão "Adicionar". Buscar
   * dentro do atalho — e não na tela inteira — porque o resultado de busca
   * usa exatamente o mesmo card, e um seletor solto casaria com os dois.
   */
  const cardDoPerfume = page
    .locator('div')
    .filter({ hasText: DADOS_E2E.produtoSemVariacao.nome })
    .getByRole('button', { name: 'Adicionar', exact: true })
    .first();
  await cardDoPerfume.click();

  const carrinho = page.getByRole('complementary');
  await expect(carrinho.getByText(DADOS_E2E.produtoSemVariacao.nome)).toBeVisible();
  await expect(page.getByTestId('total-venda')).not.toHaveText('R$ 0,00');
});

test('sem atalho, a tela de venda continua a mesma', async ({ browser }) => {
  /*
   * Sem rede não há ranking — e a tela precisa voltar exatamente ao que era
   * antes desta funcionalidade existir: a mensagem, o campo de busca e nada
   * quebrado. O atalho é bônus; vender é o trabalho.
   */
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();

  try {
    await irParaVenda(pagina);
    // Corta só o relatório: o resto do caixa continua online.
    await pagina.route('**/relatorios/vendas**', (rota) => rota.abort());
    await remontarEstadoVazio(pagina);

    await expect(pagina.getByText('Pronto para vender')).toBeVisible();
    await expect(pagina.getByLabel(/Buscar produto/)).toBeEnabled();
  } finally {
    await contexto.close();
  }
});
