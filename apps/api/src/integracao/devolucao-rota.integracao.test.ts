/**
 * Teste de ponta a ponta da devolução, contra PostgreSQL real.
 *
 * Foco: (1) devolução PARCIAL de item — 1 de 3 peças iguais, o caso real de
 * moda íntima; (2) nenhum item devolve mais do que o disponível, considerando
 * devoluções anteriores; (3) devolução exige gerente sem alçada de valor;
 * (4) a venda original nunca é alterada; (5) o estorno em dinheiro/PIX sai
 * da gaveta e em cartão/vale-troca não mexe em caixa.
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
  sessao: '44444444-4444-4444-8444-444444444444',
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

let vendaId: string;
let itemVendaId: string;

/** Venda de 3 unidades a R$ 89,90, sem desconto, paga em dinheiro exato. */
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
    data: { id: IDS.sessao, terminalId: IDS.terminal, operadorId: IDS.operadora, fundoTrocoCentavos: 20_000 },
  });

  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({ data: { nome: 'Conjunto Renda', categoriaId: categoria.id } });
  await prisma.variante.create({
    data: { id: IDS.variante, produtoId: produto.id, sku: 'CJ-REN-M', precoCentavos: 8990, custoCentavos: 3500 },
  });
  await prisma.movimentoEstoque.create({
    data: { varianteId: IDS.variante, tipo: 'ENTRADA_COMPRA', quantidade: 10, custoUnitarioCentavos: 3500 },
  });

  vendaId = '77777777-7777-4777-8777-777777777777';
  const venda = await prisma.venda.create({
    data: {
      id: vendaId,
      sessaoCaixaId: IDS.sessao,
      operadorId: IDS.operadora,
      subtotalCentavos: 26_970,
      descontoCentavos: 0,
      totalCentavos: 26_970,
      criadaEmCliente: new Date(),
      itens: {
        create: {
          varianteId: IDS.variante,
          sequencia: 1,
          descricao: 'Conjunto Renda',
          sku: 'CJ-REN-M',
          quantidade: 3,
          precoUnitarioCentavos: 8990,
          descontoCentavos: 0,
          totalCentavos: 26_970,
        },
      },
      pagamentos: { create: { forma: 'DINHEIRO', valorCentavos: 26_970, trocoCentavos: 0 } },
      movimentos: {
        create: { varianteId: IDS.variante, tipo: 'VENDA', quantidade: -3, custoUnitarioCentavos: 3500 },
      },
    },
    include: { itens: true },
  });
  itemVendaId = venda.itens[0]!.id;
}

async function autenticar(): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana', senha: 'caixa123' },
  });
  return resposta.json().token as string;
}

