import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BancoLocal } from '../banco/local.js';
import { BACKOFF_PADRAO, calcularEspera, classificarFalha } from './backoff.js';
import { FilaSincronizacao } from './fila.js';

describe('calcularEspera()', () => {
  const semAcaso = () => 0.5; // jitter neutro: cai no valor central

  it('cresce exponencialmente a partir da base', () => {
    expect(calcularEspera(1, BACKOFF_PADRAO, semAcaso)).toBe(2_000);
    expect(calcularEspera(2, BACKOFF_PADRAO, semAcaso)).toBe(4_000);
    expect(calcularEspera(3, BACKOFF_PADRAO, semAcaso)).toBe(8_000);
    expect(calcularEspera(4, BACKOFF_PADRAO, semAcaso)).toBe(16_000);
  });

  it('respeita o teto — senão a 15ª tentativa esperaria horas', () => {
    expect(calcularEspera(20, BACKOFF_PADRAO, semAcaso)).toBe(BACKOFF_PADRAO.tetoMs);
    expect(calcularEspera(50, BACKOFF_PADRAO, semAcaso)).toBe(BACKOFF_PADRAO.tetoMs);
  });

  it('aplica jitter dentro da faixa esperada', () => {
    const minimo = calcularEspera(3, BACKOFF_PADRAO, () => 0);
    const maximo = calcularEspera(3, BACKOFF_PADRAO, () => 0.999999);
    expect(minimo).toBe(6_400); // 8000 - 20%
    expect(maximo).toBeCloseTo(9_600, -2); // 8000 + 20%
  });

  it('nunca devolve espera negativa', () => {
    for (let tentativa = 1; tentativa <= 10; tentativa += 1) {
      expect(calcularEspera(tentativa, { baseMs: 1, tetoMs: 10, jitter: 5 }, () => 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('recusa número de tentativa inválido', () => {
    expect(() => calcularEspera(0)).toThrow();
    expect(() => calcularEspera(-1)).toThrow();
    expect(() => calcularEspera(1.5)).toThrow();
  });
});

describe('classificarFalha()', () => {
  it('trata ausência de resposta como transitória — é o caso de estar offline', () => {
    expect(classificarFalha(null)).toBe('TRANSITORIA');
  });

  it('trata 5xx, 408, 429 e 401 como transitórios', () => {
    expect(classificarFalha(500)).toBe('TRANSITORIA');
    expect(classificarFalha(503)).toBe('TRANSITORIA');
    expect(classificarFalha(408)).toBe('TRANSITORIA');
    expect(classificarFalha(429)).toBe('TRANSITORIA');
    expect(classificarFalha(401)).toBe('TRANSITORIA'); // token expirado, renova e repete
  });

  it('trata recusa por regra de negócio como permanente', () => {
    expect(classificarFalha(400)).toBe('PERMANENTE');
    expect(classificarFalha(403)).toBe('PERMANENTE');
    expect(classificarFalha(409)).toBe('PERMANENTE');
    expect(classificarFalha(422)).toBe('PERMANENTE');
  });
});

describe('FilaSincronizacao', () => {
  let banco: BancoLocal;
  let fila: FilaSincronizacao;
  let relogio = 1_000_000;

  const venda = (id: string, total = 8990) => ({
    id,
    corpo: { id, itens: [] },
    totalCentavos: total,
  });

  beforeEach(async () => {
    relogio = 1_000_000;
    banco = new BancoLocal(`teste-${Math.random()}`);
    await banco.open();
    fila = new FilaSincronizacao(banco, {
      agora: () => relogio,
      aleatorio: () => 0.5,
    });
  });

  afterEach(async () => {
    await banco.delete();
  });

  it('enfileira a venda como pendente e pronta para envio imediato', async () => {
    await fila.enfileirar(venda('v1'));

    const prontas = await fila.prontasParaEnvio();
    expect(prontas).toHaveLength(1);
    expect(prontas[0]!.estado).toBe('PENDENTE');
    expect(prontas[0]!.tentativas).toBe(0);
  });

  it('não duplica quando a mesma venda é enfileirada duas vezes', async () => {
    await fila.enfileirar(venda('v1'));
    await fila.registrarResultado('v1', { status: null });
    await fila.enfileirar(venda('v1')); // duplo clique em "Finalizar"

    const todas = await banco.fila.toArray();
    expect(todas).toHaveLength(1);
    // O estado da primeira tentativa foi preservado, não sobrescrito.
    expect(todas[0]!.tentativas).toBe(1);
  });

  it('remove da fila quando o servidor responde 201', async () => {
    await fila.enfileirar(venda('v1'));
    const desfecho = await fila.registrarResultado('v1', { status: 201 });

    expect(desfecho).toBe('SINCRONIZADA');
    expect(await banco.fila.count()).toBe(0);
  });

  it('trata 200 como sucesso — o servidor já tinha a venda (idempotência)', async () => {
    await fila.enfileirar(venda('v1'));
    const desfecho = await fila.registrarResultado('v1', { status: 200 });

    expect(desfecho).toBe('SINCRONIZADA');
    expect(await banco.fila.count()).toBe(0);
  });

  describe('erro transitório', () => {
    it('agenda retentativa com espera exponencial', async () => {
      await fila.enfileirar(venda('v1'));

      await fila.registrarResultado('v1', { status: null });
      let registro = await banco.fila.get('v1');
      expect(registro!.estado).toBe('AGUARDANDO_RETENTATIVA');
      expect(registro!.proximaTentativaEm).toBe(relogio + 2_000);

      relogio += 2_000;
      await fila.registrarResultado('v1', { status: 503 });
      registro = await banco.fila.get('v1');
      expect(registro!.tentativas).toBe(2);
      expect(registro!.proximaTentativaEm).toBe(relogio + 4_000);
    });

    it('não devolve a venda para envio antes da hora', async () => {
      await fila.enfileirar(venda('v1'));
      await fila.registrarResultado('v1', { status: null });

      expect(await fila.prontasParaEnvio()).toHaveLength(0);

      relogio += 1_999;
      expect(await fila.prontasParaEnvio()).toHaveLength(0);

      relogio += 1;
      expect(await fila.prontasParaEnvio()).toHaveLength(1);
    });

    it('a venda NUNCA é descartada por falha de rede', async () => {
      await fila.enfileirar(venda('v1'));
      for (let tentativa = 0; tentativa < 20; tentativa += 1) {
        relogio += 10 * 60_000;
        await fila.registrarResultado('v1', { status: null });
      }
      expect(await banco.fila.count()).toBe(1);
    });

    it('guarda a última mensagem de erro para diagnóstico', async () => {
      await fila.enfileirar(venda('v1'));
      await fila.registrarResultado('v1', { status: null });
      expect((await banco.fila.get('v1'))!.ultimoErro).toBe('Sem conexão');
    });
  });

  describe('erro permanente', () => {
    it('bloqueia em vez de retentar para sempre', async () => {
      await fila.enfileirar(venda('v1'));
      const desfecho = await fila.registrarResultado('v1', {
        status: 422,
        mensagem: 'Pagamentos não fecham o total',
      });

      expect(desfecho).toBe('BLOQUEADA');
      const registro = await banco.fila.get('v1');
      expect(registro!.estado).toBe('BLOQUEADA');
      expect(registro!.ultimoErro).toBe('Pagamentos não fecham o total');
    });

    it('NÃO descarta a venda — ela existe no mundo real', async () => {
      await fila.enfileirar(venda('v1'));
      await fila.registrarResultado('v1', { status: 422 });
      expect(await banco.fila.count()).toBe(1);
    });

    it('venda bloqueada sai do fluxo automático de reenvio', async () => {
      await fila.enfileirar(venda('v1'));
      await fila.registrarResultado('v1', { status: 403 });

      relogio += 24 * 60 * 60_000; // um dia depois
      expect(await fila.prontasParaEnvio()).toHaveLength(0);
    });

    it('volta ao fluxo apenas por decisão humana', async () => {
      await fila.enfileirar(venda('v1'));
      await fila.registrarResultado('v1', { status: 422 });
      expect(await fila.prontasParaEnvio()).toHaveLength(0);

      await fila.reabilitar('v1');
      expect(await fila.prontasParaEnvio()).toHaveLength(1);
    });
  });

  describe('ordem e resumo', () => {
    it('envia as vendas mais antigas primeiro', async () => {
      await fila.enfileirar(venda('v1'));
      relogio += 60_000;
      await fila.enfileirar(venda('v2'));
      relogio += 60_000;
      await fila.enfileirar(venda('v3'));

      const prontas = await fila.prontasParaEnvio();
      expect(prontas.map((item) => item.id)).toEqual(['v1', 'v2', 'v3']);
    });

    it('respeita o limite de itens por rodada', async () => {
      for (let indice = 0; indice < 15; indice += 1) {
        relogio += 1000;
        await fila.enfileirar(venda(`v${indice}`));
      }
      expect(await fila.prontasParaEnvio(5)).toHaveLength(5);
    });

    it('conta pendentes e bloqueadas para o indicador da tela', async () => {
      await fila.enfileirar(venda('v1'));
      relogio += 1000;
      await fila.enfileirar(venda('v2'));
      relogio += 1000;
      await fila.enfileirar(venda('v3'));

      await fila.registrarResultado('v1', { status: 201 }); // sincronizada
      await fila.registrarResultado('v2', { status: 422 }); // bloqueada

      const resumo = await fila.resumo();
      expect(resumo.pendentes).toBe(1);
      expect(resumo.bloqueadas).toBe(1);
      expect(resumo.total).toBe(2);
    });

    it('lista as bloqueadas para a tela de pendências', async () => {
      await fila.enfileirar(venda('v1', 12_990));
      await fila.registrarResultado('v1', { status: 422, mensagem: 'Sessão fechada' });

      const bloqueadas = await fila.bloqueadas();
      expect(bloqueadas).toHaveLength(1);
      expect(bloqueadas[0]!.totalCentavos).toBe(12_990);
      expect(bloqueadas[0]!.ultimoErro).toBe('Sessão fechada');
    });
  });

  it('resultado de venda inexistente não estoura', async () => {
    expect(await fila.registrarResultado('fantasma', { status: 500 })).toBe('SINCRONIZADA');
  });
});
