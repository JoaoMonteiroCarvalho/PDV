/**
 * Dados e helpers compartilhados pelos specs.
 *
 * `DADOS_E2E` vem de `dados.ts`, não de `seed-e2e.ts` — aquele arquivo roda
 * `main()` (semeia o banco) como efeito colateral da importação, e um spec
 * não deve disparar isso.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

export { DADOS_E2E } from './dados.js';

export function terminalIdSemeado(): string {
  const caminho = resolve(import.meta.dirname, '.dados-seed.json');
  const dados = JSON.parse(readFileSync(caminho, 'utf-8')) as { terminalId: string };
  return dados.terminalId;
}

/**
 * Login do operador padrão.
 *
 * Espera a RESPOSTA do POST /sessao/login antes de retornar — sem isso, o
 * teste segue em frente enquanto o token ainda está a caminho, e o passo
 * seguinte (configurar terminal / reload) corre com a sessão pela metade.
 */
export async function loginOperador(page: Page): Promise<void> {
  const { DADOS_E2E } = await import('./dados.js');
  await page.goto('/');
  await page.getByLabel('Operador').fill(DADOS_E2E.operador.login);
  await page.getByLabel('Senha').fill(DADOS_E2E.operador.senha);

  const respostaLogin = page.waitForResponse((resposta) => resposta.url().includes('/sessao/login'));
  await page.getByRole('button', { name: 'Entrar' }).click();
  const resposta = await respostaLogin;
  if (!resposta.ok()) {
    throw new Error(`Login falhou no teste: HTTP ${resposta.status()}`);
  }
}

/** Garante o terminal configurado sem passar pela tela manual, quando o teste não é sobre ela. */
export async function configurarTerminal(page: Page): Promise<void> {
  await page.evaluate((terminalId) => {
    localStorage.setItem('pdv.terminalId', terminalId);
  }, terminalIdSemeado());
}

/** Login + terminal configurado, parando exatamente na tela de abrir/ver o caixa. */
export async function irParaTelaCaixa(page: Page): Promise<void> {
  await loginOperador(page);
  await configurarTerminal(page);
  await page.reload();
}

/**
 * Espera o catálogo local terminar de sincronizar.
 *
 * O motor de sincronização roda em background assim que a tela de venda
 * monta, mas é assíncrono contra a API real. Buscar um produto antes disso
 * terminar dá "nenhum produto encontrado" mesmo com o catálogo correto no
 * servidor — corrida entre a digitação do teste e o fetch do app.
 */
export async function esperarCatalogoSincronizado(page: Page, minimoDeProdutos = 1): Promise<void> {
  await page.waitForFunction(
    (minimo) => {
      const texto = document.querySelector('.catalogo')?.textContent ?? '';
      const numero = parseInt(texto, 10);
      return !Number.isNaN(numero) && numero >= minimo;
    },
    minimoDeProdutos,
    { timeout: 15_000 },
  );
}

const URL_API_E2E = 'http://localhost:3334';

/**
 * Fecha qualquer sessão de caixa aberta no terminal semeado, direto pela API.
 *
 * Os specs compartilham UM terminal (o do seed, que roda só uma vez para
 * toda a suíte). Um teste que abre o caixa e não fecha — porque falhou no
 * meio, ou porque o cenário dele termina antes do fechamento — deixaria o
 * próximo teste travado em "SESSAO_JA_ABERTA". Rodar isto em `beforeEach`
 * garante que cada teste começa de um terminal sem sessão pendente.
 */
export async function garantirTerminalFechado(): Promise<void> {
  const login = await fetch(`${URL_API_E2E}/sessao/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: (await import('./dados.js')).DADOS_E2E.operador.login,
      senha: (await import('./dados.js')).DADOS_E2E.operador.senha,
    }),
  });
  const { token } = (await login.json()) as { token: string };

  const aberta = await fetch(
    `${URL_API_E2E}/sessoes-caixa/aberta?terminalId=${terminalIdSemeado()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (aberta.status === 404) return;

  const sessao = (await aberta.json()) as { id: string; saldoEsperadoCentavos: number };
  // Fecha "batendo": conta exatamente o valor esperado. O objetivo aqui é
  // liberar o terminal para o próximo teste, não testar divergência.
  await fetch(`${URL_API_E2E}/sessoes-caixa/${sessao.id}/fechar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ valorContadoCentavos: sessao.saldoEsperadoCentavos }),
  });
}
