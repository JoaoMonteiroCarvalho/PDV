/**
 * Tela de venda: grade de variação e finalização.
 *
 * O que estes testes protegem, em ordem de custo para a loja:
 *
 *   1. A grade responde "tem no GG vinho?" sem abrir outra tela. É a pergunta
 *      mais frequente do balcão.
 *   2. "Esgotado" e "não vendemos" aparecem diferentes. Confundir os dois faz
 *      a operadora prometer reposição de algo que nunca vai chegar.
 *   3. Venda dividida fecha com a conta certa e o troco certo. É dinheiro.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, irParaVenda } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

const NOME_GRADE = DADOS_E2E.produtoComGrade.nome;

async function buscar(page: import('@playwright/test').Page, termo: string) {
  await page.getByLabel(/Buscar produto/).fill(termo);
}

/**
 * Célula da grade SEM o saldo no seletor.
 *
 * O estoque é livro-razão e os testes deste arquivo compartilham um banco: uma
 * venda finalizada num teste derruba o saldo para o próximo. Amarrar o clique
 * ao número ("5 em estoque") faz o teste depender da ordem de execução — foi
 * exatamente assim que este arquivo quebrou na primeira rodada.
 */
function celula(page: import('@playwright/test').Page, cor: string, tamanho: string) {
  return page.getByRole('button', { name: new RegExp(`Adicionar ${cor} ${tamanho},`) });
}

test.describe('grade de variação', () => {
  test('a grade inteira aparece no resultado da busca', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');

    // `heading`-like: o nome do produto aparece também na legenda oculta da
    // tabela, então busca-se o parágrafo do card, não qualquer texto.
    await expect(page.getByRole('paragraph').filter({ hasText: NOME_GRADE }).first()).toBeVisible();
    // Duas cores e dois tamanhos visíveis de uma vez, sem abrir nada.
    await expect(page.getByRole('columnheader', { name: 'P', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'GG' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Preto/ })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Vinho/ })).toBeVisible();
  });

  test('a célula mostra o saldo daquela combinação', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');

    /*
     * Vinho/P e Preto/GG de propósito: são as duas combinações que nenhum
     * teste deste arquivo chega a VENDER, então o saldo semeado sobrevive à
     * ordem de execução. Preto/P não serve — as finalizações consomem peça.
     */
    await expect(celula(page, 'Vinho', 'P')).toHaveText('3');
    await expect(celula(page, 'Vinho', 'P')).toHaveAccessibleName(/3 em estoque/);
    await expect(celula(page, 'Preto', 'GG')).toHaveText('0');
  });

  test('distingue esgotado de combinação que a loja não vende', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');

    // Preto/GG existe no cadastro e zerou: ainda é um botão.
    await expect(page.getByRole('button', { name: /Preto GG, sem saldo registrado/ })).toBeVisible();

    // Vinho/GG nunca foi cadastrado: não é botão, e o rótulo diz o porquê.
    await expect(page.getByRole('button', { name: /Vinho GG/ })).toHaveCount(0);
    await expect(page.getByLabel('Vinho GG: não vendido')).toBeVisible();
  });

  test('clicar numa célula lança exatamente aquela variação no carrinho', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');
    await celula(page, 'Vinho', 'P').click();

    const carrinho = page.getByRole('complementary');
    await expect(carrinho.getByText(NOME_GRADE)).toBeVisible();
    await expect(carrinho.getByText(/Vinho · P/)).toBeVisible();
    await expect(carrinho.getByText('1 peça')).toBeVisible();
  });

  test('produto sem variação entra por um botão só', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Perfume');

    await page.getByRole('button', { name: 'Adicionar' }).click();
    await expect(page.getByRole('complementary').getByText(DADOS_E2E.produtoSemVariacao.nome)).toBeVisible();
  });
});

test.describe('carrinho', () => {
  test('o total fica visível sem precisar abrir nada', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');
    await celula(page, 'Preto', 'P').click();

    await expect(page.getByTestId('total-venda')).toHaveText('R$ 89,90');
  });

  test('somar quantidade atualiza o total na hora', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');
    await celula(page, 'Preto', 'P').click();

    const carrinho = page.getByRole('complementary');
    await carrinho.getByRole('button', { name: /Aumentar/ }).click();

    await expect(carrinho.getByText('2 peças')).toBeVisible();
    await expect(page.getByTestId('total-venda')).toHaveText('R$ 179,80');
  });

  test('bipar a mesma peça duas vezes soma na quantidade, não cria duas linhas', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');
    await celula(page, 'Preto', 'P').click();
    await buscar(page, 'Conjunto Grade');
    await celula(page, 'Preto', 'P').click();

    const carrinho = page.getByRole('complementary');
    await expect(carrinho.getByText('2 peças')).toBeVisible();
    await expect(carrinho.getByRole('listitem')).toHaveCount(1);
  });
});

