/**
 * Catálogo visual e consulta de produto.
 *
 * O que estes testes protegem:
 *
 *   1. A consulta responde "vem em vinho? no GG? qual o código?" sem a
 *      operadora ter que abrir o sistema do escritório.
 *   2. A prévia 3D NUNCA atrapalha. Ela entra depois; os dados e a grade
 *      aparecem primeiro, e sem WebGL a tela continua inteira.
 *   3. A prévia não se passa por foto do produto — ela indica a cor.
 */

import { expect, test } from '@playwright/test';
import {
  DADOS_E2E,
  esperarCatalogoSincronizado,
  garantirTerminalFechado,
  irParaVenda,
  loginOperador,
} from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

const NOME_GRADE = DADOS_E2E.produtoComGrade.nome;

/** Abre a consulta pelo caminho real: catálogo, card, produto. */
async function abrirPeloCatalogo(page: import('@playwright/test').Page, nome: string) {
  await page.getByRole('link', { name: 'Catálogo' }).click();
  await expect(page).toHaveURL(/\/catalogo/);
  await page.getByRole('link').filter({ hasText: nome }).first().click();
  await expect(page).toHaveURL(/\/produto\//);
}

test.describe('catálogo visual', () => {
  test('lista as peças que este caixa tem baixadas', async ({ page }) => {
    await irParaVenda(page);
    await page.getByRole('link', { name: 'Catálogo' }).click();

    await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();
    await expect(page.getByRole('link').filter({ hasText: NOME_GRADE })).toBeVisible();
    await expect(
      page.getByRole('link').filter({ hasText: DADOS_E2E.produtoSemVariacao.nome }),
    ).toBeVisible();
  });

  test('cada card tem prévia 3D, servida por UM canvas só', async ({ page }) => {
    /*
     * A invariante que este teste protege: por mais cards que a grade tenha,
     * existe UM canvas. Um `<Canvas>` por card criaria um contexto WebGL por
     * card, e o navegador descarta os mais antigos em silêncio a partir de 8 a
     * 16 — os primeiros cards virariam retângulos pretos sem erro no console.
     */
    await irParaVenda(page);
    await page.getByRole('link', { name: 'Catálogo' }).click();
    await expect(page.getByRole('heading', { name: 'Catálogo' })).toBeVisible();

    const cards = page.getByRole('link').filter({ has: page.locator('[data-produto]') });
    expect(await cards.count()).toBeGreaterThan(1);

    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 20_000 });
  });

  test('a prévia de cada card é descrita para leitor de tela', async ({ page }) => {
    await irParaVenda(page);
    await page.getByRole('link', { name: 'Catálogo' }).click();

    // O canvas é um retângulo pintado por cima; sem rótulo no slot, a peça
    // sumiria para quem não enxerga.
    await expect(
      page.getByRole('img', { name: /Prévia abstrata de Conjunto Grade E2E/ }),
    ).toBeVisible();
  });

  test('a lista e os preços aparecem antes de qualquer coisa 3D', async ({ page }) => {
    await irParaVenda(page);
    await page.getByRole('link', { name: 'Catálogo' }).click();

    // Sem esperar canvas nenhum: o three.js entra por chunk separado.
    await expect(page.getByRole('link').filter({ hasText: NOME_GRADE })).toBeVisible();
  });

  test('sem WebGL, a grade cai no palco estático em cada card', async ({ browser }) => {
    const contexto = await browser.newContext();
    await contexto.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = function () {
        return null;
      } as never;
    });
    const pagina = await contexto.newPage();

    await loginOperador(pagina);
    await esperarCatalogoSincronizado(pagina, 4);
    await pagina.getByRole('link', { name: 'Catálogo' }).click();

    await expect(pagina.locator('canvas')).toHaveCount(0);
    await expect(
      pagina.getByRole('img', { name: /Prévia abstrata de Conjunto Grade E2E/ }),
    ).toBeVisible();
    await contexto.close();
  });

  test('busca filtra a lista', async ({ page }) => {
    await irParaVenda(page);
    await page.getByRole('link', { name: 'Catálogo' }).click();
    await page.getByLabel('Buscar').fill('perfume');

    await expect(
      page.getByRole('link').filter({ hasText: DADOS_E2E.produtoSemVariacao.nome }),
    ).toBeVisible();
    await expect(page.getByRole('link').filter({ hasText: NOME_GRADE })).toHaveCount(0);
  });
});

