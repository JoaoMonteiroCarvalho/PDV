/**
 * Sincronização incremental do catálogo.
 *
 * O caixa tem mais de 10 mil SKUs em IndexedDB. Estes testes garantem que ele
 * consegue montar e manter esse índice sem baixar tudo toda vez, e — mais
 * importante — que a paginação NÃO PULA registros. Um produto que some da
 * página por causa de paginação por offset vira "produto que não existe no
 * caixa" no meio da venda.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let token: string;
let produtoId: string;

interface ItemCatalogo {
  id: string;
  sku: string;
  nome: string;
  precoCentavos: number;
  ativo: boolean;
  atualizadoEm: string;
  tamanho: string | null;
  cor: string | null;
  categoria: string | null;
}

interface RespostaCatalogo {
  itens: ItemCatalogo[];
  proximoDesde: string | null;
  proximoUltimoId: string | null;
  temMais: boolean;
}

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

async function buscarCatalogo(parametros = ''): Promise<RespostaCatalogo> {
  const resposta = await app.inject({
    method: 'GET',
    url: `/catalogo${parametros}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as RespostaCatalogo;
}

/** Percorre todas as páginas como o caixa faria, e devolve o conjunto completo. */
async function sincronizarTudo(desde?: string): Promise<ItemCatalogo[]> {
  const todos: ItemCatalogo[] = [];
  let cursor = desde ? `?desde=${encodeURIComponent(desde)}` : '';
  let limite = '&limite=10';

  for (let pagina = 0; pagina < 100; pagina += 1) {
    const resposta = await buscarCatalogo(
      (cursor || '?') + (cursor ? limite : 'limite=10'),
    );
    todos.push(...resposta.itens);
    if (!resposta.temMais) break;
    cursor = `?desde=${encodeURIComponent(resposta.proximoDesde!)}&ultimoId=${resposta.proximoUltimoId}`;
    limite = '&limite=10';
  }
  return todos;
}

beforeAll(async () => {
  const configuracao = carregarConfiguracao({
    ...process.env,
    JWT_SEGREDO: 'segredo-de-teste-com-mais-de-32-caracteres-aqui',
    NODE_ENV: 'test',
  });
  app = await construirServidor(configuracao, prisma);
  await app.ready();
});

beforeEach(async () => {
  await limparBase();
  await prisma.usuario.create({
    data: { nome: 'Ana', login: 'ana', senhaHash: await gerarHashSenha('caixa123') },
  });
  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({
    data: { nome: 'Conjunto Renda', marca: 'Intimi', categoriaId: categoria.id },
  });
  produtoId = produto.id;

  const login = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana', senha: 'caixa123' },
  });
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
});

async function criarVariantes(quantidade: number): Promise<void> {
  for (let indice = 0; indice < quantidade; indice += 1) {
    await prisma.variante.create({
      data: {
        produtoId,
        sku: `SKU-${String(indice).padStart(4, '0')}`,
        precoCentavos: 1000 + indice,
        custoCentavos: 500,
      },
    });
  }
}

describe('exige autenticação', () => {
  it('recusa acesso ao catálogo sem token', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/catalogo' });
    expect(resposta.statusCode).toBe(401);
  });
});

describe('carga completa', () => {
  it('devolve o catálogo inteiro quando não há marca d\'água', async () => {
    await criarVariantes(3);
    const resposta = await buscarCatalogo();
    expect(resposta.itens).toHaveLength(3);
    expect(resposta.temMais).toBe(false);
  });

  it('traz os dados que o caixa precisa para vender e para buscar', async () => {
    await prisma.variante.create({
      data: {
        produtoId,
        sku: 'CJ-REN-M-PRETO',
        codigoBarras: '7890000000017',
        tamanho: 'M',
        cor: 'Preto',
        precoCentavos: 8990,
        custoCentavos: 3500,
      },
    });

    const resposta = await buscarCatalogo();
    const item = resposta.itens[0]!;
    expect(item.nome).toBe('Conjunto Renda');
    expect(item.sku).toBe('CJ-REN-M-PRETO');
    expect(item.tamanho).toBe('M');
    expect(item.cor).toBe('Preto');
    expect(item.categoria).toBe('Lingerie');
    expect(item.precoCentavos).toBe(8990);
    expect(item.ativo).toBe(true);
  });

  it('não expõe o custo — o caixa não precisa saber a margem', async () => {
    await criarVariantes(1);
    const resposta = await buscarCatalogo();
    expect(resposta.itens[0]).not.toHaveProperty('custoCentavos');
  });
});

