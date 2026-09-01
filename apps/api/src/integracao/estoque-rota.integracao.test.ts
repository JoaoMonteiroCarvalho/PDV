/**
 * Entrada de estoque contra o banco real.
 *
 * O que estes testes protegem:
 *
 *   1. O saldo sai da SOMA dos movimentos, nunca de um número escrito.
 *   2. A mesma nota lançada duas vezes é RECUSADA — dobrar estoque é o erro
 *      mais provável aqui e o mais caro de descobrir.
 *   3. Uma variante inexistente no meio da lista não deixa metade entrar.
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

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

async function criarVariante(sku: string) {
  return prisma.variante.create({
    data: { produtoId, sku, precoCentavos: 8_990, custoCentavos: 3_000 },
  });
}

async function saldoDe(varianteId: string): Promise<number> {
  const linhas = await prisma.$queryRaw<{ saldo: number }[]>`
    SELECT "saldo" FROM "EstoqueAtual" WHERE "varianteId" = ${varianteId}
  `;
  return linhas[0]?.saldo ?? 0;
}

async function darEntrada(corpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/estoque/entrada',
    headers: { authorization: `Bearer ${token}` },
    payload: corpo,
  });
}

beforeAll(async () => {
  app = await construirServidor(carregarConfiguracao());
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBase();

  await prisma.usuario.create({
    data: {
      nome: 'Ana',
      login: 'ana.estoque',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
    },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana.estoque', senha: 'caixa123' },
  });
  token = (login.json() as { token: string }).token;

  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({
    data: { nome: 'Conjunto Renda', categoriaId: categoria.id },
  });
  produtoId = produto.id;
});

describe('entrada de estoque', () => {
  it('exige autenticação', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/estoque/entrada',
      payload: { itens: [] },
    });
    expect(resposta.statusCode).toBe(401);
  });

  it('soma no saldo em vez de escrever um número', async () => {
    const variante = await criarVariante('CJ-1');

    const resposta = await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 12, custoUnitarioCentavos: 2_550 }],
      documento: 'NF-1123',
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toEqual({ movimentos: 1, pecas: 12 });
    expect(await saldoDe(variante.id)).toBe(12);
  });

  it('duas entradas seguidas acumulam — é livro-razão', async () => {
    const variante = await criarVariante('CJ-1');
    await darEntrada({ itens: [{ varianteId: variante.id, quantidade: 5, custoUnitarioCentavos: 100 }] });
    await darEntrada({ itens: [{ varianteId: variante.id, quantidade: 3, custoUnitarioCentavos: 100 }] });

    expect(await saldoDe(variante.id)).toBe(8);
  });

  it('atualiza o custo da variante para o da última nota', async () => {
    // É o método que a loja usa na prática: "quanto paguei da última vez".
    const variante = await criarVariante('CJ-1');
    await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 1, custoUnitarioCentavos: 4_100 }],
    });

    const depois = await prisma.variante.findUniqueOrThrow({ where: { id: variante.id } });
    expect(depois.custoCentavos).toBe(4_100);
  });

  it('custo zero não apaga o custo cadastrado', async () => {
    // Brinde e bonificação chegam com valor zero na nota; sobrescrever o custo
    // com zero destruiria a apuração de margem daquele produto.
    const variante = await criarVariante('CJ-1');
    await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 2, custoUnitarioCentavos: 0 }],
    });

    const depois = await prisma.variante.findUniqueOrThrow({ where: { id: variante.id } });
    expect(depois.custoCentavos).toBe(3_000);
    expect(await saldoDe(variante.id)).toBe(2);
  });

  it('grava auditoria com quem lançou e quanto', async () => {
    const variante = await criarVariante('CJ-1');
    await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 7, custoUnitarioCentavos: 100 }],
      documento: 'NF-77',
    });

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: { acao: 'ENTRADA_ESTOQUE' },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria!.entidadeId).toBe('NF-77');
    expect(auditoria!.valorDepois).toMatchObject({ pecas: 7, itens: 1 });
  });
});

describe('idempotência por documento', () => {
  it('a mesma nota duas vezes é recusada, não duplicada', async () => {
    /*
     * A operadora clica de novo achando que não foi. Sem esta trava, o estoque
     * dobra e o erro só aparece quando a arara não bate — semanas depois.
     */
    const variante = await criarVariante('CJ-1');
    const corpo = {
      itens: [{ varianteId: variante.id, quantidade: 10, custoUnitarioCentavos: 100 }],
      documento: 'NF-1123',
    };

    expect((await darEntrada(corpo)).statusCode).toBe(201);

    const segunda = await darEntrada(corpo);
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json()).toMatchObject({ codigo: 'DOCUMENTO_JA_LANCADO' });
    expect(await saldoDe(variante.id)).toBe(10);
  });

  it('notas diferentes passam normalmente', async () => {
    const variante = await criarVariante('CJ-1');
    await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 4, custoUnitarioCentavos: 100 }],
      documento: 'NF-1',
    });
    const outra = await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 6, custoUnitarioCentavos: 100 }],
      documento: 'NF-2',
    });

    expect(outra.statusCode).toBe(201);
    expect(await saldoDe(variante.id)).toBe(10);
  });

  it('entrada sem documento não é bloqueada por outra sem documento', async () => {
    // Ajuste manual não tem nota; travar dois deles seria travar o trabalho.
    const variante = await criarVariante('CJ-1');
    await darEntrada({ itens: [{ varianteId: variante.id, quantidade: 1, custoUnitarioCentavos: 0 }] });
    const segunda = await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 1, custoUnitarioCentavos: 0 }],
    });

    expect(segunda.statusCode).toBe(201);
    expect(await saldoDe(variante.id)).toBe(2);
  });
});

describe('recusas', () => {
  it('variante inexistente não deixa metade entrar', async () => {
    /*
     * Entrada pela metade seria pior que entrada nenhuma: a operadora veria
     * "deu erro", mandaria de novo, e as linhas que passaram entrariam em
     * dobro.
     */
    const boa = await criarVariante('CJ-1');
    const resposta = await darEntrada({
      itens: [
        { varianteId: boa.id, quantidade: 5, custoUnitarioCentavos: 100 },
        {
          varianteId: '00000000-0000-4000-8000-000000000000',
          quantidade: 5,
          custoUnitarioCentavos: 100,
        },
      ],
    });

    expect(resposta.statusCode).toBe(422);
    expect(resposta.json()).toMatchObject({ codigo: 'VARIANTE_INEXISTENTE' });
    expect(await saldoDe(boa.id)).toBe(0);
  });

  it('recusa quantidade fracionária', async () => {
    // Esta loja vende peça; fração só criaria saldo que ninguém confere na arara.
    const variante = await criarVariante('CJ-1');
    const resposta = await darEntrada({
      itens: [{ varianteId: variante.id, quantidade: 1.5, custoUnitarioCentavos: 100 }],
    });
    expect(resposta.statusCode).toBe(400);
  });

  it('recusa quantidade zero ou negativa', async () => {
    const variante = await criarVariante('CJ-1');
    for (const quantidade of [0, -3]) {
      const resposta = await darEntrada({
        itens: [{ varianteId: variante.id, quantidade, custoUnitarioCentavos: 100 }],
      });
      expect(resposta.statusCode).toBe(400);
    }
  });

  it('recusa lista vazia', async () => {
    expect((await darEntrada({ itens: [] })).statusCode).toBe(400);
  });
});
