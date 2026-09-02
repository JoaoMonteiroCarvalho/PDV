/**
 * Configurações — preferências da máquina, dados da loja e usuários.
 *
 * O que estes testes protegem:
 *
 *   1. O interruptor do 3D existe e faz efeito de verdade: desligar leva a
 *      tela do catálogo ao palco estático, sem canvas nenhum. Era a pergunta
 *      em aberto — "para que serve o interruptor 3D?" — e agora ela tem botão.
 *   2. O que o gerente digita em "dados da loja" é o que sai IMPRESSO no
 *      comprovante da próxima venda. Esse é o caminho inteiro, e é o único
 *      jeito de saber que a configuração não morreu no banco.
 *   3. A separação de papéis: operadora não vê a lista de usuários e não
 *      altera os dados da loja.
 *   4. Usuário criado aqui consegue entrar no sistema — cadastro que não
 *      resulta em login é cadastro que só parece ter funcionado.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  DADOS_E2E,
  esperarCatalogoSincronizado,
  garantirTerminalFechado,
  irParaVenda,
  loginOperador,
} from '../fixtures.js';

const URL_API_E2E = 'http://localhost:3334';

test.beforeEach(async () => {
  await garantirTerminalFechado();
});

async function loginGerente(page: Page): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('Operadora').fill(DADOS_E2E.gerente.login);
  await page.getByLabel('Senha').fill(DADOS_E2E.gerente.senha);

  const resposta = page.waitForResponse((r) => r.url().includes('/sessao/login'));
  await page.getByRole('button', { name: 'Entrar' }).click();
  const feita = await resposta;
  if (!feita.ok()) throw new Error(`Login do gerente falhou: HTTP ${feita.status()}`);
}

async function irParaConfiguracoes(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Configurações' }).click();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
}

/**
 * Devolve a loja ao estado anterior direto pela API.
 *
 * Os specs dividem UM banco. Um teste que renomeia a loja e vai embora
 * deixaria o comprovante dos outros com o nome errado — o mesmo tipo de
 * contaminação entre testes que já derrubou a suíte antes.
 */
