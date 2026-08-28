/**
 * Teste de ponta a ponta da sessão de caixa: abertura, sangria/suprimento e
 * fechamento, contra PostgreSQL real.
 *
 * O foco: sangria e suprimento SEMPRE exigem gerente (sem alçada de valor,
 * ao contrário do desconto de venda), e o fechamento nunca é bloqueado por
 * divergência — mas ela precisa aparecer em auditoria.
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
  gerente: '22222222-2222-4222-8222-222222222222',
  terminal: '33333333-3333-4333-8333-333333333333',
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
    data: { id: IDS.gerente, nome: 'Bia Martins', login: 'bia', senhaHash: senha, papel: 'GERENTE' },
  });
  await prisma.terminal.create({ data: { id: IDS.terminal, nome: 'Caixa 1' } });
}

async function autenticar(): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana', senha: 'caixa123' },
  });
  return resposta.json().token as string;
}

function abrir(fundoTrocoCentavos = 20_000) {
  return app.inject({
    method: 'POST',
    url: '/sessoes-caixa',
    headers: { authorization: `Bearer ${token}` },
    payload: { terminalId: IDS.terminal, fundoTrocoCentavos },
  });
}

function movimentar(sessaoId: string, corpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/sessoes-caixa/${sessaoId}/movimentos`,
    headers: { authorization: `Bearer ${token}` },
    payload: corpo,
  });
}

function fechar(sessaoId: string, valorContadoCentavos: number) {
  return app.inject({
    method: 'POST',
    url: `/sessoes-caixa/${sessaoId}/fechar`,
    headers: { authorization: `Bearer ${token}` },
    payload: { valorContadoCentavos },
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

describe('abertura de sessão', () => {
  it('abre com o fundo de troco informado e registra o movimento de ABERTURA', async () => {
    const resposta = await abrir(20_000);
    expect(resposta.statusCode).toBe(201);

    const movimento = await prisma.movimentoCaixa.findFirstOrThrow({
      where: { sessaoCaixaId: resposta.json().id, tipo: 'ABERTURA' },
    });
    expect(movimento.valorCentavos).toBe(20_000);
  });

  it('recusa abrir uma segunda sessão no mesmo terminal', async () => {
    await abrir();
    const segunda = await abrir();
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().codigo).toBe('SESSAO_JA_ABERTA');
  });

  it('recusa fundo de troco negativo com 400 na fronteira Zod', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/sessoes-caixa',
      headers: { authorization: `Bearer ${token}` },
      payload: { terminalId: IDS.terminal, fundoTrocoCentavos: -100 },
    });
    expect(resposta.statusCode).toBe(400);
  });

  it('devolve a sessão aberta pelo terminal', async () => {
    const abertura = await abrir(15_000);
    const resposta = await app.inject({
      method: 'GET',
      url: `/sessoes-caixa/aberta?terminalId=${IDS.terminal}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().id).toBe(abertura.json().id);
    expect(resposta.json().saldoEsperadoCentavos).toBe(15_000);
  });

  it('devolve 404 quando não há sessão aberta', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: `/sessoes-caixa/aberta?terminalId=${IDS.terminal}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(404);
  });
});

describe('sangria e suprimento — sempre exigem gerente', () => {
  it('bloqueia sangria sem autorizador com 400 na validação de esquema', async () => {
    const sessao = await abrir();
    const resposta = await movimentar(sessao.json().id, {
      tipo: 'SANGRIA',
      valorCentavos: 5000,
    });
    // autorizadoPorId é obrigatório no esquema: nem chega à regra de negócio.
    expect(resposta.statusCode).toBe(400);
  });

  it('bloqueia com 403 quando o autorizador não é gerente', async () => {
    const sessao = await abrir();
    const resposta = await movimentar(sessao.json().id, {
      tipo: 'SANGRIA',
      valorCentavos: 5000,
      autorizadoPorId: IDS.operadora, // ela mesma, não é gerente
    });
    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().codigo).toBe('AUTORIZADOR_SEM_PERMISSAO');
  });

  it('não existe piso de isenção — até valor pequeno exige gerente', async () => {
    const sessao = await abrir();
    const resposta = await movimentar(sessao.json().id, {
      tipo: 'SANGRIA',
      valorCentavos: 1,
      autorizadoPorId: IDS.operadora,
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('libera sangria com gerente e registra em auditoria', async () => {
    const sessao = await abrir();
    const resposta = await movimentar(sessao.json().id, {
      tipo: 'SANGRIA',
      valorCentavos: 5000,
      observacao: 'Depósito no banco',
      autorizadoPorId: IDS.gerente,
    });
    expect(resposta.statusCode).toBe(201);

    const movimento = await prisma.movimentoCaixa.findUniqueOrThrow({
      where: { id: resposta.json().id },
    });
    expect(movimento.tipo).toBe('SANGRIA');
    expect(movimento.valorCentavos).toBe(-5000); // negativa: sai da gaveta
    expect(movimento.autorizadoPorId).toBe(IDS.gerente);

    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({
      where: { acao: 'SANGRIA', entidadeId: sessao.json().id },
    });
    expect(auditoria.autorizadoPorId).toBe(IDS.gerente);
  });

  it('suprimento entra positivo na gaveta', async () => {
    const sessao = await abrir();
    const resposta = await movimentar(sessao.json().id, {
      tipo: 'SUPRIMENTO',
      valorCentavos: 10_000,
      autorizadoPorId: IDS.gerente,
    });
    expect(resposta.statusCode).toBe(201);

    const movimento = await prisma.movimentoCaixa.findUniqueOrThrow({ where: { id: resposta.json().id } });
    expect(movimento.valorCentavos).toBe(10_000);
  });

  it('recusa movimento em sessão já fechada', async () => {
    const sessao = await abrir();
    await fechar(sessao.json().id, 20_000);

    const resposta = await movimentar(sessao.json().id, {
      tipo: 'SANGRIA',
      valorCentavos: 5000,
      autorizadoPorId: IDS.gerente,
    });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().codigo).toBe('SESSAO_FECHADA');
  });
});

describe('fechamento de sessão', () => {
  it('fecha sem divergência quando o valor contado bate com o esperado', async () => {
    const sessao = await abrir(20_000);
    const resposta = await fechar(sessao.json().id, 20_000);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().diferencaCentavos).toBe(0);

    const auditorias = await prisma.registroAuditoria.count({
      where: { acao: 'DIVERGENCIA_FECHAMENTO_CAIXA' },
    });
    expect(auditorias).toBe(0);
  });

  it('NÃO bloqueia o fechamento quando há divergência — mas audita', async () => {
    const sessao = await abrir(20_000);
    const resposta = await fechar(sessao.json().id, 18_000); // faltam 2000

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().diferencaCentavos).toBe(-2000);

    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({
      where: { acao: 'DIVERGENCIA_FECHAMENTO_CAIXA', entidadeId: sessao.json().id },
    });
    const depois = auditoria.valorDepois as { diferencaCentavos: number };
    expect(depois.diferencaCentavos).toBe(-2000);
  });

  it('considera sangria e suprimento no valor esperado', async () => {
    const sessao = await abrir(20_000);
    await movimentar(sessao.json().id, {
      tipo: 'SANGRIA',
      valorCentavos: 5000,
      autorizadoPorId: IDS.gerente,
    });
    await movimentar(sessao.json().id, {
      tipo: 'SUPRIMENTO',
      valorCentavos: 2000,
      autorizadoPorId: IDS.gerente,
    });

    // Esperado: 20000 (fundo) - 5000 (sangria) + 2000 (suprimento) = 17000
    const resposta = await fechar(sessao.json().id, 17_000);
    expect(resposta.json().valorEsperadoCentavos).toBe(17_000);
    expect(resposta.json().diferencaCentavos).toBe(0);
  });

  it('deixa a sessão FECHADA e recusa fechar de novo', async () => {
    const sessao = await abrir();
    await fechar(sessao.json().id, 20_000);

    const segunda = await fechar(sessao.json().id, 20_000);
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().codigo).toBe('SESSAO_JA_FECHADA');
  });

  it('depois de fechar, a sessão some da consulta de "aberta"', async () => {
    const sessao = await abrir();
    await fechar(sessao.json().id, 20_000);

    const resposta = await app.inject({
      method: 'GET',
      url: `/sessoes-caixa/aberta?terminalId=${IDS.terminal}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(404);
  });

  it('permite abrir uma nova sessão no terminal depois de fechar a anterior', async () => {
    const primeira = await abrir();
    await fechar(primeira.json().id, 20_000);

    const segunda = await abrir(10_000);
    expect(segunda.statusCode).toBe(201);
    expect(segunda.json().id).not.toBe(primeira.json().id);
  });
});
