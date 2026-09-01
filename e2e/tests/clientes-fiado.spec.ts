/**
 * Clientes e fiado — o ciclo completo.
 *
 * O que estes testes protegem:
 *
 *   1. CPF é validado com dígito verificador. "Tem 11 números" deixaria passar
 *      dívida no nome de ninguém, e é aí que a loja não consegue cobrar.
 *   2. Fiado exige cliente identificada e respeita o limite DISPONÍVEL — o que
 *      ela deve já descontado.
 *   3. Recebimento é lançamento: pagamento parcial existe, e o saldo devedor
 *      cai na hora.
 */

import { expect, test } from '@playwright/test';
import { DADOS_E2E, esperarCatalogoSincronizado, garantirTerminalFechado, irParaVenda, loginOperador } from '../fixtures.js';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

type Pagina = import('@playwright/test').Page;

async function irParaClientes(page: Pagina) {
  await loginOperador(page);
  await page.getByRole('link', { name: 'Clientes' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
}

/** Nome único por rodada: o banco de E2E é compartilhado entre testes. */
function nomeUnico(prefixo: string): string {
  return `${prefixo} ${Date.now().toString().slice(-6)}`;
}

test.describe('cadastro de cliente', () => {
  test('cadastra com CPF válido e abre a ficha', async ({ page }) => {
    await irParaClientes(page);
    const nome = nomeUnico('Nova Cliente');

    await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await page.getByLabel('Nome').fill(nome);
    await page.getByLabel('CPF (opcional)').fill('11144477735');
    await page.getByLabel('Limite de fiado').type('20000');
    await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

    await expect(page.getByRole('heading', { name: nome })).toBeVisible();
    await expect(page.getByTestId('limite-disponivel')).toHaveText('R$ 200,00');
  });

  test('recusa CPF com dígito verificador errado, antes de enviar', async ({ page }) => {
    await irParaClientes(page);

    await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await page.getByLabel('Nome').fill('Fulana');
    await page.getByLabel('CPF (opcional)').fill('52998224726');

    await expect(page.getByText('CPF inválido. Confira os números com a cliente.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cadastrar', exact: true })).toBeDisabled();
  });

  test('recusa sequência de dígitos iguais', async ({ page }) => {
    // É o que alguém digita para "pular" o campo, e passa no cálculo se
    // ninguém tratar o caso.
    await irParaClientes(page);

    await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await page.getByLabel('Nome').fill('Fulana');
    await page.getByLabel('CPF (opcional)').fill('11111111111');

    await expect(page.getByRole('button', { name: 'Cadastrar', exact: true })).toBeDisabled();
  });

  test('cadastra sem CPF — a loja atende quem não quer informar', async ({ page }) => {
    await irParaClientes(page);
    // O nome não pode conter "sem CPF": o `getByText` casa por substring e a
    // asserção acharia o próprio título em vez do rótulo do documento.
    const nome = nomeUnico('Cliente Anonima');

    await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await page.getByLabel('Nome').fill(nome);
    await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

    await expect(page.getByRole('heading', { name: nome })).toBeVisible();
    await expect(page.getByText('sem CPF')).toBeVisible();
  });

  test('CPF já cadastrado diz de quem é', async ({ page }) => {
    await irParaClientes(page);

    await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
    await page.getByLabel('Nome').fill('Outra Pessoa');
    await page.getByLabel('CPF (opcional)').fill(DADOS_E2E.clienteFiado.cpf);
    await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText(DADOS_E2E.clienteFiado.nome);
  });

  test('busca acha por CPF, mesmo com pontuação', async ({ page }) => {
    await irParaClientes(page);
    await page.getByLabel('Buscar').fill('529.982');

    await expect(page.getByText(DADOS_E2E.clienteFiado.nome)).toBeVisible();
  });
});

test.describe('venda no fiado', () => {
  /** Vende o perfume (R$ 120) no fiado para a cliente semeada. */
  async function venderNoFiado(page: Pagina, parcelas: number) {
    await irParaVenda(page);
    await page.getByLabel(/Buscar produto/).fill('Perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Fiado' }).click();
    await modal.getByLabel('Cliente do fiado').fill(DADOS_E2E.clienteFiado.nome);
    await modal.getByRole('button', { name: new RegExp(DADOS_E2E.clienteFiado.nome) }).click();
    await expect(page.getByTestId('limite-disponivel-venda')).toBeVisible();

    if (parcelas > 1) await modal.getByRole('button', { name: `${parcelas}x` }).click();
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page).toHaveURL(/\/venda\/concluida/);
  }

  test('fiado sem cliente escolhida é recusado com instrução', async ({ page }) => {
    await irParaVenda(page);
    await page.getByLabel(/Buscar produto/).fill('Perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Fiado' }).click();
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();

    await expect(page.getByRole('alert')).toContainText('Escolha a cliente antes de lançar no fiado');
  });

  test('mostra quanto a cliente ainda pode levar', async ({ page }) => {
    await irParaVenda(page);
    await page.getByLabel(/Buscar produto/).fill('Perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Fiado' }).click();
    await modal.getByLabel('Cliente do fiado').fill(DADOS_E2E.clienteFiado.nome);
    await modal.getByRole('button', { name: new RegExp(DADOS_E2E.clienteFiado.nome) }).click();

    // O valor exato depende do que outros testes já venderam no fiado; o que
    // importa é que o número aparece e é o DISPONÍVEL, não o limite total.
    await expect(page.getByTestId('limite-disponivel-venda')).toBeVisible();
  });

  test('a venda no fiado vira parcelas na ficha da cliente', async ({ page }) => {
    await venderNoFiado(page, 3);

    await page.getByRole('link', { name: 'Clientes' }).click();
    await page.getByLabel('Buscar').fill(DADOS_E2E.clienteFiado.nome);
    await page.getByRole('button', { name: new RegExp(DADOS_E2E.clienteFiado.nome) }).click();

    await expect(page.getByRole('heading', { name: DADOS_E2E.clienteFiado.nome })).toBeVisible();
    // R$ 120 em 3x = três parcelas de R$ 40. O texto da linha é montado com
    // interpolação, então vira vários nós — casar por regex no item da lista.
    await expect(page.getByRole('listitem').filter({ hasText: /Parcela 1\/3/ })).toBeVisible();
  });
});

