/**
 * Ponta a ponta de gestão de operadores, contra PostgreSQL real.
 *
 * Foco: criar/editar operador é permissão PERMANENTE do cargo (gerente ou
 * admin) — sem overlay de autorização pontual como sangria; login duplicado
 * é recusado; login continua funcionando com a senha nova depois de um reset.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let tokenOperadora: string;
let tokenGerente: string;

const IDS = {
  operadora: '11111111-1111-4111-8111-111111111111',
  gerente: '22222222-2222-4222-8222-222222222222',
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
}

async function login(loginUsuario: string): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: loginUsuario, senha: 'caixa123' },
  });
  return resposta.json().token as string;
}

function criarOperadorComo(token: string, corpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/operadores',
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
  tokenOperadora = await login('ana');
  tokenGerente = await login('bia');
});

afterAll(async () => {
  await app.close();
});

describe('criação de operador', () => {
  it('gerente cria um novo operador', async () => {
    const resposta = await criarOperadorComo(tokenGerente, {
      nome: 'Carla Nova',
      login: 'carla',
      senha: 'senha123',
      papel: 'OPERADOR',
    });
    expect(resposta.statusCode).toBe(201);

    const criado = await prisma.usuario.findUniqueOrThrow({ where: { id: resposta.json().id } });
    expect(criado.login).toBe('carla');
    expect(criado.papel).toBe('OPERADOR');
  });

  it('operador comum NÃO pode criar outro operador', async () => {
    const resposta = await criarOperadorComo(tokenOperadora, {
      nome: 'Carla Nova',
      login: 'carla',
      senha: 'senha123',
    });
    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().codigo).toBe('SEM_PERMISSAO');
  });

  it('recusa login duplicado', async () => {
    const resposta = await criarOperadorComo(tokenGerente, {
      nome: 'Outra Ana',
      login: 'ana',
      senha: 'senha123',
    });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().codigo).toBe('LOGIN_EM_USO');
  });

  it('recusa senha curta já na fronteira Zod, antes de bater no banco', async () => {
    const resposta = await criarOperadorComo(tokenGerente, {
      nome: 'Carla Nova',
      login: 'carla',
      senha: '123',
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('ENTRADA_INVALIDA');
  });
});

describe('atualização de operador', () => {
  it('gerente desativa um operador', async () => {
    const resposta = await app.inject({
      method: 'PATCH',
      url: `/operadores/${IDS.operadora}`,
      headers: { authorization: `Bearer ${tokenGerente}` },
      payload: { ativo: false },
    });
    expect(resposta.statusCode).toBe(200);

    const login2 = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ana', senha: 'caixa123' },
    });
    expect(login2.statusCode).toBe(401);
  });

  it('gerente redefine a senha e o login passa a exigir a senha nova', async () => {
    const resposta = await app.inject({
      method: 'PATCH',
      url: `/operadores/${IDS.operadora}`,
      headers: { authorization: `Bearer ${tokenGerente}` },
      payload: { novaSenha: 'nova-senha-123' },
    });
    expect(resposta.statusCode).toBe(200);

    const comSenhaAntiga = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ana', senha: 'caixa123' },
    });
    expect(comSenhaAntiga.statusCode).toBe(401);

    const comSenhaNova = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ana', senha: 'nova-senha-123' },
    });
    expect(comSenhaNova.statusCode).toBe(200);
  });

  it('operador comum não pode editar ninguém', async () => {
    const resposta = await app.inject({
      method: 'PATCH',
      url: `/operadores/${IDS.gerente}`,
      headers: { authorization: `Bearer ${tokenOperadora}` },
      payload: { limiteDescontoBps: 9999 },
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('404 para operador inexistente', async () => {
    const resposta = await app.inject({
      method: 'PATCH',
      url: '/operadores/00000000-0000-4000-8000-000000000000',
      headers: { authorization: `Bearer ${tokenGerente}` },
      payload: { nome: 'X' },
    });
    expect(resposta.statusCode).toBe(404);
  });
});

describe('listagem de operadores', () => {
  it('por padrão traz só ativos', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/operadores/${IDS.operadora}`,
      headers: { authorization: `Bearer ${tokenGerente}` },
      payload: { ativo: false },
    });

    const resposta = await app.inject({
      method: 'GET',
      url: '/operadores',
      headers: { authorization: `Bearer ${tokenGerente}` },
    });
    const nomes = resposta.json().operadores.map((o: { nome: string }) => o.nome);
    expect(nomes).not.toContain('Ana Souza');
  });

  it('?todos=true traz também os inativos', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/operadores/${IDS.operadora}`,
      headers: { authorization: `Bearer ${tokenGerente}` },
      payload: { ativo: false },
    });

    const resposta = await app.inject({
      method: 'GET',
      url: '/operadores?todos=true',
      headers: { authorization: `Bearer ${tokenGerente}` },
    });
    const nomes = resposta.json().operadores.map((o: { nome: string }) => o.nome);
    expect(nomes).toContain('Ana Souza');
  });
});
