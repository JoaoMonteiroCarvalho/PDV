/**
 * Ponta a ponta de cliente/crediário, contra PostgreSQL real.
 *
 * Foco: limite disponível é sempre limite cadastrado menos parcelas ABERTAS
 * (nunca uma coluna gravada); recebimento de parcela exige o valor exato e
 * sessão de caixa aberta, entra na gaveta como RECEBIMENTO_CREDIARIO, e
 * quita o título quando a última parcela em aberto é paga.
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

const IDS = {
  operadora: '11111111-1111-4111-8111-111111111111',
  terminal: '33333333-3333-4333-8333-333333333333',
  cliente: '77777777-7777-4777-8777-777777777777',
  sessao: '88888888-8888-4888-8888-888888888888',
  venda: '99999999-9999-4999-8999-999999999999',
  titulo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  parcela1: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  parcela2: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
  await prisma.terminal.create({ data: { id: IDS.terminal, nome: 'Caixa 1' } });
  await prisma.cliente.create({
    data: { id: IDS.cliente, nome: 'Maria Compradora', limiteCrediarioCentavos: 30000 },
  });
  await prisma.sessaoCaixa.create({
    data: { id: IDS.sessao, terminalId: IDS.terminal, operadorId: IDS.operadora, fundoTrocoCentavos: 10000 },
  });
  await prisma.venda.create({
    data: {
      id: IDS.venda,
      sessaoCaixaId: IDS.sessao,
      operadorId: IDS.operadora,
      clienteId: IDS.cliente,
      subtotalCentavos: 20000,
      totalCentavos: 20000,
      criadaEmCliente: new Date(),
    },
  });
  await prisma.tituloCrediario.create({
    data: { id: IDS.titulo, vendaId: IDS.venda, clienteId: IDS.cliente, valorTotalCentavos: 20000 },
  });
  await prisma.parcelaCrediario.create({
    data: { id: IDS.parcela1, tituloId: IDS.titulo, numero: 1, valorCentavos: 10000, vencimento: new Date() },
  });
  await prisma.parcelaCrediario.create({
    data: { id: IDS.parcela2, tituloId: IDS.titulo, numero: 2, valorCentavos: 10000, vencimento: new Date() },
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

function receber(parcelaId: string, corpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/parcelas/${parcelaId}/receber`,
    headers: { authorization: `Bearer ${token}` },
    payload: corpo,
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

describe('cadastro de cliente', () => {
  it('cria e depois atualiza o limite de crediário', async () => {
    const criado = await app.inject({
      method: 'POST',
      url: '/clientes',
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: 'João Comprador', limiteCrediarioCentavos: 15000 },
    });
    expect(criado.statusCode).toBe(201);

    const atualizado = await app.inject({
      method: 'PATCH',
      url: `/clientes/${criado.json().id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { limiteCrediarioCentavos: 25000 },
    });
    expect(atualizado.statusCode).toBe(200);

    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: criado.json().id } });
    expect(cliente.limiteCrediarioCentavos).toBe(25000);
  });

  it('recusa nome vazio', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/clientes',
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: '   ' },
    });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('NOME_OBRIGATORIO');
  });

  it('busca por nome', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/clientes?busca=Maria',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().itens).toHaveLength(1);
    expect(resposta.json().itens[0].nome).toBe('Maria Compradora');
  });
});

describe('crediário', () => {
  it('limite disponível desconta as parcelas em aberto', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: `/clientes/${IDS.cliente}/crediario`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().limiteCrediarioCentavos).toBe(30000);
    expect(resposta.json().emAbertoCentavos).toBe(20000);
    expect(resposta.json().limiteDisponivelCentavos).toBe(10000);
    expect(resposta.json().parcelas).toHaveLength(2);
  });

  it('404 para cliente inexistente', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/clientes/00000000-0000-4000-8000-000000000000/crediario',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(404);
  });

  it('recebe uma parcela, lança RECEBIMENTO_CREDIARIO na gaveta e libera limite', async () => {
    const resposta = await receber(IDS.parcela1, {
      sessaoCaixaId: IDS.sessao,
      valorCentavos: 10000,
      forma: 'DINHEIRO',
    });
    expect(resposta.statusCode).toBe(201);

    const parcela = await prisma.parcelaCrediario.findUniqueOrThrow({ where: { id: IDS.parcela1 } });
    expect(parcela.status).toBe('PAGA');

    const movimento = await prisma.movimentoCaixa.findFirstOrThrow({
      where: { sessaoCaixaId: IDS.sessao, tipo: 'RECEBIMENTO_CREDIARIO' },
    });
    expect(movimento.valorCentavos).toBe(10000);

    const crediario = await app.inject({
      method: 'GET',
      url: `/clientes/${IDS.cliente}/crediario`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(crediario.json().limiteDisponivelCentavos).toBe(20000);

    // título ainda ABERTO: falta a segunda parcela
    const titulo = await prisma.tituloCrediario.findUniqueOrThrow({ where: { id: IDS.titulo } });
    expect(titulo.status).toBe('ABERTO');
  });

  it('quita o título quando a última parcela em aberto é paga', async () => {
    await receber(IDS.parcela1, { sessaoCaixaId: IDS.sessao, valorCentavos: 10000, forma: 'DINHEIRO' });
    await receber(IDS.parcela2, { sessaoCaixaId: IDS.sessao, valorCentavos: 10000, forma: 'PIX' });

    const titulo = await prisma.tituloCrediario.findUniqueOrThrow({ where: { id: IDS.titulo } });
    expect(titulo.status).toBe('QUITADO');
  });

  it('recusa valor diferente do valor exato da parcela', async () => {
    const resposta = await receber(IDS.parcela1, {
      sessaoCaixaId: IDS.sessao,
      valorCentavos: 9000,
      forma: 'DINHEIRO',
    });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('VALOR_DIVERGENTE');
  });

  it('recusa receber parcela já paga', async () => {
    await receber(IDS.parcela1, { sessaoCaixaId: IDS.sessao, valorCentavos: 10000, forma: 'DINHEIRO' });
    const segunda = await receber(IDS.parcela1, {
      sessaoCaixaId: IDS.sessao,
      valorCentavos: 10000,
      forma: 'DINHEIRO',
    });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().codigo).toBe('PARCELA_JA_QUITADA');
  });

  it('404 para parcela inexistente', async () => {
    const resposta = await receber('00000000-0000-4000-8000-000000000000', {
      sessaoCaixaId: IDS.sessao,
      valorCentavos: 10000,
      forma: 'DINHEIRO',
    });
    expect(resposta.statusCode).toBe(404);
  });
});
