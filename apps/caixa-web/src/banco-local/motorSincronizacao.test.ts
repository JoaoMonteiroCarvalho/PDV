import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bancoLocal } from './db.js';
import { enfileirarVenda, processarFila } from './motorSincronizacao.js';

function payload(id: string) {
  return {
    id,
    sessaoCaixaId: 'sessao-1',
    criadaEmCliente: '2026-08-30T12:00:00.000Z',
    itens: [{ varianteId: 'v1', quantidade: 1, precoUnitarioCentavos: 8990, descontoCentavos: 0 }],
    descontoSobreTotalCentavos: 0,
    pagamentos: [{ forma: 'PIX' as const, valorCentavos: 8990, trocoCentavos: 0 }],
  };
}

beforeEach(async () => {
  await bancoLocal.filaVendas.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enfileirarVenda', () => {
  it('grava no Dexie com status "pendente" antes de qualquer rede', async () => {
    // `enfileirarVenda` dispara processarFila() em segundo plano (não
    // espera por ele) — a asserção abaixo roda antes desse envio de fundo
    // ter qualquer chance de mudar o status, então o mock de fetch aqui só
    // precisa resolver rápido pra não deixar a trava global do motor
    // (`processandoAgora`) presa e atrapalhar o próximo teste do arquivo.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ vendaId: 'venda-teste-a', numero: 1, totalCentavos: 8990, jaEstavaRegistrada: false }),
    } as Response);

    const antesDoEnvio = await enfileirarVenda(payload('venda-teste-a'));
    expect(antesDoEnvio.status).toBe('pendente');

    // `enfileirarVenda` NÃO espera o envio de fundo terminar (por design —
    // é o que garante que a tela não trava esperando rede). O teste, por
    // sua vez, precisa esperar esse envio de fundo terminar antes de
    // acabar, senão ele continua rodando durante o PRÓXIMO teste do
    // arquivo e prende a trava global do motor (`processandoAgora`).
    await vi.waitFor(async () => {
      const registro = await bancoLocal.filaVendas.get('venda-teste-a');
      expect(registro?.status).toBe('sincronizada');
    });
  });
});

describe('processarFila', () => {
  it('envia um pendente e marca como sincronizada com o número do servidor', async () => {
    await bancoLocal.filaVendas.put({
      id: 'venda-teste-b',
      status: 'pendente',
      payload: payload('venda-teste-b'),
      tentativas: 0,
      criadaEm: new Date().toISOString(),
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vendaId: 'venda-teste-b', numero: 42, totalCentavos: 8990, jaEstavaRegistrada: false }),
    } as Response);

    await processarFila();

    const registro = await bancoLocal.filaVendas.get('venda-teste-b');
    expect(registro?.status).toBe('sincronizada');
    expect(registro?.numero).toBe(42);
  });

  it('falha de rede mantém a venda visível como erro, nunca some da fila', async () => {
    await bancoLocal.filaVendas.put({
      id: 'venda-teste-c',
      status: 'pendente',
      payload: payload('venda-teste-c'),
      tentativas: 0,
      criadaEm: new Date().toISOString(),
    });

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await processarFila();

    const registro = await bancoLocal.filaVendas.get('venda-teste-c');
    expect(registro?.status).toBe('erro');
    expect(registro?.tentativas).toBe(1);
  });

  /**
   * Retomada de fila: exatamente o cenário do critério de aceite — página
   * recarregada (ou navegador reaberto) com venda pendente de antes.
   * `processarFila` não distingue "acabou de cair" de "estava pendente de
   * uma sessão anterior": qualquer coisa com status pendente/erro é
   * reenviada, o que é o próprio mecanismo de retomada.
   */
  it('reenvia pendências que já existiam antes de processarFila ser chamada (retomada)', async () => {
    await bancoLocal.filaVendas.bulkPut([
      {
        id: 'venda-teste-d1',
        status: 'pendente',
        payload: payload('venda-teste-d1'),
        tentativas: 0,
        criadaEm: '2026-08-29T10:00:00.000Z',
      },
      {
        id: 'venda-teste-d2',
        status: 'erro',
        payload: payload('venda-teste-d2'),
        tentativas: 2,
        ultimoErro: 'timeout',
        criadaEm: '2026-08-29T11:00:00.000Z',
      },
    ]);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ vendaId: 'x', numero: 1, totalCentavos: 8990, jaEstavaRegistrada: false }),
    } as Response);

    await processarFila();

    const v1 = await bancoLocal.filaVendas.get('venda-teste-d1');
    const v2 = await bancoLocal.filaVendas.get('venda-teste-d2');
    expect(v1?.status).toBe('sincronizada');
    expect(v2?.status).toBe('sincronizada');
  });

  /**
   * Regressão: sem timeout, uma conexão que trava (não erra, só nunca
   * responde) prenderia a trava global do motor pra sempre — a fila inteira
   * pararia de avançar até a página recarregar. Não espero os 15s de
   * verdade aqui, só confirmo que a chamada carrega um `AbortSignal`.
   */
  it('envia a venda com um limite de tempo, para nunca travar a fila inteira', async () => {
    await bancoLocal.filaVendas.put({
      id: 'venda-teste-g',
      status: 'pendente',
      payload: payload('venda-teste-g'),
      tentativas: 0,
      criadaEm: new Date().toISOString(),
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vendaId: 'venda-teste-g', numero: 1, totalCentavos: 8990, jaEstavaRegistrada: false }),
    } as Response);

    await processarFila();

    const [, opcoes] = vi.mocked(fetch).mock.calls[0]!;
    expect(opcoes?.signal).toBeInstanceOf(AbortSignal);
  });

  it('venda já sincronizada não é reenviada', async () => {
    await bancoLocal.filaVendas.put({
      id: 'venda-teste-e',
      status: 'sincronizada',
      payload: payload('venda-teste-e'),
      tentativas: 0,
      numero: 10,
      criadaEm: new Date().toISOString(),
    });

    await processarFila();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('reenvio idempotente: o servidor confirmando com jaEstavaRegistrada ainda marca como sincronizada', async () => {
    await bancoLocal.filaVendas.put({
      id: 'venda-teste-f',
      status: 'erro',
      payload: payload('venda-teste-f'),
      tentativas: 1,
      ultimoErro: 'timeout anterior',
      criadaEm: new Date().toISOString(),
    });

    // O servidor responde 200 (não 201) para uma venda que já existia --
    // é assim que a API real trata reenvio do mesmo id, sem erro.
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vendaId: 'venda-teste-f', numero: 42, totalCentavos: 8990, jaEstavaRegistrada: true }),
    } as Response);

    await processarFila();

    const registro = await bancoLocal.filaVendas.get('venda-teste-f');
    expect(registro?.status).toBe('sincronizada');
  });
});
