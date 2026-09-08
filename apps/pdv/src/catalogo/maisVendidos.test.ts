import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteApi, type RelatorioVendas } from '../api/cliente.js';
import { BancoLocal, type ItemCatalogo } from '../banco/local.js';
import {
  atualizarMaisVendidos,
  lerMaisVendidos,
  ordenarPorProduto,
  precisaAtualizar,
} from './maisVendidos.js';

describe('ordenarPorProduto', () => {
  const porSku = new Map([
    ['CJ-P-PRETO', 'p-conjunto'],
    ['CJ-M-PRETO', 'p-conjunto'],
    ['CJ-G-PRETO', 'p-conjunto'],
    ['PF-UNICO', 'p-perfume'],
    ['PJ-M-ROSA', 'p-pijama'],
  ]);

  it('soma as variantes do mesmo produto', () => {
    /*
     * O conjunto vendeu 3+3+3 espalhado na grade; o perfume vendeu 5 num SKU
     * só. Ranquear pelo SKU campeão colocaria o perfume na frente — e diria
     * errado, porque quem mais saiu da loja foi o conjunto.
     */
    const ordem = ordenarPorProduto(
      [
        { sku: 'PF-UNICO', quantidade: 5 },
        { sku: 'CJ-P-PRETO', quantidade: 3 },
        { sku: 'CJ-M-PRETO', quantidade: 3 },
        { sku: 'CJ-G-PRETO', quantidade: 3 },
      ],
      porSku,
    );

    expect(ordem).toEqual(['p-conjunto', 'p-perfume']);
  });

  it('ignora SKU que não está no catálogo local', () => {
    // Produto desativado, ou catálogo ainda sincronizando. Um card que não
    // abre é pior do que um card a menos.
    const ordem = ordenarPorProduto(
      [
        { sku: 'SUMIU-DO-CATALOGO', quantidade: 99 },
        { sku: 'PF-UNICO', quantidade: 2 },
      ],
      porSku,
    );

    expect(ordem).toEqual(['p-perfume']);
  });

  it('em empate, mantém a ordem que o servidor já deu', () => {
    // Sem isso os dois trocariam de lugar entre uma abertura e outra da tela,
    // e o atalho pareceria instável sem nada ter mudado na loja.
    const ordem = ordenarPorProduto(
      [
        { sku: 'PJ-M-ROSA', quantidade: 4 },
        { sku: 'PF-UNICO', quantidade: 4 },
      ],
      porSku,
    );

    expect(ordem).toEqual(['p-pijama', 'p-perfume']);
  });

  it('período sem venda devolve lista vazia, não erro', () => {
    expect(ordenarPorProduto([], porSku)).toEqual([]);
  });
});