function devolver(corpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/vendas/${vendaId}/devolucao`,
    headers: { authorization: `Bearer ${token}` },
    payload: corpo,
  });
}

async function saldoDe(varianteId: string): Promise<number> {
  const linhas = await prisma.$queryRawUnsafe<{ saldo: number }[]>(
    `SELECT "saldo" FROM "EstoqueAtual" WHERE "varianteId" = $1`,
    varianteId,
  );
  return linhas[0]?.saldo ?? 0;
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

describe('busca de venda por número', () => {
  it('localiza a venda pelo número impresso no comprovante', async () => {
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } });

    const resposta = await app.inject({
      method: 'GET',
      url: `/vendas/por-numero/${venda.numero}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().id).toBe(vendaId);
    expect(resposta.json().totalCentavos).toBe(26_970);
  });

  it('devolve 404 para número que não existe', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/vendas/por-numero/999999',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(404);
  });

  it('recusa número não numérico com 400', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/vendas/por-numero/abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe('busca de venda por código curto do UUID — funciona antes de sincronizar', () => {
  it('localiza pelo prefixo de 8 caracteres do id', async () => {
    const codigo = vendaId.slice(0, 8);
    const resposta = await app.inject({
      method: 'GET',
      url: `/vendas/por-codigo/${codigo}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().id).toBe(vendaId);
  });

  it('a busca é insensível a maiúsculas/minúsculas, como impresso no comprovante', async () => {
    const codigo = vendaId.slice(0, 8).toUpperCase();
    const resposta = await app.inject({
      method: 'GET',
      url: `/vendas/por-codigo/${codigo}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().id).toBe(vendaId);
  });

  it('devolve 404 para código que não existe', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/vendas/por-codigo/ffffffff',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(404);
  });

  it('recusa código com tamanho ou formato inválido', async () => {
    const curtoDemais = await app.inject({
      method: 'GET',
      url: '/vendas/por-codigo/abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(curtoDemais.statusCode).toBe(400);

    const naoHex = await app.inject({
      method: 'GET',
      url: '/vendas/por-codigo/zzzzzzzz',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(naoHex.statusCode).toBe(400);
  });
});

describe('consulta de disponível para devolução', () => {
  it('mostra a quantidade vendida e nada devolvido ainda', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: `/vendas/${vendaId}/disponivel-para-devolucao`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json();
    expect(corpo.itens[0].quantidadeVendida).toBe(3);
    expect(corpo.itens[0].quantidadeJaDevolvida).toBe(0);
  });

  it('devolve 404 para venda inexistente', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: `/vendas/99999999-9999-4999-8999-999999999999/disponivel-para-devolucao`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(404);
  });
});

describe('devolução parcial de item — o caso real: 1 de 3 peças', () => {
  it('devolve 1 unidade, mantém a venda original intacta e repõe o estoque', async () => {
    expect(await saldoDe(IDS.variante)).toBe(7); // 10 - 3 vendidas

    const resposta = await devolver({
      motivo: 'Cliente devolveu 1 peça',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 1 }],
      autorizadoPorId: IDS.gerente,
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().totalCentavos).toBe(8990);

    // A venda original não muda em nada.
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } });
    expect(venda.totalCentavos).toBe(26_970);
    expect(venda.subtotalCentavos).toBe(26_970);

    // 1 peça volta ao estoque.
    expect(await saldoDe(IDS.variante)).toBe(8);
  });

  it('lança a saída de dinheiro da gaveta na sessão atual', async () => {
    const resposta = await devolver({
      motivo: 'Devolução',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 1 }],
      autorizadoPorId: IDS.gerente,
    });

    const movimento = await prisma.movimentoCaixa.findFirstOrThrow({
      where: { documentoId: resposta.json().cancelamentoId, tipo: 'CANCELAMENTO' },
    });
    expect(movimento.valorCentavos).toBe(-8990); // negativo: sai da gaveta
  });

  it('estorno em cartão NÃO lança movimento de caixa', async () => {
    const resposta = await devolver({
      motivo: 'Devolução no cartão',
      formaEstorno: 'CARTAO',
      itens: [{ itemVendaId, quantidade: 1 }],
      autorizadoPorId: IDS.gerente,
    });

    const movimentos = await prisma.movimentoCaixa.count({
      where: { documentoId: resposta.json().cancelamentoId },
    });
    expect(movimentos).toBe(0);
  });

  it('estorno em vale-troca também não mexe em caixa', async () => {
    const resposta = await devolver({
      motivo: 'Vale-troca',
      formaEstorno: 'VALE_TROCA',
      itens: [{ itemVendaId, quantidade: 1 }],
      autorizadoPorId: IDS.gerente,
    });

    const movimentos = await prisma.movimentoCaixa.count({
      where: { documentoId: resposta.json().cancelamentoId },
    });
    expect(movimentos).toBe(0);
  });

  it('registra a devolução em auditoria', async () => {
    const resposta = await devolver({
      motivo: 'Cliente não gostou',
      formaEstorno: 'PIX',
      itens: [{ itemVendaId, quantidade: 2 }],
      autorizadoPorId: IDS.gerente,
    });

    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({
      where: { acao: 'DEVOLUCAO', entidadeId: vendaId },
    });
    expect(auditoria.usuarioId).toBe(IDS.operadora);
    expect(auditoria.autorizadoPorId).toBe(IDS.gerente);
    const depois = auditoria.valorDepois as { totalCentavos: number; cancelamentoId: string };
    expect(depois.totalCentavos).toBe(17_980);
    expect(depois.cancelamentoId).toBe(resposta.json().cancelamentoId);
  });
});

