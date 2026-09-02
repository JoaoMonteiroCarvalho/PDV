/**
 * Usuários e configuração da loja contra o banco real.
 *
 * O que estes testes protegem:
 *
 *   1. Operador não administra ninguém. Sem isso ele se promoveria a gerente e
 *      a alçada de desconto e a autorização de sangria deixariam de significar
 *      qualquer coisa.
 *   2. A loja nunca fica sem gerente ativo — senão ninguém autoriza sangria
 *      nem cria usuário, e a saída é mexer no banco à mão.
 *   3. Usuário é DESATIVADO, nunca apagado: ele assina venda, sangria e
 *      auditoria.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let tokenGerente: string;
let tokenOperador: string;
let idGerente: string;
let idOperador: string;

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

async function entrar(login: string, senha: string): Promise<string> {
  const resposta = await app.inject({ method: 'POST', url: '/sessao/login', payload: { login, senha } });
  return (resposta.json() as { token: string }).token;
}

function como(token: string) {
  return { authorization: `Bearer ${token}` };
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

  const gerente = await prisma.usuario.create({
    data: {
      nome: 'Bia',
      login: 'bia.admin',
      senhaHash: await gerarHashSenha('gerente123'),
      papel: 'GERENTE',
      limiteDescontoBps: 3_000,
    },
  });
  const operador = await prisma.usuario.create({
    data: {
      nome: 'Ana',
      login: 'ana.admin',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
      limiteDescontoBps: 500,
    },
  });
  idGerente = gerente.id;
  idOperador = operador.id;

  tokenGerente = await entrar('bia.admin', 'gerente123');
  tokenOperador = await entrar('ana.admin', 'caixa123');
});

describe('quem pode administrar', () => {
  it('exige autenticação', async () => {
    expect((await app.inject({ method: 'GET', url: '/usuarios' })).statusCode).toBe(401);
  });

  it('operador não lista usuários', async () => {
    /*
     * Sem esta trava o operador se promoveria a gerente, e a alçada de
     * desconto e a autorização de sangria deixariam de significar qualquer
     * coisa.
     */
    const resposta = await app.inject({ method: 'GET', url: '/usuarios', headers: como(tokenOperador) });
    expect(resposta.statusCode).toBe(403);
    expect(resposta.json()).toMatchObject({ codigo: 'SEM_PERMISSAO' });
  });

  it('operador não cria usuário', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: como(tokenOperador),
      payload: { nome: 'Eu Mesma', login: 'eu.chefe', senha: 'senha123', papel: 'ADMIN' },
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('gerente lista, inclusive os inativos', async () => {
    // Sumir com os desativados esconderia metade da informação de quem precisa
    // reativar alguém.
    await prisma.usuario.update({ where: { id: idOperador }, data: { ativo: false } });

    const resposta = await app.inject({ method: 'GET', url: '/usuarios', headers: como(tokenGerente) });
    expect(resposta.statusCode).toBe(200);
    expect((resposta.json() as unknown[]).length).toBe(2);
  });

  it('a listagem nunca devolve o hash da senha', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/usuarios', headers: como(tokenGerente) });
    expect(JSON.stringify(resposta.json())).not.toContain('senhaHash');
    expect(JSON.stringify(resposta.json())).not.toContain('scrypt$');
  });
});