async function restaurarLoja(anterior: Record<string, unknown>): Promise<void> {
  const login = await fetch(`${URL_API_E2E}/sessao/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: DADOS_E2E.gerente.login, senha: DADOS_E2E.gerente.senha }),
  });
  const { token } = (await login.json()) as { token: string };

  await fetch(`${URL_API_E2E}/configuracao`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nome: (anterior.nome as string) || 'Loja',
      endereco: anterior.endereco ?? '',
      telefone: anterior.telefone ?? '',
      cnpj: anterior.cnpj ?? '',
      politicaTrocaExtra: anterior.politicaTrocaExtra ?? '',
    }),
  });
}

test.describe('preferências desta máquina', () => {
  test('o interruptor do 3D desliga as cenas de verdade', async ({ page }) => {
    await loginOperador(page);
    await esperarCatalogoSincronizado(page, 4);
    await irParaConfiguracoes(page);

    const interruptor = page.getByRole('switch', { name: 'Efeitos 3D' });
    await expect(interruptor).toHaveAttribute('aria-checked', 'true');
    await interruptor.click();

    // A tela recarrega ao trocar; depois disso o catálogo não monta canvas.
    await expect(page.getByRole('switch', { name: 'Efeitos 3D' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await page.getByRole('link', { name: 'Catálogo' }).click();
    await expect(
      page.getByRole('img', { name: /Prévia abstrata de Conjunto Grade E2E/ }),
    ).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('o tema escuro é escolha manual e fica escolhido', async ({ page }) => {
    await loginOperador(page);
    await irParaConfiguracoes(page);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('switch', { name: 'Tema escuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Sobrevive a recarregar: preferência, não estado de tela.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('dados da loja', () => {
  test('o que o gerente cadastra sai impresso no comprovante', async ({ page, browser }) => {
    await loginGerente(page);
    await irParaConfiguracoes(page);

    const anterior = await page.evaluate(async () => {
      const bruto = localStorage.getItem('pdv.loja');
      return bruto ? (JSON.parse(bruto) as Record<string, unknown>) : { nome: 'Loja' };
    });

    const nomeNovo = 'Boutique E2E';
    await page.getByLabel('Nome').fill(nomeNovo);
    await page.getByLabel('Endereço').fill('Rua E2E, 42');
    await page.getByLabel(/Linha extra na política/).fill('Trocas de segunda a sexta.');
    await page.getByRole('button', { name: /Salvar dados da loja/ }).click();
    await expect(page.getByText('Salvo.')).toBeVisible();

    /*
     * A venda acontece em OUTRO contexto do navegador, como operadora. Não é
     * capricho: um contexto novo tem `localStorage` vazio, então o nome no
     * comprovante só pode ter vindo do servidor. Se o teste vendesse na mesma
     * aba, passaria mesmo que a configuração nunca tivesse saído dali.
     */
    const contextoDaVenda = await browser.newContext();
    const caixa = await contextoDaVenda.newPage();
    try {
      await irParaVenda(caixa);
      await caixa.getByLabel(/Buscar produto/).fill('Perfume');
      await caixa.getByRole('button', { name: 'Adicionar', exact: true }).click();
      await caixa.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();

      const modal = caixa.getByRole('dialog');
      await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
      await modal.getByRole('button', { name: 'Confirmar venda' }).click();
      await expect(caixa).toHaveURL(/\/venda\/concluida/);

      const comprovante = caixa.getByLabel('Comprovante da venda');
      await expect(comprovante).toContainText(nomeNovo);
      await expect(comprovante).toContainText('Rua E2E, 42');
      await expect(comprovante).toContainText('Trocas de segunda a sexta.');
      // A garantia legal continua lá: a linha da loja soma, não substitui.
      await expect(comprovante).toContainText('Defeito de fabricacao: troca garantida.');
    } finally {
      await contextoDaVenda.close();
      await restaurarLoja(anterior);
    }
  });

  test('operadora vê os dados da loja, mas não altera nem vê usuários', async ({ page }) => {
    await loginOperador(page);
    await irParaConfiguracoes(page);

    await expect(page.getByText('Somente leitura')).toBeVisible();
    await expect(page.getByLabel('Nome')).toBeDisabled();
    await expect(page.getByRole('button', { name: /Salvar dados da loja/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Usuários' })).toHaveCount(0);
  });
});

test.describe('usuários', () => {
  test('gerente cria usuário e ele consegue entrar', async ({ page, browser }) => {
    await loginGerente(page);
    await irParaConfiguracoes(page);

    // Login único por execução: a suíte compartilha o banco e um login fixo
    // daria "já em uso" na segunda rodada.
    const login = `novo${Date.now().toString().slice(-8)}`;
    const senha = 'entrada123';

    await page.getByRole('button', { name: 'Novo usuário' }).click();
    const formulario = page.getByTestId('form-novo-usuario');
    await formulario.getByLabel('Nome').fill('Vendedora Nova');
    await formulario.getByLabel('Login').fill(login);
    await formulario.getByLabel('Senha').fill(senha);
    await formulario.getByLabel(/Limite de desconto/).fill('5');
    await formulario.getByRole('button', { name: 'Criar usuário' }).click();

    await expect(page.getByTestId(`resumo-${login}`)).toContainText('Operador');
    await expect(page.getByTestId(`resumo-${login}`)).toContainText('5%');

    // A prova de que o cadastro serviu para alguma coisa: a pessoa entra.
    const outroContexto = await browser.newContext();
    const outraPagina = await outroContexto.newPage();
    await outraPagina.goto('/entrar');
    await outraPagina.getByLabel('Operadora').fill(login);
    await outraPagina.getByLabel('Senha').fill(senha);
    await outraPagina.getByRole('button', { name: 'Entrar' }).click();
    await expect(outraPagina.getByText('Vendedora Nova')).toBeVisible({ timeout: 15_000 });
    await outroContexto.close();
  });

  test('o gerente não consegue desativar a si mesmo', async ({ page }) => {
    await loginGerente(page);
    await irParaConfiguracoes(page);

    const minhaLinha = page.getByTestId(`usuario-${DADOS_E2E.gerente.login}`);
    await expect(minhaLinha.getByRole('button', { name: 'Desativar' })).toBeDisabled();
  });

  test('senha em branco na edição mantém a senha atual', async ({ page }) => {
    await loginGerente(page);
    await irParaConfiguracoes(page);

    const linha = page.getByTestId(`usuario-${DADOS_E2E.operador.login}`);
    await linha.getByRole('button', { name: 'Editar' }).click();
    await linha.getByRole('button', { name: 'Salvar alterações' }).click();

    // Se salvar em branco tivesse zerado a senha, este login falharia.
    await page.getByRole('button', { name: 'Sair' }).click();
    await loginOperador(page);
    await expect(page.getByText(DADOS_E2E.operador.nome)).toBeVisible();
  });
});
