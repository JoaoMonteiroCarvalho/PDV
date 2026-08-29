/**
 * Relatório de vendas contra Postgres real.
 *
 * Foco: os totais que aparecem na tela — vendido, devolvido, líquido, ticket
 * médio — batem exatamente com o que foi de fato gravado, e o filtro de
 * período/operador realmente restringe a consulta. A matemática da agregação
 * em si já está coberta a fundo em packages/shared/src/relatorio.test.ts;
 * aqui o que importa é que a consulta Prisma monta os dados certos para ela.
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
  operador2: '22222222-2222-4222-8222-222222222222',
  gerente: '33333333-3333-4333-8333-333333333333',
  terminal: '44444444-4444-4444-8444-444444444444',
  sessao: '55555555-5555-4555-8555-555555555555',
  variante: '66666666-6666-4666-8666-666666666666',
} as const;

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
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
    data: { id: IDS.operador2, nome: 'Carla Lima', login: 'carla', senhaHash: senha, papel: 'OPERADOR' },
  });
  await prisma.usuario.create({
    data: { id: IDS.gerente, nome: 'Bia Martins', login: 'bia', senhaHash: senha, papel: 'GERENTE' },
  });
  await prisma.terminal.create({ data: { id: IDS.terminal, nome: 'Caixa 1' } });
  await prisma.sessaoCaixa.create({
    data: { id: IDS.sessao, terminalId: IDS.terminal, operadorId: IDS.operadora, fundoTrocoCentavos: 20_000 },
  });
  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({ data: { nome: 'Conjunto Renda', categoriaId: categoria.id } });
  await prisma.variante.create({
    data: { id: IDS.variante, produtoId: produto.id, sku: 'CJ-REN-M', precoCentavos: 8990, custoCentavos: 3500 },
  });
  await prisma.movimentoEstoque.create({
    data: { varianteId: IDS.variante, tipo: 'ENTRADA_COMPRA', quantidade: 50, custoUnitarioCentavos: 3500 },
  });
}

async function autenticar(login: string): Promise<string> {
  const resposta = await app.inject({ method: 'POST', url: '/sessao/login', payload: { login, senha: 'caixa123' } });
  expect(resposta.statusCode).toBe(200);
  return resposta.json().token as string;
}

function vendaBase(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    sessaoCaixaId: IDS.sessao,
    criadaEmCliente: new Date().toISOString(),
    itens: [{ varianteId: IDS.variante, quantidade: 1, precoUnitarioCentavos: 8990, descontoCentavos: 0 }],
    pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 8990, trocoCentavos: 0 }],
    ...sobrescrever,
  };
}

async function registrarVenda(
  tokenDoOperador: string,
  sobrescrever: Record<string, unknown> = {},
): Promise<{ vendaId: string; numero: number }> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/vendas',
    headers: { authorization: `Bearer ${tokenDoOperador}` },
    payload: vendaBase(sobrescrever),
  });
  expect(resposta.statusCode).toBe(201);
  return resposta.json();
}

async function relatorio(query = '') {
  const resposta = await app.inject({
    method: 'GET',
    url: `/relatorios/resumo${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(resposta.statusCode).toBe(200);
  return resposta.json();
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
  token = await autenticar('ana');
});

afterAll(async () => {
  await app.close();
});

describe('exige autenticação', () => {
  it('recusa sem token', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/relatorios/resumo' });
    expect(resposta.statusCode).toBe(401);
  });
});

describe('validação', () => {
  it('recusa "desde" posterior a "ate"', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/relatorios/resumo?desde=2026-08-20&ate=2026-08-01',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe('sem argumento', () => {
  it('cobre os últimos 30 dias e não quebra sem venda nenhuma', async () => {
    const dados = await relatorio();
    expect(dados.quantidadeVendas).toBe(0);
    expect(dados.totalVendidoCentavos).toBe(0);
    expect(dados.periodo.desde).toBeDefined();
    expect(dados.periodo.ate).toBeDefined();
  });
});

describe('totais', () => {
  it('reflete exatamente o que foi vendido e devolvido', async () => {
    await registrarVenda(token); // R$ 89,90
    const venda2 = await registrarVenda(token, {
      itens: [{ varianteId: IDS.variante, quantidade: 2, precoUnitarioCentavos: 8990, descontoCentavos: 0 }],
      pagamentos: [{ forma: 'PIX', valorCentavos: 17_980, trocoCentavos: 0 }],
    });

    const detalhe = await app.inject({
      method: 'GET',
      url: `/vendas/${venda2.vendaId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const itemVendaId = detalhe.json().itens[0].id as string;

    await app.inject({
      method: 'POST',
      url: `/vendas/${venda2.vendaId}/devolucao`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        motivo: 'Peça errada',
        formaEstorno: 'PIX',
        itens: [{ itemVendaId, quantidade: 1 }],
        autorizadoPorId: IDS.gerente,
      },
    });

    const dados = await relatorio();
    expect(dados.quantidadeVendas).toBe(2);
    expect(dados.totalVendidoCentavos).toBe(8990 + 17_980);
    expect(dados.totalDevolvidoCentavos).toBe(8990);
    expect(dados.totalLiquidoCentavos).toBe(8990 + 17_980 - 8990);
    expect(dados.quantidadeDevolucoes).toBe(1);
  });

  it('agrupa por operador e por forma de pagamento', async () => {
    const tokenCarla = await autenticar('carla');
    await registrarVenda(token, { pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 8990, trocoCentavos: 0 }] });
    await registrarVenda(tokenCarla, { pagamentos: [{ forma: 'PIX', valorCentavos: 8990, trocoCentavos: 0 }] });

    const dados = await relatorio();
    expect(dados.porOperador).toHaveLength(2);
    expect(dados.porOperador.find((o: { nome: string }) => o.nome === 'Ana Souza')).toMatchObject({
      quantidadeVendas: 1,
      totalCentavos: 8990,
    });
    expect(dados.porFormaPagamento.map((f: { forma: string }) => f.forma).sort()).toEqual(['DINHEIRO', 'PIX']);
  });
});

describe('filtro por operador', () => {
  it('restringe a consulta a um único operador', async () => {
    const tokenCarla = await autenticar('carla');
    await registrarVenda(token);
    await registrarVenda(tokenCarla);
    await registrarVenda(tokenCarla);

    const daAna = await relatorio(`?operadorId=${IDS.operadora}`);
    expect(daAna.quantidadeVendas).toBe(1);

    const daCarla = await relatorio(`?operadorId=${IDS.operador2}`);
    expect(daCarla.quantidadeVendas).toBe(2);
  });
});

describe('filtro por período', () => {
  it('janela no futuro não traz nenhuma venda de hoje', async () => {
    await registrarVenda(token);
    // "ate" tambem precisa ir para o futuro: sem isso, o "ate" default (agora)
    // fica antes do "desde" e a validacao recusa a janela com 400.
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const depoisDeAmanha = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dados = await relatorio(`?desde=${amanha}&ate=${depoisDeAmanha}`);
    expect(dados.quantidadeVendas).toBe(0);
  });

  it('janela ampla no passado traz a venda de hoje', async () => {
    await registrarVenda(token);
    const anoPassado = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dados = await relatorio(`?desde=${anoPassado}`);
    expect(dados.quantidadeVendas).toBe(1);
  });
});

describe('produtos mais vendidos', () => {
  it('traz o SKU e a quantidade agregada no período', async () => {
    await registrarVenda(token, {
      itens: [{ varianteId: IDS.variante, quantidade: 4, precoUnitarioCentavos: 8990, descontoCentavos: 0 }],
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 35_960, trocoCentavos: 0 }],
    });
    const dados = await relatorio();
    expect(dados.produtosMaisVendidos[0]).toMatchObject({ sku: 'CJ-REN-M', quantidadeVendida: 4 });
  });
});

describe('lista de operadores para o filtro', () => {
  it('devolve os operadores ativos', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/operadores',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    const nomes = resposta.json().operadores.map((o: { nome: string }) => o.nome).sort();
    expect(nomes).toEqual(['Ana Souza', 'Bia Martins', 'Carla Lima']);
  });
});