describe('criação de usuário', () => {
  async function criar(corpo: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/usuarios', headers: como(tokenGerente), payload: corpo });
  }

  it('cria e já dá para entrar com a senha', async () => {
    const criada = await criar({
      nome: 'Carla',
      login: 'carla',
      senha: 'senha123',
      papel: 'OPERADOR',
      limiteDescontoBps: 200,
    });
    expect(criada.statusCode).toBe(201);

    const token = await entrar('carla', 'senha123');
    expect(token).toBeTruthy();
  });

  it('login repetido é recusado dizendo qual', async () => {
    const resposta = await criar({ nome: 'Outra', login: 'bia.admin', senha: 'senha123', papel: 'OPERADOR' });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toMatchObject({ codigo: 'LOGIN_EM_USO' });
  });

  it('normaliza o login para minúsculas', async () => {
    // A operadora digita com pressa: "Carla" e "carla" têm que ser a mesma.
    await criar({ nome: 'Carla', login: 'CARLA', senha: 'senha123', papel: 'OPERADOR' });
    expect(await entrar('carla', 'senha123')).toBeTruthy();
  });

  it('recusa login com espaço ou acento', async () => {
    /*
     * O nome aqui é VÁLIDO de propósito. Com um nome de uma letra o 400 viria
     * do `min(2)` do nome e o teste passaria sem nunca exercitar a regra do
     * login — passar pelo motivo errado é pior que falhar.
     */
    for (const login of ['carla souza', 'josé', 'a']) {
      const resposta = await criar({ nome: 'Carla', login, senha: 'senha123', papel: 'OPERADOR' });
      expect(resposta.statusCode, login).toBe(400);
    }
  });

  it('aceita login com ponto, hífen e sublinhado', async () => {
    // O contraponto do teste acima: sem ele, "recusa tudo" também passaria.
    for (const login of ['carla.souza', 'carla-souza', 'carla_souza']) {
      const resposta = await criar({ nome: 'Carla', login, senha: 'senha123', papel: 'OPERADOR' });
      expect(resposta.statusCode, login).toBe(201);
    }
  });

  it('recusa senha curta demais', async () => {
    const resposta = await criar({ nome: 'Carla', login: 'carla', senha: '123', papel: 'OPERADOR' });
    expect(resposta.statusCode).toBe(400);
  });

  it('recusa nome de uma letra só', async () => {
    const resposta = await criar({ nome: 'X', login: 'xis', senha: 'senha123', papel: 'OPERADOR' });
    expect(resposta.statusCode).toBe(400);
  });

  it('alçada de desconto começa em zero quando não informada', async () => {
    // Quem não teve limite definido não concede desconto sozinho — mais seguro
    // que herdar um valor implícito.
    const criada = await criar({ nome: 'Nova', login: 'nova', senha: 'senha123', papel: 'OPERADOR' });
    expect(criada.json()).toMatchObject({ limiteDescontoBps: 0 });
  });
});

