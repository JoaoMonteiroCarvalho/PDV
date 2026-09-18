/**
 * Devolução de item com quantidade parcial, de ponta a ponta: vende 2
 * unidades, devolve 1, confirma que a segunda continua disponível.
 *
 * Cobre o caso real de moda íntima que motivou remodelar o schema: cliente
 * compra várias peças iguais e devolve só uma.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  DADOS_E2E,
  esperarCatalogoSincronizado,
  garantirTerminalFechado,
  irParaVenda,
} from '../fixtures.js';

/**
 * Extrai o identificador que a tela de devolução aceita.
 *
 * A venda ainda não sincronizou no instante da impressão ("Venda: pendente"),
 * então o comprovante não tem número sequencial — só o código curto do UUID,
 * impresso sozinho numa linha em maiúsculo (8 caracteres hexadecimais). É
 * esse código curto que a busca da devolução usa nesse caso.
 */
function extrairIdentificadorDaVenda(textoComprovante: string): string {
  const codigoCurto = /^\s*([0-9A-F]{8})\s*$/m.exec(textoComprovante);
  if (codigoCurto) return codigoCurto[1]!;

  const numero = /Venda:\s*(\d+)/.exec(textoComprovante);
  if (numero) return numero[1]!;

  throw new Error(`identificador da venda não encontrado em: ${textoComprovante}`);
}

async function venderEObterIdentificador(page: Page, quantidade: 1 | 2): Promise<string> {
  const busca = page.getByLabel(/Buscar produto/);
  for (let i = 0; i < quantidade; i += 1) {
    await busca.fill('perfume');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  }

  await page.getByRole('complementary').getByRole('button', { name: 'Finalizar' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Débito' }).click();
  await modal.getByRole('button', { name: 'Lançar pagamento' }).click();
  await modal.getByRole('button', { name: 'Confirmar venda' }).click();
  await expect(page).toHaveURL(/\/venda\/concluida/);

  const textoComprovante = await page.getByLabel('Comprovante da venda').innerText();
  return extrairIdentificadorDaVenda(textoComprovante);
}

test.describe('devolução', () => {
  test.beforeEach(async () => {
    await garantirTerminalFechado();
  });

  test('vende 2 unidades, devolve 1 e a outra continua disponível', async ({ page }) => {
    await irParaVenda(page);
    await esperarCatalogoSincronizado(page, 4);

    // --- Venda de 2 unidades do perfume (produto sem grade) -----------------
    const identificador = await venderEObterIdentificador(page, 2);

    // --- Devolução de 1 das 2 unidades --------------------------------------
    await page.goto('/devolucao');
    await expect(page.getByRole('heading', { name: 'Devolução' })).toBeVisible();

    await page.getByLabel(/Número ou código da venda/).fill(identificador);
    await page.getByRole('button', { name: 'Buscar venda' }).click();

    await expect(page.getByText(/^Devolução/)).toBeVisible();
    await expect(page.getByText(/disponível 2/)).toBeVisible();

    await page.getByRole('button', { name: /Aumentar quantidade/ }).click();
    await expect(page.getByText('Total a devolver')).toBeVisible();
    await expect(page.getByText('R$ 120,00')).toBeVisible();

    await page.getByPlaceholder('Ex.: peça com defeito').fill('Cliente comprou o tamanho errado');
    await page.getByLabel('Login do gerente').fill(DADOS_E2E.gerente.login);
    await page.getByLabel('Senha do gerente').fill(DADOS_E2E.gerente.senha);
    await page.getByRole('button', { name: 'Autorizar' }).click();
    await expect(page.getByText('Autorizado')).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar devolução' }).click();

    await expect(page.getByText('Devolução registrada')).toBeVisible();
    await expect(page.getByText('R$ 120,00')).toBeVisible();

    // --- Confere que só 1 unidade foi devolvida, a outra continua disponível ---
    await page.getByRole('button', { name: 'Outra devolução' }).click();
    await page.getByLabel(/Número ou código da venda/).fill(identificador);
    await page.getByRole('button', { name: 'Buscar venda' }).click();

    await expect(page.getByText(/já devolvido 1/)).toBeVisible();
    await expect(page.getByText(/disponível 1/)).toBeVisible();
  });

  test('devolução exige gerente válido — operador comum é recusado', async ({ page }) => {
    await irParaVenda(page);
    await esperarCatalogoSincronizado(page, 4);

    const identificador = await venderEObterIdentificador(page, 1);

    await page.goto('/devolucao');
    await page.getByLabel(/Número ou código da venda/).fill(identificador);
    await page.getByRole('button', { name: 'Buscar venda' }).click();

    await page.getByRole('button', { name: /Aumentar quantidade/ }).click();
    await page.getByPlaceholder('Ex.: peça com defeito').fill('Teste sem gerente');
    // Credenciais do OPERADOR, não do gerente.
    await page.getByLabel('Login do gerente').fill(DADOS_E2E.operador.login);
    await page.getByLabel('Senha do gerente').fill(DADOS_E2E.operador.senha);
    await page.getByRole('button', { name: 'Autorizar' }).click();

    await expect(page.getByText(/não tem perfil de gerente/i)).toBeVisible();
    // Sem autorização, o botão de confirmar continua bloqueado.
    await expect(page.getByRole('button', { name: 'Confirmar devolução' })).toBeDisabled();
  });

  test('venda inexistente mostra erro, não tela em branco', async ({ page }) => {
    const { loginOperador, configurarTerminal } = await import('../fixtures.js');
    await loginOperador(page);
    await configurarTerminal(page);
    await page.goto('/devolucao');

    await page.getByLabel(/Número ou código da venda/).fill('999999');
    await page.getByRole('button', { name: 'Buscar venda' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
  });
});