describe('paginação por chave', () => {
  it('percorre todas as páginas sem perder nem repetir item', async () => {
    await criarVariantes(25);

    const todos = await sincronizarTudo();
    expect(todos).toHaveLength(25);

    const skus = new Set(todos.map((item) => item.sku));
    expect(skus.size).toBe(25); // nenhum repetido
  });

  it('não pula variantes gravadas no mesmo instante', async () => {
    // Todas com o MESMO atualizadoEm: sem desempate por id, a segunda página
    // pularia registros e produtos sumiriam do caixa.
    const instante = new Date('2026-08-01T12:00:00.000Z');
    for (let indice = 0; indice < 12; indice += 1) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Variante" ("id","produtoId","sku","precoCentavos","custoCentavos","atualizadoEm")
         VALUES (gen_random_uuid()::text, $1, $2, 1000, 500, $3)`,
        produtoId,
        `MESMO-${String(indice).padStart(2, '0')}`,
        instante,
      );
    }

    const todos = await sincronizarTudo();
    expect(todos).toHaveLength(12);
    expect(new Set(todos.map((item) => item.sku)).size).toBe(12);
  });

  it('respeita o limite pedido e sinaliza que há mais', async () => {
    await criarVariantes(15);
    const resposta = await buscarCatalogo('?limite=5');
    expect(resposta.itens).toHaveLength(5);
    expect(resposta.temMais).toBe(true);
    expect(resposta.proximoDesde).not.toBeNull();
  });

  it('recusa limite fora da faixa', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/catalogo?limite=99999',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe('sincronização incremental', () => {
  it('devolve apenas o que mudou depois da marca d\'água', async () => {
    await criarVariantes(5);
    const primeira = await buscarCatalogo();
    const marcaDagua = primeira.proximoDesde!;
    const ultimoId = primeira.proximoUltimoId!;

    // Nada mudou: a sincronização seguinte vem vazia.
    const semMudanca = await buscarCatalogo(
      `?desde=${encodeURIComponent(marcaDagua)}&ultimoId=${ultimoId}`,
    );
    expect(semMudanca.itens).toHaveLength(0);
    expect(semMudanca.temMais).toBe(false);

    // Um produto novo chega na loja.
    await prisma.variante.create({
      data: { produtoId, sku: 'NOVO-001', precoCentavos: 4990, custoCentavos: 2000 },
    });

    const comMudanca = await buscarCatalogo(
      `?desde=${encodeURIComponent(marcaDagua)}&ultimoId=${ultimoId}`,
    );
    expect(comMudanca.itens).toHaveLength(1);
    expect(comMudanca.itens[0]!.sku).toBe('NOVO-001');
  });

  it('reenvia a variante quando o preço muda', async () => {
    const variante = await prisma.variante.create({
      data: { produtoId, sku: 'PRECO-001', precoCentavos: 5000, custoCentavos: 2000 },
    });
    const primeira = await buscarCatalogo();
    const marcaDagua = primeira.proximoDesde!;

    await prisma.variante.update({
      where: { id: variante.id },
      data: { precoCentavos: 5990 },
    });

    const incremental = await buscarCatalogo(`?desde=${encodeURIComponent(marcaDagua)}`);
    expect(incremental.itens).toHaveLength(1);
    expect(incremental.itens[0]!.precoCentavos).toBe(5990);
  });

  it('avisa que a variante foi desativada em vez de omiti-la', async () => {
    const variante = await prisma.variante.create({
      data: { produtoId, sku: 'SAIU-001', precoCentavos: 5000, custoCentavos: 2000 },
    });
    const primeira = await buscarCatalogo();
    const marcaDagua = primeira.proximoDesde!;

    await prisma.variante.update({ where: { id: variante.id }, data: { ativo: false } });

    const incremental = await buscarCatalogo(`?desde=${encodeURIComponent(marcaDagua)}`);
    // Omitir seria pior: o caixa nunca saberia que precisa remover do índice.
    expect(incremental.itens).toHaveLength(1);
    expect(incremental.itens[0]!.ativo).toBe(false);
  });

  it('produto inativo derruba todas as suas variantes', async () => {
    await criarVariantes(3);
    await prisma.produto.update({ where: { id: produtoId }, data: { ativo: false } });

    const resposta = await buscarCatalogo();
    expect(resposta.itens).toHaveLength(3);
    expect(resposta.itens.every((item) => item.ativo === false)).toBe(true);
  });
});