test.describe('busca', () => {
  test('busca pelo SKU exato, como o leitor entrega', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, DADOS_E2E.produto.sku);

    await expect(
      page.getByRole('paragraph').filter({ hasText: DADOS_E2E.produto.nome }).first(),
    ).toBeVisible();
  });

  test('resultado único entra com Enter — é o caminho do leitor de código', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, DADOS_E2E.produtoSemVariacao.sku);
    await page.getByLabel(/Buscar produto/).press('Enter');

    await expect(page.getByRole('complementary').getByText(DADOS_E2E.produtoSemVariacao.nome)).toBeVisible();
    // A busca se limpa sozinha: a operadora bipa a próxima sem apagar nada.
    await expect(page.getByLabel(/Buscar produto/)).toHaveValue('');
  });

  test('explica que a busca usa o catálogo baixado quando não acha nada', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'zzzz-inexistente');

    await expect(page.getByText(/catálogo baixado neste caixa/)).toBeVisible();
  });
});

test.describe('finalização', () => {
  test('venda dividida: Pix parcial e o resto em dinheiro com troco', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');
    await celula(page, 'Preto', 'P').click(); // R$ 89,90

    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Ainda falta receber')).toBeVisible();

    await modal.getByRole('button', { name: 'Pix' }).click();
    await modal.getByLabel('Valor recebido').type('4000'); // R$ 40,00
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();

    // Restam R$ 49,90; a cliente dá R$ 50,00 e leva R$ 0,10 de troco.
    await modal.getByRole('button', { name: 'Dinheiro' }).click();
    await modal.getByLabel('Valor recebido').type('5000');
    await expect(modal.getByText('Troco a devolver')).toBeVisible();
    await expect(modal.getByText('R$ 0,10')).toBeVisible();

    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await expect(modal.getByText('Pago por completo')).toBeVisible();

    // Peça íntima: a venda não fecha sem a operadora confirmar o aviso.
    await modal.getByRole('checkbox').check();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();

    await expect(page).toHaveURL(/\/venda\/concluida/);
    await expect(page.getByText('Venda registrada')).toBeVisible();
  });

  test('não deixa confirmar enquanto a conta não fecha', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Conjunto Grade');
    await celula(page, 'Preto', 'P').click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('button', { name: 'Confirmar venda' })).toBeDisabled();

    await modal.getByRole('button', { name: 'Débito' }).click();
    await modal.getByLabel('Valor recebido').type('1000'); // R$ 10,00 de R$ 89,90
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();

    await expect(modal.getByText('Ainda falta receber')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Confirmar venda' })).toBeDisabled();
  });

  test('a venda sobe para o servidor depois de confirmada', async ({ page }) => {
    await irParaVenda(page);
    await buscar(page, 'Perfume');
    await page.getByRole('button', { name: 'Adicionar' }).click();

    const envio = page.waitForResponse(
      (resposta) => resposta.url().includes('/vendas') && resposta.request().method() === 'POST',
    );

    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();

    const resposta = await envio;
    expect([200, 201]).toContain(resposta.status());
  });
});

test.describe('sem caixa aberto', () => {
  test('a venda não é alcançável antes de abrir o caixa', async ({ page }) => {
    const { irParaTelaCaixa } = await import('../fixtures.js');
    await irParaTelaCaixa(page);
    await page.goto('/venda');

    // Bloqueia na rota, e não depois de lançar dez itens.
    await expect(page).toHaveURL(/\/caixa/);
    await expect(page.getByRole('heading', { name: 'Abertura de caixa' })).toBeVisible();
  });
});

test.describe('catálogo local', () => {
  test('a réplica local guarda o produtoId, sem o qual não há grade', async ({ page }) => {
    await irParaVenda(page);
    await esperarCatalogoSincronizado(page, 4);

    const semProdutoId = await page.evaluate(async () => {
      const abertura = indexedDB.open('pdv-caixa');
      return new Promise<number>((resolver) => {
        abertura.onsuccess = () => {
          const banco = abertura.result;
          const pedido = banco.transaction('catalogo').objectStore('catalogo').getAll();
          pedido.onsuccess = () => {
            banco.close();
            resolver(
              (pedido.result as { produtoId?: string }[]).filter((item) => !item.produtoId).length,
            );
          };
        };
      });
    });

    expect(semProdutoId).toBe(0);
  });
});