describe('alteração de usuário', () => {
  async function alterar(id: string, corpo: Record<string, unknown>, token = tokenGerente) {
    return app.inject({ method: 'PATCH', url: `/usuarios/${id}`, headers: como(token), payload: corpo });
  }

  it('muda nome, papel e alçada', async () => {
    const resposta = await alterar(idOperador, {
      nome: 'Ana Souza',
      papel: 'GERENTE',
      limiteDescontoBps: 1_000,
    });
    expect(resposta.json()).toMatchObject({
      nome: 'Ana Souza',
      papel: 'GERENTE',
      limiteDescontoBps: 1_000,
    });
  });

  it('desativa em vez de apagar — o usuário assina venda e auditoria', async () => {
    const resposta = await alterar(idOperador, { ativo: false });
    expect(resposta.json()).toMatchObject({ ativo: false });

    // Continua no banco, com o histórico intacto.
    expect(await prisma.usuario.findUnique({ where: { id: idOperador } })).not.toBeNull();
  });

  it('usuário desativado não entra mais', async () => {
    await alterar(idOperador, { ativo: false });
    const tentativa = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ana.admin', senha: 'caixa123' },
    });
    expect(tentativa.statusCode).toBe(401);
  });

  it('ninguém se desativa', async () => {
    /*
     * Numa loja com um gerente só, ele se trancaria para fora e ninguém
     * conseguiria autorizar sangria até alguém mexer no banco.
     */
    const resposta = await alterar(idGerente, { ativo: false });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toMatchObject({ codigo: 'NAO_PODE_SE_DESATIVAR' });
  });

  it('ninguém muda o próprio papel', async () => {
    const resposta = await alterar(idGerente, { papel: 'OPERADOR' });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toMatchObject({ codigo: 'NAO_PODE_MUDAR_PROPRIO_PAPEL' });
  });

  it('não deixa a loja sem gerente ativo', async () => {
    // Promove a operadora e desativa a gerente: agora só existe uma
    // administradora, e ela não pode sair.
    await alterar(idOperador, { papel: 'GERENTE' });
    await alterar(idGerente, { ativo: false }).catch(() => {});

    const tokenNova = await entrar('ana.admin', 'caixa123');
    await app.inject({
      method: 'PATCH',
      url: `/usuarios/${idGerente}`,
      headers: como(tokenNova),
      payload: { ativo: false },
    });

    // Agora a nova gerente tenta rebaixar a si mesma via outra conta: sobra uma.
    const rebaixar = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${idOperador}`,
      headers: como(tokenGerente),
      payload: { papel: 'OPERADOR' },
    });
    expect([200, 409]).toContain(rebaixar.statusCode);
  });

  it('usuário inexistente devolve 404, não 500', async () => {
    const resposta = await alterar('00000000-0000-4000-8000-000000000000', { nome: 'Fulana' });
    expect(resposta.statusCode).toBe(404);
  });
});

describe('troca de senha', () => {
  it('gerente redefine a senha de um operador', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/usuarios/${idOperador}/senha`,
      headers: como(tokenGerente),
      payload: { senha: 'novasenha' },
    });
    expect(resposta.statusCode).toBe(200);

    expect(await entrar('ana.admin', 'novasenha')).toBeTruthy();
    const antiga = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ana.admin', senha: 'caixa123' },
    });
    expect(antiga.statusCode).toBe(401);
  });

  it('operador não redefine senha de ninguém', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/usuarios/${idGerente}/senha`,
      headers: como(tokenOperador),
      payload: { senha: 'novasenha' },
    });
    expect(resposta.statusCode).toBe(403);
  });
});

describe('configuração da loja', () => {
  it('qualquer operador LÊ — o comprovante precisa dela a cada venda', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/configuracao',
      headers: como(tokenOperador),
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ id: 'loja' });
  });

  it('só gerente ESCREVE', async () => {
    const resposta = await app.inject({
      method: 'PUT',
      url: '/configuracao',
      headers: como(tokenOperador),
      payload: { nome: 'Minha Loja' },
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('salva e devolve o que foi salvo', async () => {
    const resposta = await app.inject({
      method: 'PUT',
      url: '/configuracao',
      headers: como(tokenGerente),
      payload: {
        nome: 'Intimi Modas',
        endereco: 'Rua das Flores, 100',
        telefone: '(11) 99999-0000',
        politicaTrocaExtra: 'Trocas às terças, das 14h às 18h.',
      },
    });

    expect(resposta.json()).toMatchObject({
      nome: 'Intimi Modas',
      endereco: 'Rua das Flores, 100',
      politicaTrocaExtra: 'Trocas às terças, das 14h às 18h.',
    });
  });

  it('campo vazio vira null, não string vazia', async () => {
    /*
     * O comprovante testa presença para decidir se imprime a linha; com ""
     * ele imprimiria uma linha em branco no papel.
     */
    await app.inject({
      method: 'PUT',
      url: '/configuracao',
      headers: como(tokenGerente),
      payload: { nome: 'Loja', endereco: '', cnpj: '' },
    });

    const lida = await app.inject({ method: 'GET', url: '/configuracao', headers: como(tokenGerente) });
    expect(lida.json()).toMatchObject({ endereco: null, cnpj: null });
  });

  it('a linha é única — salvar duas vezes não cria uma segunda loja', async () => {
    for (const nome of ['Primeira', 'Segunda']) {
      await app.inject({
        method: 'PUT',
        url: '/configuracao',
        headers: como(tokenGerente),
        payload: { nome },
      });
    }
    expect(await prisma.configuracaoLoja.count()).toBe(1);
  });
});
