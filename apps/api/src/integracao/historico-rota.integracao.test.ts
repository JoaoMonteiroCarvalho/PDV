/**
 * Histórico de vendas: listagem paginada e detalhe.
 *
 * É consulta pura, mas a paginação por cursor precisa da mesma garantia do
 * catálogo — nenhuma venda pode sumir ou repetir quando a página é percorrida
 * — e o total devolvido exibido na lista precisa refletir devolução parcial
 * de verdade, não só o campo bruto da venda original (que nunca muda).
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
  const resposta = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login, senha: 'caixa123' },
  });
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

async function listar(query = ''): Promise<{
  itens: Array<{
    id: string;
    numero: number;
    operador: { id: string; nome: string };
    totalCentavos: number;
    quantidadeItens: number;
    formasPagamento: string[];
    totalDevolvidoCentavos: number;
  }>;
  proximoAntesDe: string | null;
  proximoUltimoId: string | null;
  temMais: boolean;
}> {
  const resposta = await app.inject({
    method: 'GET',
    url: `/vendas${query}`,
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
  it('recusa listar sem token', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/vendas' });
    expect(resposta.statusCode).toBe(401);
  });

  it('recusa detalhe sem token', async () => {
    const resposta = await app.inject({ method: 'GET', url: `/vendas/${randomUUID()}` });
    expect(resposta.statusCode).toBe(401);
  });
});

describe('listagem', () => {
  it('lista da venda mais recente para a mais antiga', async () => {
    const primeira = await registrarVenda(token);
    const segunda = await registrarVenda(token);
    const terceira = await registrarVenda(token);

    const pagina = await listar();
    expect(pagina.itens.map((v) => v.id)).toEqual([terceira.vendaId, segunda.vendaId, primeira.vendaId]);
  });

  it('traz total, quantidade de itens e formas de pagamento', async () => {
    await registrarVenda(token, {
      itens: [
        { varianteId: IDS.variante, quantidade: 2, precoUnitarioCentavos: 8990, descontoCentavos: 0 },
      ],
      pagamentos: [
        { forma: 'DINHEIRO', valorCentavos: 10_000, trocoCentavos: 0 },
        { forma: 'PIX', valorCentavos: 7980, trocoCentavos: 0 },
      ],
    });

    const pagina = await listar();
    expect(pagina.itens).toHaveLength(1);
    expect(pagina.itens[0]).toMatchObject({
      totalCentavos: 17_980,
      quantidadeItens: 1,
      totalDevolvidoCentavos: 0,
    });
    expect(pagina.itens[0]!.formasPagamento.sort()).toEqual(['DINHEIRO', 'PIX']);
  });

  it('não expõe formas de pagamento repetidas quando a venda foi dividida na mesma forma', async () => {
    await registrarVenda(token, {
      pagamentos: [
        { forma: 'DINHEIRO', valorCentavos: 4990, trocoCentavos: 0 },
        { forma: 'DINHEIRO', valorCentavos: 4000, trocoCentavos: 0 },
      ],
    });
    const pagina = await listar();
    expect(pagina.itens[0]!.formasPagamento).toEqual(['DINHEIRO']);
  });

  it('filtra por operador', async () => {
    const tokenCarla = await autenticar('carla');
    await registrarVenda(token); // Ana
    await registrarVenda(tokenCarla); // Carla

    const daAna = await listar(`?operadorId=${IDS.operadora}`);
    expect(daAna.itens).toHaveLength(1);
    expect(daAna.itens[0]!.operador.nome).toBe('Ana Souza');

    const daCarla = await listar(`?operadorId=${IDS.operador2}`);
    expect(daCarla.itens).toHaveLength(1);
    expect(daCarla.itens[0]!.operador.nome).toBe('Carla Lima');
  });

  it('filtra por período — janela no futuro não traz nada, janela ampla traz tudo', async () => {
    await registrarVenda(token);

    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const vazia = await listar(`?desde=${encodeURIComponent(amanha)}`);
    expect(vazia.itens).toHaveLength(0);

    const anoPassado = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const cheia = await listar(`?desde=${encodeURIComponent(anoPassado)}`);
    expect(cheia.itens).toHaveLength(1);
  });

  it('percorre todas as páginas sem perder nem repetir venda', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 7; i += 1) {
      const venda = await registrarVenda(token);
      ids.add(venda.vendaId);
    }

    const encontrados = new Set<string>();
    let cursor = '';
    for (let pagina = 0; pagina < 20; pagina += 1) {
      const resultado = await listar(cursor || '?limite=3');
      for (const item of resultado.itens) encontrados.add(item.id);
      if (!resultado.temMais) break;
      cursor = `?limite=3&antesDe=${encodeURIComponent(resultado.proximoAntesDe!)}&ultimoId=${resultado.proximoUltimoId}`;
    }

    expect(encontrados).toEqual(ids);
  });

  it('reflete devolução parcial no total devolvido, sem alterar a venda original', async () => {
    const venda = await registrarVenda(token, {
      itens: [{ varianteId: IDS.variante, quantidade: 3, precoUnitarioCentavos: 8990, descontoCentavos: 0 }],
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 26_970, trocoCentavos: 0 }],
    });

    const detalheAntes = await app.inject({
      method: 'GET',
      url: `/vendas/${venda.vendaId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const itemVendaId = detalheAntes.json().itens[0].id as string;

    const devolucao = await app.inject({
      method: 'POST',
      url: `/vendas/${venda.vendaId}/devolucao`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        motivo: 'Cliente trocou de tamanho',
        formaEstorno: 'DINHEIRO',
        itens: [{ itemVendaId, quantidade: 1 }],
        autorizadoPorId: IDS.gerente,
      },
    });
    expect(devolucao.statusCode).toBe(201);

    const pagina = await listar();
    expect(pagina.itens[0]).toMatchObject({
      id: venda.vendaId,
      totalCentavos: 26_970, // a venda original NUNCA muda
      totalDevolvidoCentavos: 8990,
    });
  });
});

describe('detalhe', () => {
  it('devolve 404 para venda inexistente', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: `/vendas/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(404);
    expect(resposta.json().codigo).toBe('VENDA_INEXISTENTE');
  });

  it('traz itens e pagamentos completos', async () => {
    const venda = await registrarVenda(token, {
      // Desconto exige alçada; Ana não tem limiteDescontoBps neste seed,
      // então só passa com autorização de gerente no nível da venda.
      itens: [
        { varianteId: IDS.variante, quantidade: 2, precoUnitarioCentavos: 8990, descontoCentavos: 500 },
      ],
      pagamentos: [{ forma: 'PIX', valorCentavos: 17_480, trocoCentavos: 0 }],
      autorizadoPorId: IDS.gerente,
    });

    const resposta = await app.inject({
      method: 'GET',
      url: `/vendas/${venda.vendaId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    const detalhe = resposta.json();

    expect(detalhe.numero).toBe(venda.numero);
    expect(detalhe.operador.nome).toBe('Ana Souza');
    expect(detalhe.itens).toHaveLength(1);
    expect(detalhe.itens[0]).toMatchObject({
      sku: 'CJ-REN-M',
      quantidade: 2,
      precoUnitarioCentavos: 8990,
      descontoCentavos: 500,
    });
    expect(detalhe.pagamentos).toEqual([{ forma: 'PIX', valorCentavos: 17_480, trocoCentavos: 0 }]);
    expect(detalhe.devolucoes).toEqual([]);
  });

  it('lista as devoluções já feitas contra a venda, sem alterar os itens originais', async () => {
    const venda = await registrarVenda(token, {
      itens: [{ varianteId: IDS.variante, quantidade: 3, precoUnitarioCentavos: 8990, descontoCentavos: 0 }],
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 26_970, trocoCentavos: 0 }],
    });
    const antes = await app.inject({
      method: 'GET',
      url: `/vendas/${venda.vendaId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const itemVendaId = antes.json().itens[0].id as string;

    await app.inject({
      method: 'POST',
      url: `/vendas/${venda.vendaId}/devolucao`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        motivo: 'Peça com defeito',
        formaEstorno: 'PIX',
        itens: [{ itemVendaId, quantidade: 2 }],
        autorizadoPorId: IDS.gerente,
      },
    });

    const depois = await app.inject({
      method: 'GET',
      url: `/vendas/${venda.vendaId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const detalhe = depois.json();

    expect(detalhe.itens[0].quantidade).toBe(3); // item original intocado
    expect(detalhe.devolucoes).toHaveLength(1);
    expect(detalhe.devolucoes[0]).toMatchObject({
      motivo: 'Peça com defeito',
      formaEstorno: 'PIX',
      valorCentavos: 17_980,
      autorizadoPor: { nome: 'Bia Martins' },
    });
    expect(detalhe.devolucoes[0].itens).toEqual([{ itemVendaId, quantidade: 2, valorCentavos: 17_980 }]);
  });
});
