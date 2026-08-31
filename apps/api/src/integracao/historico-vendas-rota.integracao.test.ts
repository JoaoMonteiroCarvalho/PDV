/**
 * Teste de ponta a ponta do histórico de vendas, contra PostgreSQL real.
 *
 * Existe para o operador localizar uma venda sem precisar do comprovante
 * físico em mãos (cliente sem nota, nota rasgada ou perdida). Cobre:
 *   - listagem básica, mais recente primeiro;
 *   - filtro por sessão de caixa (não misturar turnos diferentes);
 *   - busca por nome de cliente;
 *   - paginação;
 *   - indicador `temDevolucao` calculado a partir de Cancelamento.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let token: string;

const IDS = {
  operadora: '11111111-1111-4111-8111-111111111111',
  gerente: '22222222-2222-4222-8222-222222222222',
  terminal: '33333333-3333-4333-8333-333333333333',
  sessaoA: '44444444-4444-4444-8444-444444444444',
  sessaoB: '44444444-4444-4444-8444-444444444445',
  clienteCarla: '55555555-5555-4555-8555-555555555555',
  clienteBia: '55555555-5555-4555-8555-555555555556',
  variante: '66666666-6666-4666-8666-666666666666',
} as const;

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemCancelamento",
             "ItemVenda", "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

async function semear(): Promise<void> {
  const senha = await gerarHashSenha('caixa123');
  await prisma.usuario.create({
    data: { id: IDS.operadora, nome: 'Ana Souza', login: 'ana', senhaHash: senha, papel: 'OPERADOR' },
  });
  await prisma.usuario.create({
    data: { id: IDS.gerente, nome: 'Bia Martins', login: 'bia', senhaHash: senha, papel: 'GERENTE' },
  });
  await prisma.terminal.create({ data: { id: IDS.terminal, nome: 'Caixa 1' } });
  await prisma.sessaoCaixa.create({
    data: { id: IDS.sessaoA, terminalId: IDS.terminal, operadorId: IDS.operadora, fundoTrocoCentavos: 10_000 },
  });
  await prisma.sessaoCaixa.create({
    data: { id: IDS.sessaoB, terminalId: IDS.terminal, operadorId: IDS.operadora, fundoTrocoCentavos: 10_000 },
  });
  await prisma.cliente.create({ data: { id: IDS.clienteCarla, nome: 'Carla Fernandes', cpf: '11144477735' } });
  await prisma.cliente.create({ data: { id: IDS.clienteBia, nome: 'Bianca Alves', cpf: '22233344455' } });

  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({ data: { nome: 'Conjunto Renda', categoriaId: categoria.id } });
  await prisma.variante.create({
    data: { id: IDS.variante, produtoId: produto.id, sku: 'CJ-REN-M', precoCentavos: 8990, custoCentavos: 3500 },
  });
  await prisma.movimentoEstoque.create({
    data: { varianteId: IDS.variante, tipo: 'ENTRADA_COMPRA', quantidade: 100, custoUnitarioCentavos: 3500 },
  });
}

async function autenticar(): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana', senha: 'caixa123' },
  });
  return resposta.json().token as string;
}

interface OpcoesVenda {
  sessaoCaixaId?: string;
  clienteId?: string;
}

async function criarVenda(opcoes: OpcoesVenda = {}): Promise<string> {
  const id = randomUUID();
  await prisma.venda.create({
    data: {
      id,
      sessaoCaixaId: opcoes.sessaoCaixaId ?? IDS.sessaoA,
      operadorId: IDS.operadora,
      clienteId: opcoes.clienteId ?? null,
      subtotalCentavos: 8990,
      totalCentavos: 8990,
      criadaEmCliente: new Date(),
      itens: {
        create: {
          varianteId: IDS.variante,
          sequencia: 1,
          descricao: 'Conjunto Renda',
          sku: 'CJ-REN-M',
          quantidade: 1,
          precoUnitarioCentavos: 8990,
          totalCentavos: 8990,
        },
      },
      pagamentos: { create: { forma: 'DINHEIRO', valorCentavos: 8990 } },
    },
  });
  return id;
}

function listar(query: string) {
  return app.inject({
    method: 'GET',
    url: `/vendas${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
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
  await semear();
  token = await autenticar();
});

afterAll(async () => {
  await app.close();
});

describe('listagem de vendas', () => {
  it('exige autenticação', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/vendas' });
    expect(resposta.statusCode).toBe(401);
  });

  it('lista vendas sem filtro, mais recente primeiro', async () => {
    const primeira = await criarVenda();
    await new Promise((r) => setTimeout(r, 5));
    const segunda = await criarVenda();

    const resposta = await listar('');
    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json();
    expect(corpo.total).toBe(2);
    expect(corpo.itens.map((v: { id: string }) => v.id)).toEqual([segunda, primeira]);
  });

  it('cada item traz numero, total, operador, cliente e sinalizador de devolução', async () => {
    await criarVenda({ clienteId: IDS.clienteCarla });

    const resposta = await listar('');
    const item = resposta.json().itens[0];
    expect(item.numero).toBeGreaterThan(0);
    expect(item.totalCentavos).toBe(8990);
    expect(item.operador).toBe('Ana Souza');
    expect(item.cliente).toBe('Carla Fernandes');
    expect(item.temDevolucao).toBe(false);
  });

  it('venda sem cliente identificado mostra cliente null, não erro', async () => {
    await criarVenda();
    const resposta = await listar('');
    expect(resposta.json().itens[0].cliente).toBeNull();
  });

  it('filtra por sessão de caixa — não mistura turnos diferentes', async () => {
    await criarVenda({ sessaoCaixaId: IDS.sessaoA });
    await criarVenda({ sessaoCaixaId: IDS.sessaoA });
    await criarVenda({ sessaoCaixaId: IDS.sessaoB });

    const resposta = await listar(`?sessaoCaixaId=${IDS.sessaoA}`);
    expect(resposta.json().total).toBe(2);
  });

  it('busca por nome do cliente, parcial e sem diferenciar maiúsculas', async () => {
    await criarVenda({ clienteId: IDS.clienteCarla }); // Carla Fernandes
    await criarVenda({ clienteId: IDS.clienteBia }); // Bianca Alves
    await criarVenda(); // sem cliente

    const resposta = await listar('?cliente=carla');
    expect(resposta.json().total).toBe(1);
    expect(resposta.json().itens[0].cliente).toBe('Carla Fernandes');
  });

  it('pagina os resultados', async () => {
    for (let i = 0; i < 5; i += 1) {
      await criarVenda();
    }

    const primeiraPagina = await listar('?porPagina=2&pagina=1');
    expect(primeiraPagina.json().itens).toHaveLength(2);
    expect(primeiraPagina.json().totalPaginas).toBe(3);

    const segundaPagina = await listar('?porPagina=2&pagina=2');
    expect(segundaPagina.json().itens).toHaveLength(2);

    const idsPagina1 = primeiraPagina.json().itens.map((v: { id: string }) => v.id);
    const idsPagina2 = segundaPagina.json().itens.map((v: { id: string }) => v.id);
    expect(idsPagina1).not.toEqual(idsPagina2);
  });

  it('sinaliza temDevolucao quando a venda tem um Cancelamento vinculado', async () => {
    const vendaId = await criarVenda();
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId }, include: { itens: true } });

    await prisma.cancelamento.create({
      data: {
        vendaOriginalId: vendaId,
        motivo: 'Cliente não gostou',
        valorCentavos: 8990,
        formaEstorno: 'DINHEIRO',
        usuarioId: IDS.operadora,
        autorizadoPorId: IDS.gerente,
        itens: { create: { itemVendaId: venda.itens[0]!.id, quantidade: 1, valorCentavos: 8990 } },
      },
    });

    const resposta = await listar('');
    expect(resposta.json().itens[0].temDevolucao).toBe(true);
  });

  it('devolve lista vazia quando não há vendas', async () => {
    const resposta = await listar('');
    expect(resposta.json().itens).toEqual([]);
    expect(resposta.json().total).toBe(0);
    expect(resposta.json().totalPaginas).toBe(1);
  });

  it('recusa parâmetros inválidos com 400', async () => {
    const resposta = await listar('?porPagina=0');
    expect(resposta.statusCode).toBe(400);
  });
});