describe('devoluções múltiplas — nunca ultrapassa o disponível', () => {
  it('permite duas devoluções parciais que juntas somam o total vendido', async () => {
    const primeira = await devolver({
      motivo: 'Primeira devolução',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 1 }],
      autorizadoPorId: IDS.gerente,
    });
    expect(primeira.statusCode).toBe(201);

    const segunda = await devolver({
      motivo: 'Segunda devolução',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 2 }],
      autorizadoPorId: IDS.gerente,
    });
    expect(segunda.statusCode).toBe(201);

    expect(await saldoDe(IDS.variante)).toBe(10); // as 3 peças voltaram

    const consulta = await app.inject({
      method: 'GET',
      url: `/vendas/${vendaId}/disponivel-para-devolucao`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(consulta.json().itens[0].quantidadeJaDevolvida).toBe(3);
  });

  it('recusa devolver mais do que o disponível na segunda tentativa', async () => {
    await devolver({
      motivo: 'Primeira devolução',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 2 }],
      autorizadoPorId: IDS.gerente,
    });

    // Só resta 1 disponível; tenta devolver 2 de novo.
    const resposta = await devolver({
      motivo: 'Segunda tentativa além do disponível',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 2 }],
      autorizadoPorId: IDS.gerente,
    });

    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('QUANTIDADE_MAIOR_QUE_DISPONIVEL');
    // O estoque não muda com a devolução recusada.
    expect(await saldoDe(IDS.variante)).toBe(9); // 7 + 2 da primeira devolução
  });
});

describe('autorização de gerente — sem alçada de valor', () => {
  it('bloqueia com 403 quando o autorizador não é gerente, mesmo devolução de 1 peça', async () => {
    const resposta = await devolver({
      motivo: 'Tentativa sem gerente',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 1 }],
      autorizadoPorId: IDS.operadora,
    });

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().codigo).toBe('AUTORIZADOR_SEM_PERMISSAO');
    // Nada foi persistido.
    expect(await prisma.cancelamento.count()).toBe(0);
    expect(await saldoDe(IDS.variante)).toBe(7);
  });

  it('recusa com 400 quando autorizadoPorId não é enviado — obrigatório no esquema', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/vendas/${vendaId}/devolucao`,
      headers: { authorization: `Bearer ${token}` },
      payload: { motivo: 'Sem autorizador', formaEstorno: 'DINHEIRO', itens: [{ itemVendaId, quantidade: 1 }] },
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe('validação de itens', () => {
  it('recusa devolver mais do que foi vendido de uma vez', async () => {
    const resposta = await devolver({
      motivo: 'Tentativa acima do vendido',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 4 }],
      autorizadoPorId: IDS.gerente,
    });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('QUANTIDADE_MAIOR_QUE_DISPONIVEL');
  });

  it('recusa item que não pertence à venda', async () => {
    const resposta = await devolver({
      motivo: 'Item de outra venda',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId: '88888888-8888-4888-8888-888888888888', quantidade: 1 }],
      autorizadoPorId: IDS.gerente,
    });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.json().codigo).toBe('ITEM_INEXISTENTE');
  });

  it('recusa devolução sem itens', async () => {
    const resposta = await devolver({
      motivo: 'Sem itens',
      formaEstorno: 'DINHEIRO',
      itens: [],
      autorizadoPorId: IDS.gerente,
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe('sessão de caixa da venda original', () => {
  it('recusa devolução quando a sessão original já foi fechada', async () => {
    await prisma.sessaoCaixa.update({
      where: { id: IDS.sessao },
      data: { status: 'FECHADA', fechadaEm: new Date() },
    });

    const resposta = await devolver({
      motivo: 'Sessão fechada',
      formaEstorno: 'DINHEIRO',
      itens: [{ itemVendaId, quantidade: 1 }],
      autorizadoPorId: IDS.gerente,
    });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().codigo).toBe('SESSAO_FECHADA');
  });
});
