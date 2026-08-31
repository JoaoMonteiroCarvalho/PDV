import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BancoLocal, montarTermos, normalizar } from '../banco/local.js';
import {
  CHAVE_MARCA_DAGUA,
  SincronizadorCatalogo,
  buscarProdutos,
  type BuscarPagina,
  type PaginaCatalogo,
} from './sincronizacao.js';

let banco: BancoLocal;

function item(indice: number, sobrescrever: Record<string, unknown> = {}) {
  return {
    id: `id-${indice}`,
    produtoId: `prod-${indice}`,
    sku: `SKU-${indice}`,
    codigoBarras: `789000000${String(indice).padStart(4, '0')}`,
    nome: 'Conjunto Renda Delicada',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: 'M',
    cor: 'Preto',
    precoCentavos: 8990,
    ativo: true,
    saldoEstoque: 5,
    atualizadoEm: `2026-08-0${(indice % 9) + 1}T10:00:00.000Z`,
    ...sobrescrever,
  };
}

beforeEach(async () => {
  banco = new BancoLocal(`teste-cat-${Math.random()}`);
  await banco.open();
});

afterEach(async () => {
  await banco.delete();
});

describe('normalizar() e montarTermos()', () => {
  it('remove acento e caixa para a busca do balcão funcionar', () => {
    expect(normalizar('Biquíni Cortininha')).toBe('biquini cortininha');
    expect(normalizar('  SUTIÃ  ')).toBe('sutia');
  });

  it('gera tokens de nome, marca, categoria, tamanho, cor e SKU', () => {
    const termos = montarTermos({
      nome: 'Conjunto Renda',
      marca: 'Intimi',
      categoria: 'Lingerie',
      tamanho: 'M',
      cor: 'Preto',
      sku: 'CJ-REN-M-PRETO',
    });
    expect(termos).toContain('conjunto');
    expect(termos).toContain('renda');
    expect(termos).toContain('intimi');
    expect(termos).toContain('preto');
    expect(termos).toContain('cj');
  });

  it('não repete token', () => {
    const termos = montarTermos({
      nome: 'Preto Preto',
      marca: null,
      categoria: null,
      tamanho: null,
      cor: 'Preto',
      sku: 'PRETO',
    });
    expect(termos.filter((token) => token === 'preto')).toHaveLength(1);
  });
});

describe('SincronizadorCatalogo', () => {
  it('faz a carga completa em várias páginas', async () => {
    const paginas: PaginaCatalogo[] = [
      { itens: [item(1), item(2)], proximoDesde: '2026-08-02T10:00:00.000Z', proximoUltimoId: 'id-2', temMais: true },
      { itens: [item(3)], proximoDesde: '2026-08-03T10:00:00.000Z', proximoUltimoId: 'id-3', temMais: false },
    ];
    let chamada = 0;
    const sincronizador = new SincronizadorCatalogo(banco, async () => paginas[chamada++]!, 2);

    const resultado = await sincronizador.sincronizar();

    expect(resultado.recebidos).toBe(3);
    expect(resultado.paginas).toBe(2);
    expect(resultado.completa).toBe(true);
    expect(await banco.catalogo.count()).toBe(3);
  });

  it('guarda a marca d\'água e pede só o que mudou na próxima vez', async () => {
    const buscar = vi.fn<BuscarPagina>();
    buscar.mockResolvedValueOnce({
      itens: [item(1)],
      proximoDesde: '2026-08-02T10:00:00.000Z',
      proximoUltimoId: 'id-1',
      temMais: false,
    });

    const sincronizador = new SincronizadorCatalogo(banco, buscar, 500);
    await sincronizador.sincronizar();

    // Primeira chamada: sem marca d'água (carga completa).
    expect(buscar.mock.calls[0]![0].desde).toBeUndefined();
    expect(await banco.metadados.get(CHAVE_MARCA_DAGUA)).toMatchObject({
      valor: '2026-08-02T10:00:00.000Z',
    });

    buscar.mockResolvedValueOnce({ itens: [], proximoDesde: null, proximoUltimoId: null, temMais: false });
    await sincronizador.sincronizar();

    // Segunda: já vai com a marca d'água e o desempate.
    expect(buscar.mock.calls[1]![0].desde).toBe('2026-08-02T10:00:00.000Z');
    expect(buscar.mock.calls[1]![0].ultimoId).toBe('id-1');
  });

  it('continua de onde parou se a rede cair no meio da carga', async () => {
    const buscar = vi.fn<BuscarPagina>();
    buscar.mockResolvedValueOnce({
      itens: [item(1)],
      proximoDesde: '2026-08-01T10:00:00.000Z',
      proximoUltimoId: 'id-1',
      temMais: true,
    });
    buscar.mockRejectedValueOnce(new Error('Failed to fetch'));

    const sincronizador = new SincronizadorCatalogo(banco, buscar, 1);
    await expect(sincronizador.sincronizar()).rejects.toThrow('Failed to fetch');

    // A primeira página já está gravada e a marca d'água também.
    expect(await banco.catalogo.count()).toBe(1);

    buscar.mockResolvedValueOnce({ itens: [item(2)], proximoDesde: null, proximoUltimoId: null, temMais: false });
    await sincronizador.sincronizar();

    expect(buscar.mock.calls[2]![0].desde).toBe('2026-08-01T10:00:00.000Z');
    expect(await banco.catalogo.count()).toBe(2);
  });

  it('atualiza o preço de um item já existente sem duplicar', async () => {
    const sincronizador = new SincronizadorCatalogo(
      banco,
      async () => ({ itens: [item(1)], proximoDesde: null, proximoUltimoId: null, temMais: false }),
    );
    await sincronizador.sincronizar();

    const outro = new SincronizadorCatalogo(banco, async () => ({
      itens: [item(1, { precoCentavos: 9990 })],
      proximoDesde: null,
      proximoUltimoId: null,
      temMais: false,
    }));
    await outro.sincronizar();

    expect(await banco.catalogo.count()).toBe(1);
    expect((await banco.catalogo.get('id-1'))!.precoCentavos).toBe(9990);
  });

  it('remove do índice local o item que veio como inativo', async () => {
    const inicial = new SincronizadorCatalogo(banco, async () => ({
      itens: [item(1), item(2)],
      proximoDesde: null,
      proximoUltimoId: null,
      temMais: false,
    }));
    await inicial.sincronizar();
    expect(await banco.catalogo.count()).toBe(2);

    const desativa = new SincronizadorCatalogo(banco, async () => ({
      itens: [item(1, { ativo: false })],
      proximoDesde: null,
      proximoUltimoId: null,
      temMais: false,
    }));
    const resultado = await desativa.sincronizar();

    expect(resultado.removidos).toBe(1);
    expect(await banco.catalogo.count()).toBe(1);
    expect(await banco.catalogo.get('id-1')).toBeUndefined();
  });

  it('para no limite de páginas para não travar o caixa em carga gigante', async () => {
    const sincronizador = new SincronizadorCatalogo(banco, async () => ({
      itens: [item(1)],
      proximoDesde: '2026-08-01T10:00:00.000Z',
      proximoUltimoId: 'id-1',
      temMais: true, // nunca acaba
    }));

    const resultado = await sincronizador.sincronizar(3);
    expect(resultado.paginas).toBe(3);
    expect(resultado.completa).toBe(false);
  });
});

