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
  // Rota dedicada: `/` cai no guard e redireciona para cá de qualquer forma,
  // mas ir direto evita depender do redirecionamento no caminho feliz.
  await page.goto('/entrar');
  await page.getByLabel('Operadora').fill(DADOS_E2E.operador.login);
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
 * O motor de sincronização roda em background assim que o Shell monta, mas é
 * assíncrono contra a API real. Buscar um produto antes disso terminar dá
 * "nada encontrado" mesmo com o catálogo correto no servidor — corrida entre a
 * digitação do teste e o fetch do app.
 *
 * Lê o IndexedDB direto em vez de um número na tela: o contador de produtos
 * era um detalhe da UI antiga, e amarrar o helper a ele fez a suíte inteira
 * quebrar quando a tela mudou.
 */
export async function esperarCatalogoSincronizado(page: Page, minimoDeProdutos = 1): Promise<void> {
  await page.waitForFunction(
    async (minimo) => {
      const abertura = indexedDB.open('pdv-caixa');
      const total = await new Promise<number>((resolver) => {
        abertura.onsuccess = () => {
          const banco = abertura.result;
          if (!banco.objectStoreNames.contains('catalogo')) {
            banco.close();
            resolver(0);
            return;
          }
          const pedido = banco.transaction('catalogo').objectStore('catalogo').count();
          pedido.onsuccess = () => {
            banco.close();
            resolver(pedido.result);
          };
          pedido.onerror = () => {
            banco.close();
            resolver(0);
          };
        };
        abertura.onerror = () => resolver(0);
      });
      return total >= minimo;
    },
    minimoDeProdutos,
    { timeout: 20_000 },
  );
}

/**
 * Login + terminal + caixa aberto, parando na tela de venda com o catálogo já
 * baixado. É o ponto de partida de qualquer teste sobre vender.
 */
export async function irParaVenda(page: Page, fundoTrocoCentavos = '20000'): Promise<void> {
  await irParaTelaCaixa(page);
  await page.getByLabel('Fundo de troco').fill('');
  await page.getByLabel('Fundo de troco').type(fundoTrocoCentavos);
  await page.getByRole('button', { name: /Abrir caixa/ }).click();
  await page.waitForURL(/\/venda/);
  await esperarCatalogoSincronizado(page, 4);
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