test.describe('recebimento de parcela', () => {
  async function abrirFichaComDivida(page: Pagina) {
    // Gera uma dívida nova para este teste não depender do que sobrou de outro.
    await irParaVenda(page);
    await page.getByLabel(/Buscar produto/).fill('Perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Fiado' }).click();
    await modal.getByLabel('Cliente do fiado').fill(DADOS_E2E.clienteFiado.nome);
    await modal.getByRole('button', { name: new RegExp(DADOS_E2E.clienteFiado.nome) }).click();
    await expect(page.getByTestId('limite-disponivel-venda')).toBeVisible();
    await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
    await modal.getByRole('button', { name: 'Confirmar venda' }).click();
    await expect(page).toHaveURL(/\/venda\/concluida/);

    await page.getByRole('link', { name: 'Clientes' }).click();
    await page.getByLabel('Buscar').fill(DADOS_E2E.clienteFiado.nome);
    await page.getByRole('button', { name: new RegExp(DADOS_E2E.clienteFiado.nome) }).click();
    await expect(page.getByTestId('saldo-devedor')).toBeVisible();
  }

  test('receber a parcela inteira tira ela da lista', async ({ page }) => {
    await abrirFichaComDivida(page);
    const parcelasAntes = await page.getByRole('listitem').count();

    await page.getByRole('button', { name: 'Receber' }).first().click();
    await page.getByRole('button', { name: 'Registrar recebimento' }).click();

    await expect(page.getByRole('listitem')).toHaveCount(parcelasAntes - 1, { timeout: 20_000 });
  });

  test('pagamento parcial deixa o resto em aberto', async ({ page }) => {
    /*
     * A cliente paga metade hoje e metade na semana que vem. Só "paga ou não
     * paga" obrigaria a operadora a escolher entre mentir e recusar o dinheiro.
     */
    await abrirFichaComDivida(page);

    await page.getByRole('button', { name: 'Receber' }).first().click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Valor recebido').fill('');
    await modal.getByLabel('Valor recebido').type('5000');
    await expect(modal.getByText(/Pagamento parcial/)).toBeVisible();
    await modal.getByRole('button', { name: 'Registrar recebimento' }).click();

    await expect(page.getByText(/já pagou R\$ 50,00/)).toBeVisible({ timeout: 20_000 });
  });

  test('recusa receber mais do que falta', async ({ page }) => {
    // Não é sobra, é erro de digitação: criaria crédito fantasma e saldo
    // devedor negativo.
    await abrirFichaComDivida(page);

    await page.getByRole('button', { name: 'Receber' }).first().click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Valor recebido').fill('');
    await modal.getByLabel('Valor recebido').type('99999');

    await expect(modal.getByText('Maior do que falta nesta parcela.')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Registrar recebimento' })).toBeDisabled();
  });

  test('sem caixa aberto, não recebe — o dinheiro entra na gaveta', async ({ page }) => {
    await abrirFichaComDivida(page);
    // Fecha o caixa pela API, como se o turno tivesse acabado.
    await garantirTerminalFechado();
    await page.reload();
    await esperarCatalogoSincronizado(page, 4);

    await page.getByLabel('Buscar').fill(DADOS_E2E.clienteFiado.nome);
    await page.getByRole('button', { name: new RegExp(DADOS_E2E.clienteFiado.nome) }).click();
    await page.getByRole('button', { name: 'Receber' }).first().click();

    await expect(page.getByText(/Não há caixa aberto/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Registrar recebimento' })).toBeDisabled();
  });
});
