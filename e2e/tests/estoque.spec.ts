/**
 * Estoque e entrada de mercadoria por XML.
 *
 * O que estes testes protegem:
 *
 *   1. O XML da NF-e vira entrada de estoque sem digitação item a item — que é
 *      onde a loja perde uma tarde e ganha custo cadastrado errado.
 *   2. Item que a nota traz e a loja não reconhece NÃO trava o resto: a
 *      mercadoria já está aqui e precisa entrar hoje.
 *   3. A mesma nota lançada duas vezes é recusada. Dobrar estoque é o erro
 *      mais fácil de cometer e o mais caro de descobrir.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, loginOperador } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

type Pagina = import('@playwright/test').Page;

/** NF-e mínima com um item que a loja conhece e outro que não. */
function notaXml(numero: string, chave: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe${chave}" versao="4.00">
    <ide><nNF>${numero}</nNF><dhEmi>2026-08-15T14:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000199</CNPJ><xNome>Confeccoes E2E</xNome></emit>
    <det nItem="1"><prod>
      <cProd>${DADOS_E2E.produto.sku}</cProd><cEAN>SEM GTIN</cEAN>
      <xProd>CAMISETA FORNECEDOR</xProd>
      <uCom>UN</uCom><qCom>7.0000</qCom><vUnCom>18.5000000000</vUnCom><vProd>129.50</vProd>
    </prod></det>
    <det nItem="2"><prod>
      <cProd>NAO-EXISTE-9</cProd><cEAN>SEM GTIN</cEAN><xProd>PECA NOVA DO FORNECEDOR</xProd>
      <uCom>UN</uCom><qCom>4.0000</qCom><vUnCom>10.0000000000</vUnCom><vProd>40.00</vProd>
    </prod></det>
  </infNFe></NFe>
</nfeProc>`;
}

async function irParaEstoque(page: Pagina) {
  await loginOperador(page);
  await esperarCatalogoSincronizado(page, 4);
  await page.getByRole('link', { name: 'Estoque' }).click();
  await expect(page.getByRole('heading', { name: 'Estoque' })).toBeVisible();
}

async function enviarNota(page: Pagina, xml: string, nome = 'nota.xml') {
  await page.getByLabel('Arquivo XML da nota fiscal').setInputFiles({
    name: nome,
    mimeType: 'text/xml',
    buffer: Buffer.from(xml, 'utf-8'),
  });
}

/** Chave única por teste: a idempotência é por documento e o banco é compartilhado. */
function chaveUnica(): string {
  return String(Date.now()).padStart(44, '3').slice(-44);
}

test.describe('lista de estoque', () => {
  test('mostra o que a loja tem, com o esgotado em palavra', async ({ page }) => {
    await irParaEstoque(page);

    await expect(page.getByRole('listitem').first()).toBeVisible();
    // Preto/GG foi semeado com zero.
    await expect(page.getByText('esgotado').first()).toBeVisible();
  });

  test('filtra por SKU', async ({ page }) => {
    await irParaEstoque(page);
    await page.getByLabel('Filtrar').fill(DADOS_E2E.produtoSemVariacao.sku);

    await expect(page.getByRole('listitem')).toHaveCount(1);
  });
});

test.describe('entrada por XML', () => {
  test('lê a nota, concilia pelo SKU e avisa o que não reconheceu', async ({ page }) => {
    await irParaEstoque(page);
    await enviarNota(page, notaXml('9001', chaveUnica()));

    await expect(page.getByText(/Nota 9001 — Confeccoes E2E/)).toBeVisible();
    await expect(page.getByText('código igual ao SKU')).toBeVisible();
    await expect(page.getByText('não reconhecido')).toBeVisible();
    // Só as 7 peças reconhecidas entram; as 4 do item novo ficam de fora.
    await expect(page.getByRole('button', { name: 'Dar entrada em 7 peças' })).toBeEnabled();
  });

  test('a entrada soma no saldo da peça', async ({ page }) => {
    await irParaEstoque(page);

    // Saldo antes: a camiseta foi semeada com 100.
    await page.getByLabel('Filtrar').fill(DADOS_E2E.produto.sku);
    await expect(page.getByRole('listitem').first()).toContainText('100');

    await enviarNota(page, notaXml('9002', chaveUnica()));
    await page.getByRole('button', { name: 'Dar entrada em 7 peças' }).click();

    await expect(page.getByText('Entrada registrada')).toBeVisible();
    await expect(page.getByText('7 peças')).toBeVisible();

    await page.getByRole('button', { name: 'Concluir' }).click();
    await page.getByLabel('Filtrar').fill(DADOS_E2E.produto.sku);
    await expect(page.getByRole('listitem').first()).toContainText('107', { timeout: 20_000 });
  });

  test('a mesma nota duas vezes é recusada, não duplicada', async ({ page }) => {
    const xml = notaXml('9003', chaveUnica());
    await irParaEstoque(page);

    await enviarNota(page, xml);
    await page.getByRole('button', { name: 'Dar entrada em 7 peças' }).click();
    await expect(page.getByText('Entrada registrada')).toBeVisible();
    await page.getByRole('button', { name: 'Concluir' }).click();

    await enviarNota(page, xml);
    await page.getByRole('button', { name: 'Dar entrada em 7 peças' }).click();

    await expect(page.getByRole('alert')).toContainText(/já teve entrada registrada/);
    /*
     * A tela de conferência continua aberta — é assim que se prova que NÃO
     * houve sucesso. Procurar por "Entrada registrada" seria enganoso: o
     * `getByText` do Playwright casa por substring e sem diferenciar caixa, e
     * a própria mensagem de erro contém "já teve entrada registrada".
     */
    await expect(page.getByRole('button', { name: /Dar entrada em/ })).toBeVisible();
  });

  test('a operadora pode casar o item pendente na mão', async ({ page }) => {
    await irParaEstoque(page);
    await enviarNota(page, notaXml('9004', chaveUnica()));

    /*
     * O `value` da opção é o id da variante, que o teste não conhece. Ler o
     * atributo pelo texto é mais robusto que fixar o rótulo inteiro, que muda
     * se o cadastro ganhar cor ou tamanho.
     */
    const seletor = page.getByLabel('Peça do item 2');
    const idPerfume = await seletor
      .locator('option', { hasText: DADOS_E2E.produtoSemVariacao.sku })
      .getAttribute('value');
    await seletor.selectOption(idPerfume!);

    await expect(page.getByText('escolhido na mão')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dar entrada em 11 peças' })).toBeEnabled();
  });

  test('a quantidade é editável — a nota nem sempre bate com a caixa', async ({ page }) => {
    await irParaEstoque(page);
    await enviarNota(page, notaXml('9005', chaveUnica()));

    await page.getByLabel('Quantidade do item 1').fill('5');

    await expect(page.getByRole('button', { name: 'Dar entrada em 5 peças' })).toBeEnabled();
  });

  test('arquivo que não é NF-e explica o que enviar', async ({ page }) => {
    await irParaEstoque(page);
    await enviarNota(page, '<?xml version="1.0"?><pedido><item/></pedido>', 'pedido.xml');

    await expect(page.getByRole('alert')).toContainText(/veio com a mercadoria/);
    // A tela continua utilizável.
    await expect(page.getByText('O que tem na loja')).toBeVisible();
  });

  test('XML quebrado não deixa a tela em branco', async ({ page }) => {
    await irParaEstoque(page);
    await enviarNota(page, '<nfe><nao fecha>', 'lixo.xml');

    await expect(page.getByRole('alert')).toContainText(/não é um XML válido/);
    await expect(page.getByText('O que tem na loja')).toBeVisible();
  });
});