describe('precisaAtualizar', () => {
  const agora = new Date('2026-09-08T12:00:00.000Z');

  it('sem cache, precisa', () => {
    expect(precisaAtualizar(null, agora)).toBe(true);
  });

  it('cache fresco não precisa', () => {
    const guardado = { produtoIds: [], calculadoEm: '2026-09-08T09:00:00.000Z' };
    expect(precisaAtualizar(guardado, agora)).toBe(false);
  });

  it('cache vencido precisa', () => {
    const guardado = { produtoIds: [], calculadoEm: '2026-09-08T05:00:00.000Z' };
    expect(precisaAtualizar(guardado, agora)).toBe(true);
  });

  it('data corrompida conta como vencida em vez de quebrar', () => {
    const guardado = { produtoIds: [], calculadoEm: 'não é data' };
    expect(precisaAtualizar(guardado, agora)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

function variante(parcial: Partial<ItemCatalogo> = {}): ItemCatalogo {
  return {
    id: 'v-1',
    produtoId: 'p-conjunto',
    sku: 'CJ-P-PRETO',
    codigoBarras: null,
    nome: 'Conjunto Renda',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: 'P',
    cor: 'Preto',
    precoCentavos: 8990,
    ativo: true,
    saldoEstoque: 4,
    atualizadoEm: '2026-09-01T00:00:00.000Z',
    termos: ['conjunto'],
    ...parcial,
  };
}

function relatorio(
  maisVendidos: RelatorioVendas['maisVendidos'],
): RelatorioVendas {
  return {
    de: '2026-08-09',
    ate: '2026-09-08',
    resumo: {
      quantidadeVendas: 0,
      totalCentavos: 0,
      descontoCentavos: 0,
      ticketMedioCentavos: 0,
      pecasVendidas: 0,
    },
    porDia: [],
    porForma: [],
    maisVendidos,
  };
}

describe('cache no banco local', () => {
  let banco: BancoLocal;

  beforeEach(async () => {
    banco = new BancoLocal(`teste-mais-vendidos-${Math.random()}`);
    await banco.catalogo.bulkAdd([
      variante(),
      variante({ id: 'v-2', sku: 'CJ-M-PRETO', tamanho: 'M' }),
      variante({
        id: 'v-3',
        produtoId: 'p-perfume',
        sku: 'PF-UNICO',
        nome: 'Perfume Sedução',
        tamanho: null,
        cor: null,
      }),
      variante({
        id: 'v-4',
        produtoId: 'p-pijama',
        sku: 'PJ-M-ROSA',
        nome: 'Pijama Cetim',
        cor: 'Rosa',
      }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    banco.close();
  });

  it('sem ranking guardado, devolve vazio — e a tela mostra a mensagem', async () => {
    expect(await lerMaisVendidos(banco)).toEqual([]);
  });

  it('guarda o ranking e devolve os produtos NA ORDEM do ranking', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(
      relatorio([
        { descricao: 'Pijama Cetim', sku: 'PJ-M-ROSA', quantidade: 9, totalCentavos: 1000 },
        { descricao: 'Perfume Sedução', sku: 'PF-UNICO', quantidade: 2, totalCentavos: 100 },
        { descricao: 'Conjunto Renda', sku: 'CJ-P-PRETO', quantidade: 3, totalCentavos: 300 },
        { descricao: 'Conjunto Renda', sku: 'CJ-M-PRETO', quantidade: 3, totalCentavos: 300 },
      ]),
    );

    expect(await atualizarMaisVendidos(banco)).toBe(true);

    // Pijama 9, Conjunto 3+3=6, Perfume 2 — o conjunto passa o perfume por
    // somar a grade, e a ordem do catálogo não interfere.
    const lidos = await lerMaisVendidos(banco);
    expect(lidos.map((p) => p.produtoId)).toEqual(['p-pijama', 'p-conjunto', 'p-perfume']);
  });

  it('não consulta o servidor de novo enquanto o cache está fresco', async () => {
    const consulta = vi
      .spyOn(clienteApi, 'relatorioVendas')
      .mockResolvedValue(relatorio([{ descricao: 'x', sku: 'PF-UNICO', quantidade: 1, totalCentavos: 1 }]));

    await atualizarMaisVendidos(banco, new Date('2026-09-08T12:00:00.000Z'));
    await atualizarMaisVendidos(banco, new Date('2026-09-08T14:00:00.000Z'));

    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it('OFFLINE: mantém o ranking anterior em vez de esvaziar a tela', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(
      relatorio([{ descricao: 'Perfume', sku: 'PF-UNICO', quantidade: 4, totalCentavos: 400 }]),
    );
    await atualizarMaisVendidos(banco, new Date('2026-09-08T00:00:00.000Z'));

    // A rede cai e o cache já venceu: a consulta falha.
    vi.spyOn(clienteApi, 'relatorioVendas').mockRejectedValue(new Error('sem rede'));
    expect(await atualizarMaisVendidos(banco, new Date('2026-09-09T00:00:00.000Z'))).toBe(false);

    // A lista de ontem continua lá — é muito melhor que uma tela vazia.
    expect((await lerMaisVendidos(banco)).map((p) => p.produtoId)).toEqual(['p-perfume']);
  });

  it('mês sem venda APAGA o ranking antigo', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(
      relatorio([{ descricao: 'Perfume', sku: 'PF-UNICO', quantidade: 4, totalCentavos: 400 }]),
    );
    await atualizarMaisVendidos(banco, new Date('2026-09-08T00:00:00.000Z'));

    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(relatorio([]));
    await atualizarMaisVendidos(banco, new Date('2026-09-09T00:00:00.000Z'));

    // Exibir "mais vendidos" de um período que já passou seria mentir.
    expect(await lerMaisVendidos(banco)).toEqual([]);
  });

  it('CATÁLOGO AINDA VAZIO: não grava, para tentar de novo depois', async () => {
    /*
     * O caixa recém-instalado sincroniza o catálogo em segundo plano, e o
     * relatório pode chegar antes dele. Se este caso gravasse a lista vazia,
     * o atalho ficaria congelado pelas próximas seis horas e a operadora
     * passaria o turno sem ele, sem nada explicando por quê.
     */
    const semCatalogo = new BancoLocal(`teste-sem-catalogo-${Math.random()}`);
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(
      relatorio([{ descricao: 'Perfume', sku: 'PF-UNICO', quantidade: 4, totalCentavos: 400 }]),
    );

    expect(await atualizarMaisVendidos(semCatalogo)).toBe(false);
    // Nada guardado: a próxima montagem da tela tenta de novo.
    expect(await semCatalogo.metadados.get('catalogo.maisVendidos')).toBeUndefined();
    semCatalogo.close();
  });

  it('distingue "sem venda" de "sem catálogo" — sem venda GRAVA vazio', async () => {
    // Contraprova do teste acima: se ele gravasse nos dois casos, ou em
    // nenhum, um dos dois comportamentos estaria errado e o outro passaria
    // por acidente.
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(relatorio([]));

    expect(await atualizarMaisVendidos(banco)).toBe(true);
    expect(await banco.metadados.get('catalogo.maisVendidos')).toBeDefined();
  });

  it('produto desativado sai do atalho', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(
      relatorio([{ descricao: 'Perfume', sku: 'PF-UNICO', quantidade: 4, totalCentavos: 400 }]),
    );
    await atualizarMaisVendidos(banco);
    await banco.catalogo.update('v-3', { ativo: false });

    expect(await lerMaisVendidos(banco)).toEqual([]);
  });

  it('respeita o limite de cards', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(
      relatorio([
        { descricao: 'a', sku: 'PJ-M-ROSA', quantidade: 9, totalCentavos: 1 },
        { descricao: 'b', sku: 'CJ-P-PRETO', quantidade: 5, totalCentavos: 1 },
        { descricao: 'c', sku: 'PF-UNICO', quantidade: 2, totalCentavos: 1 },
      ]),
    );
    await atualizarMaisVendidos(banco);

    expect(await lerMaisVendidos(banco, 2)).toHaveLength(2);
  });
});