test.describe('consulta de produto', () => {
  test('mostra a grade e o código de cada combinação', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    await expect(page.getByRole('heading', { name: NOME_GRADE })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cor Preto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cor Vinho' })).toBeVisible();
    // É daqui que sai o código para o pedido de reposição.
    await expect(page.getByText(/E2E-GRADE-/)).toBeVisible();
  });

  test('trocar de combinação troca o SKU e o saldo na ficha', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    await page.getByRole('button', { name: 'Cor Vinho' }).click();
    await page.getByRole('button', { name: /Tamanho P/ }).click();

    await expect(page.getByText('E2E-GRADE-P-VINHO')).toBeVisible();
    await expect(page.getByText('3 em estoque')).toBeVisible();
  });

  test('diz que a loja não vende a combinação, em vez de mostrar zero', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    // Vinho/GG nunca foi cadastrado — diferente de ter acabado.
    await page.getByRole('button', { name: 'Cor Vinho' }).click();
    await page.getByRole('button', { name: /Tamanho GG/ }).click();

    await expect(page.getByText(/não vende esta combinação/)).toBeVisible();
  });

  test('esgotado aparece como sem saldo, e continua consultável', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    await page.getByRole('button', { name: 'Cor Preto' }).click();
    await page.getByRole('button', { name: /Tamanho GG/ }).click();

    await expect(page.getByText('Sem saldo registrado')).toBeVisible();
    await expect(page.getByText('E2E-GRADE-GG-PRETO')).toBeVisible();
  });

  test('lança a combinação escolhida na venda', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    await page.getByRole('button', { name: 'Cor Vinho' }).click();
    await page.getByRole('button', { name: /Tamanho P/ }).click();
    await page.getByRole('button', { name: 'Adicionar à venda' }).click();

    await expect(page).toHaveURL(/\/venda/);
    const carrinho = page.getByRole('complementary');
    await expect(carrinho.getByText(NOME_GRADE)).toBeVisible();
    await expect(carrinho.getByText(/Vinho · P/)).toBeVisible();
  });

  test('a tela de venda oferece o caminho para a ficha completa', async ({ page }) => {
    await irParaVenda(page);
    await page.getByLabel(/Buscar produto/).fill('Conjunto Grade');
    await page.getByRole('link', { name: 'detalhes' }).click();

    await expect(page).toHaveURL(/\/produto\//);
    await expect(page.getByRole('heading', { name: NOME_GRADE })).toBeVisible();
  });
});

test.describe('prévia 3D', () => {
  test('a cena carrega quando a máquina tem WebGL', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
  });

  test('os dados aparecem antes da cena, sem esperar o 3D', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    // Sem aguardar o canvas: o Three.js entra por chunk separado e pode
    // demorar. Consultar preço e código não pode depender disso.
    await expect(page.getByRole('button', { name: 'Cor Preto' })).toBeVisible();
    await expect(page.getByText(/E2E-GRADE-/)).toBeVisible();
  });

  test('a cena é destruída ao sair da tela, liberando a GPU', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('link', { name: 'Venda' }).click();
    await expect(page).toHaveURL(/\/venda/);

    // Um contexto WebGL vivo em segundo plano consumiria GPU o dia inteiro.
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('a prévia avisa que não é foto do produto', async ({ page }) => {
    await irParaVenda(page);
    await abrirPeloCatalogo(page, NOME_GRADE);

    await expect(page.getByText(/Não é foto do produto/)).toBeVisible();
  });

  test('com os efeitos desligados, cai no palco estático e não em erro', async ({ page }) => {
    await irParaVenda(page);
    await page.evaluate(() => localStorage.setItem('pdv.efeitos3d', 'off'));
    await abrirPeloCatalogo(page, NOME_GRADE);

    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByRole('img', { name: /Prévia abstrata/ })).toBeVisible();
    // E o que importa continua no lugar.
    await expect(page.getByText(/E2E-GRADE-/)).toBeVisible();
  });

  test('sem WebGL, a consulta continua inteira', async ({ browser }) => {
    // Mini-PC com driver antigo ou WebGL bloqueado por política.
    const contexto = await browser.newContext();
    await contexto.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = function () {
        return null;
      } as never;
    });
    const pagina = await contexto.newPage();

    await loginOperador(pagina);
    // Sem passar pela venda, o catálogo ainda está descendo quando a tela abre.
    await esperarCatalogoSincronizado(pagina, 4);
    await abrirPeloCatalogo(pagina, NOME_GRADE);

    await expect(pagina.getByRole('heading', { name: NOME_GRADE })).toBeVisible();
    await expect(pagina.getByRole('img', { name: /Prévia abstrata/ })).toBeVisible();
    await contexto.close();
  });
});

test.describe('consulta sem caixa aberto', () => {
  test('consultar funciona, lançar não — e a tela diz por quê', async ({ page }) => {
    // Consultar produto é o que a operadora mais faz, inclusive antes de abrir
    // o caixa. Bloquear a consulta seria bloquear o trabalho da loja.
    await loginOperador(page);
    await esperarCatalogoSincronizado(page, 4);
    await abrirPeloCatalogo(page, NOME_GRADE);

    await expect(page.getByRole('heading', { name: NOME_GRADE })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar à venda' })).toBeDisabled();
    await expect(page.getByText(/Consultar funciona sempre/)).toBeVisible();
  });
});