describe('buscarProdutos()', () => {
  beforeEach(async () => {
    const sincronizador = new SincronizadorCatalogo(banco, async () => ({
      itens: [
        item(1, { id: 'a', sku: 'CJ-REN-M-PRETO', nome: 'Conjunto Renda Delicada', cor: 'Preto', codigoBarras: '7890000000017' }),
        item(2, { id: 'b', sku: 'CJ-REN-G-VERM', nome: 'Conjunto Renda Delicada', cor: 'Vermelho', tamanho: 'G', codigoBarras: '7890000000024' }),
        item(3, { id: 'c', sku: 'PJ-CET-M-VINHO', nome: 'Pijama Cetim', cor: 'Vinho', categoria: 'Pijamas', codigoBarras: '7890000000031' }),
        item(4, { id: 'd', sku: 'BQ-CORT-P', nome: 'Biquíni Cortininha', cor: 'Verde', categoria: 'Moda Praia', codigoBarras: '7890000000048' }),
      ],
      proximoDesde: null,
      proximoUltimoId: null,
      temMais: false,
    }));
    await sincronizador.sincronizar();
  });

  it('devolve vazio para busca em branco', async () => {
    expect(await buscarProdutos(banco, '')).toEqual([]);
    expect(await buscarProdutos(banco, '   ')).toEqual([]);
  });

  it('encontra pelo código de barras — o caminho do leitor', async () => {
    const encontrados = await buscarProdutos(banco, '7890000000031');
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0]!.nome).toBe('Pijama Cetim');
  });

  it('encontra pelo SKU digitado', async () => {
    const encontrados = await buscarProdutos(banco, 'cj-ren-m-preto');
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0]!.id).toBe('a');
  });

  it('encontra por parte do nome, ignorando acento', async () => {
    const encontrados = await buscarProdutos(banco, 'biquini');
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0]!.id).toBe('d');
  });

  it('exige que TODOS os termos casem — busca conjuntiva', async () => {
    // "renda preto" não pode trazer os dois conjuntos de renda.
    const encontrados = await buscarProdutos(banco, 'renda preto');
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0]!.id).toBe('a');
  });

  it('busca por prefixo, para achar enquanto digita', async () => {
    const encontrados = await buscarProdutos(banco, 'conj');
    expect(encontrados).toHaveLength(2);
  });

  it('devolve vazio quando nenhum item casa com todos os termos', async () => {
    expect(await buscarProdutos(banco, 'renda amarelo')).toEqual([]);
  });

  it('encontra pela categoria', async () => {
    const encontrados = await buscarProdutos(banco, 'pijamas');
    expect(encontrados).toHaveLength(1);
  });
});
