/**
 * Teste de ponta a ponta da rota de venda, contra PostgreSQL real.
 *
 * O foco é a IDEMPOTÊNCIA. A fila de sincronização do caixa vai reenviar
 * vendas — por timeout, por queda de rede, por retry exponencial. Se o mesmo
 * UUID gerar duas vendas, a loja fecha o caixa com dinheiro sobrando no
 * relatório e faltando na gaveta. Este arquivo existe para garantir que isso
 * não acontece, inclusive sob envio concorrente.
 *
 * Usa `app.inject()` do Fastify: exercita o pipeline HTTP inteiro (rota,
 * validação Zod, JWT, serviço, banco) sem abrir porta de rede.
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
  sessao: '44444444-4444-4444-8444-444444444444',
  cliente: '55555555-5555-4555-8555-555555555555',
  conjunto: '66666666-6666-4666-8666-666666666666',
  perfume: '77777777-7777-4777-8777-777777777777',
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
    data: {
      id: IDS.operadora,
      nome: 'Ana Souza',
      login: 'ana',
      senhaHash: senha,
      papel: 'OPERADOR',
      limiteDescontoBps: 500, // 5%
    },
  });
  await prisma.usuario.create({
    data: {
      id: IDS.gerente,
      nome: 'Bia Martins',
      login: 'bia',
      senhaHash: senha,
      papel: 'GERENTE',
      limiteDescontoBps: 3000,
    },
  });
  await prisma.terminal.create({ data: { id: IDS.terminal, nome: 'Caixa 1' } });
  await prisma.sessaoCaixa.create({
    data: {
      id: IDS.sessao,
      terminalId: IDS.terminal,
      operadorId: IDS.operadora,
      fundoTrocoCentavos: 10_000,
    },
  });
  await prisma.cliente.create({
    data: {
      id: IDS.cliente,
      nome: 'Carla Fernandes',
      cpf: '11144477735',
      limiteCrediarioCentavos: 50_000, // R$ 500,00
    },
  });

  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({
    data: { nome: 'Conjunto Renda Delicada', categoriaId: categoria.id },
  });
  await prisma.variante.create({
    data: {
      id: IDS.conjunto,
      produtoId: produto.id,
      sku: 'CJ-REN-M-PRETO',
      tamanho: 'M',
      cor: 'Preto',
      precoCentavos: 8990,
      custoCentavos: 3500,
    },
  });

  const perfumaria = await prisma.categoria.create({ data: { nome: 'Perfumaria' } });
  const perfume = await prisma.produto.create({
    data: { nome: 'Perfume Sedução 100ml', categoriaId: perfumaria.id },
  });
  await prisma.variante.create({
    data: {
      id: IDS.perfume,
      produtoId: perfume.id,
      sku: 'PF-SED',
      precoCentavos: 18_990,
      custoCentavos: 7900,
    },
  });

  // Estoque inicial pelo livro-razão, como uma compra de verdade.
  await prisma.movimentoEstoque.createMany({
    data: [
      { varianteId: IDS.conjunto, tipo: 'ENTRADA_COMPRA', quantidade: 10, custoUnitarioCentavos: 3500 },
      { varianteId: IDS.perfume, tipo: 'ENTRADA_COMPRA', quantidade: 5, custoUnitarioCentavos: 7900 },
    ],
  });
}

async function autenticar(): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana', senha: 'caixa123' },
  });
  expect(resposta.statusCode).toBe(200);
  return resposta.json().token as string;
}

/** Venda padrão: 1 conjunto de R$ 89,90 pago em dinheiro com troco. */
function vendaBase(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    sessaoCaixaId: IDS.sessao,
    criadaEmCliente: new Date().toISOString(),
    itens: [
      { varianteId: IDS.conjunto, quantidade: 1, precoUnitarioCentavos: 8990, descontoCentavos: 0 },
    ],
    pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 10_000, trocoCentavos: 1010 }],
    ...sobrescrever,
  };
}

function enviarVenda(corpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/vendas',
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

describe('autenticação', () => {
  it('recusa senha errada sem revelar se o login existe', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ana', senha: 'errada' },
    });
    expect(resposta.statusCode).toBe(401);
    expect(resposta.json().codigo).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('devolve a mesma resposta para login inexistente', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ninguem', senha: 'errada' },
    });
    expect(resposta.statusCode).toBe(401);
    expect(resposta.json().codigo).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('devolve o limite de desconto do operador junto do token', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/sessao/login',
      payload: { login: 'ana', senha: 'caixa123' },
    });
    expect(resposta.json().operador.limiteDescontoBps).toBe(500);
  });

  it('recusa venda sem token', async () => {
    const resposta = await app.inject({ method: 'POST', url: '/vendas', payload: vendaBase() });
    expect(resposta.statusCode).toBe(401);
  });
});

describe('registro de venda', () => {
  it('registra a venda e devolve 201 com número sequencial', async () => {
    const resposta = await enviarVenda(vendaBase());
    expect(resposta.statusCode).toBe(201);

    const corpo = resposta.json();
    expect(corpo.totalCentavos).toBe(8990);
    expect(corpo.jaEstavaRegistrada).toBe(false);
    expect(corpo.numero).toBeGreaterThan(0);
  });

  it('grava item com snapshot do catálogo e pagamento', async () => {
    const venda = vendaBase();
    await enviarVenda(venda);

    const registrada = await prisma.venda.findUniqueOrThrow({
      where: { id: venda.id as string },
      include: { itens: true, pagamentos: true, movimentos: true },
    });

    expect(registrada.itens).toHaveLength(1);
    expect(registrada.itens[0]!.descricao).toBe('Conjunto Renda Delicada');
    expect(registrada.itens[0]!.sku).toBe('CJ-REN-M-PRETO');
    expect(registrada.itens[0]!.tamanho).toBe('M');
    expect(registrada.itens[0]!.totalCentavos).toBe(8990);

    expect(registrada.pagamentos[0]!.forma).toBe('DINHEIRO');
    expect(registrada.pagamentos[0]!.trocoCentavos).toBe(1010);
  });

  it('baixa o estoque pelo livro-razão', async () => {
    expect(await saldoDe(IDS.conjunto)).toBe(10);
    await enviarVenda(vendaBase({ itens: [
      { varianteId: IDS.conjunto, quantidade: 3, precoUnitarioCentavos: 8990, descontoCentavos: 0 },
    ], pagamentos: [{ forma: 'DEBITO', valorCentavos: 26_970, trocoCentavos: 0 }] }));
    expect(await saldoDe(IDS.conjunto)).toBe(7);
  });

  it('lança o dinheiro líquido na gaveta, já descontado o troco', async () => {
    const venda = vendaBase();
    await enviarVenda(venda);

    const movimento = await prisma.movimentoCaixa.findFirstOrThrow({
      where: { documentoId: venda.id as string },
    });
    expect(movimento.tipo).toBe('VENDA_DINHEIRO');
    expect(movimento.valorCentavos).toBe(8990); // 100,00 recebidos - 10,10 de troco
  });

  it('não lança movimento de gaveta quando o pagamento é em cartão', async () => {
    const venda = vendaBase({
      pagamentos: [{ forma: 'CREDITO', valorCentavos: 8990, trocoCentavos: 0, bandeira: 'Visa' }],
    });
    await enviarVenda(venda);

    const movimentos = await prisma.movimentoCaixa.count({
      where: { documentoId: venda.id as string },
    });
    expect(movimentos).toBe(0);
  });
});

describe('IDEMPOTÊNCIA — o mesmo UUID nunca vira duas vendas', () => {
  it('reenvio da mesma venda devolve 200 e não duplica', async () => {
    const venda = vendaBase();

    const primeira = await enviarVenda(venda);
    expect(primeira.statusCode).toBe(201);
    expect(primeira.json().jaEstavaRegistrada).toBe(false);

    const segunda = await enviarVenda(venda);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().jaEstavaRegistrada).toBe(true);

    // Mesmo número sequencial: é a MESMA venda, não uma nova.
    expect(segunda.json().numero).toBe(primeira.json().numero);
    expect(await prisma.venda.count()).toBe(1);
  });

  it('cinco reenvios seguidos continuam produzindo uma única venda', async () => {
    const venda = vendaBase();
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      await enviarVenda(venda);
    }

    expect(await prisma.venda.count()).toBe(1);
    expect(await prisma.itemVenda.count()).toBe(1);
    expect(await prisma.pagamento.count()).toBe(1);
    // O estoque foi baixado UMA vez só.
    expect(await saldoDe(IDS.conjunto)).toBe(9);
  });

  it('envios simultâneos não criam venda duplicada', async () => {
    const venda = vendaBase();

    // Dispara em paralelo: simula a fila reenviando enquanto o primeiro envio
    // ainda está em voo. É aqui que uma checagem ingênua de "já existe?" falha.
    const respostas = await Promise.all([
      enviarVenda(venda),
      enviarVenda(venda),
      enviarVenda(venda),
    ]);

    const criadas = respostas.filter((resposta) => resposta.statusCode === 201);
    const reconhecidas = respostas.filter((resposta) => resposta.statusCode === 200);

    expect(criadas).toHaveLength(1);
    expect(reconhecidas).toHaveLength(2);
    expect(await prisma.venda.count()).toBe(1);
    expect(await saldoDe(IDS.conjunto)).toBe(9);
  });

  it('vendas diferentes com o mesmo conteúdo são registradas separadamente', async () => {
    await enviarVenda(vendaBase());
    await enviarVenda(vendaBase());
    expect(await prisma.venda.count()).toBe(2);
  });
});

describe('desconto com alçada', () => {
  it('aceita desconto dentro do limite do operador', async () => {
    // 5% de 89,90 = 4,49 (a operadora pode até 5%)
    const resposta = await enviarVenda(
      vendaBase({
        descontoSobreTotalCentavos: 449,
        pagamentos: [{ forma: 'DEBITO', valorCentavos: 8541, trocoCentavos: 0 }],
      }),
    );
    expect(resposta.statusCode).toBe(201);
  });

  it('bloqueia com 403 desconto acima da alçada sem gerente', async () => {
    const resposta = await enviarVenda(
      vendaBase({
        descontoSobreTotalCentavos: 2000, // ~22%
        pagamentos: [{ forma: 'DEBITO', valorCentavos: 6990, trocoCentavos: 0 }],
      }),
    );
    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().codigo).toBe('DESCONTO_ACIMA_DA_ALCADA');
    expect(await prisma.venda.count()).toBe(0);
  });

  it('libera com gerente e registra o fato na auditoria', async () => {
    const venda = vendaBase({
      descontoSobreTotalCentavos: 2000,
      autorizadoPorId: IDS.gerente,
      pagamentos: [{ forma: 'DEBITO', valorCentavos: 6990, trocoCentavos: 0 }],
    });
    const resposta = await enviarVenda(venda);
    expect(resposta.statusCode).toBe(201);

    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({
      where: { acao: 'DESCONTO_ACIMA_DA_ALCADA', entidadeId: venda.id as string },
    });
    expect(auditoria.usuarioId).toBe(IDS.operadora);
    expect(auditoria.autorizadoPorId).toBe(IDS.gerente);
  });

  it('recusa autorizador que não é gerente', async () => {
    const resposta = await enviarVenda(
      vendaBase({
        descontoSobreTotalCentavos: 2000,
        autorizadoPorId: IDS.operadora, // ela mesma
        pagamentos: [{ forma: 'DEBITO', valorCentavos: 6990, trocoCentavos: 0 }],
      }),
    );
    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().codigo).toBe('AUTORIZADOR_SEM_PERMISSAO');
  });
});

describe('validação de pagamento', () => {
  it('recusa com 422 quando os pagamentos não fecham o total', async () => {
    const resposta = await enviarVenda(
      vendaBase({ pagamentos: [{ forma: 'DEBITO', valorCentavos: 8000, trocoCentavos: 0 }] }),
    );
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('PAGAMENTO_NAO_FECHA');
    expect(await prisma.venda.count()).toBe(0);
  });

  it('recusa troco em cartão — a maquininha é separada', async () => {
    const resposta = await enviarVenda(
      vendaBase({ pagamentos: [{ forma: 'CREDITO', valorCentavos: 10_000, trocoCentavos: 1010 }] }),
    );
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('TROCO_FORA_DE_DINHEIRO');
  });

  it('recusa com 400 valor monetário fracionado — dinheiro é inteiro em centavos', async () => {
    const resposta = await enviarVenda(
      vendaBase({
        itens: [
          { varianteId: IDS.conjunto, quantidade: 1, precoUnitarioCentavos: 89.9, descontoCentavos: 0 },
        ],
      }),
    );
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('ENTRADA_INVALIDA');
  });
});

describe('crediário', () => {
  it('cria título e parcelas cuja soma bate exatamente com o financiado', async () => {
    const venda = vendaBase({
      clienteId: IDS.cliente,
      itens: [
        { varianteId: IDS.conjunto, quantidade: 1, precoUnitarioCentavos: 8990, descontoCentavos: 0 },
      ],
      pagamentos: [{ forma: 'CREDIARIO', valorCentavos: 8990, trocoCentavos: 0 }],
      crediario: { quantidadeParcelas: 3, primeiroVencimento: '2026-09-10T00:00:00.000Z' },
    });

    const resposta = await enviarVenda(venda);
    expect(resposta.statusCode).toBe(201);

    const titulo = await prisma.tituloCrediario.findUniqueOrThrow({
      where: { vendaId: venda.id as string },
      include: { parcelas: { orderBy: { numero: 'asc' } } },
    });

    expect(titulo.valorTotalCentavos).toBe(8990);
    expect(titulo.parcelas).toHaveLength(3);
    // 8990 / 3 = 2996,67 -> a primeira absorve o centavo que sobra.
    expect(titulo.parcelas.map((parcela) => parcela.valorCentavos)).toEqual([2997, 2997, 2996]);
    const soma = titulo.parcelas.reduce((total, parcela) => total + parcela.valorCentavos, 0);
    expect(soma).toBe(8990);
  });

  it('recusa crediário sem cliente identificado', async () => {
    const resposta = await enviarVenda(
      vendaBase({
        pagamentos: [{ forma: 'CREDIARIO', valorCentavos: 8990, trocoCentavos: 0 }],
        crediario: { quantidadeParcelas: 2, primeiroVencimento: '2026-09-10T00:00:00.000Z' },
      }),
    );
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('CREDIARIO_SEM_CLIENTE');
  });

  it('recusa quando o crediário estoura o limite do cliente', async () => {
    const resposta = await enviarVenda(
      vendaBase({
        clienteId: IDS.cliente,
        itens: [
          { varianteId: IDS.perfume, quantidade: 4, precoUnitarioCentavos: 18_990, descontoCentavos: 0 },
        ],
        pagamentos: [{ forma: 'CREDIARIO', valorCentavos: 75_960, trocoCentavos: 0 }],
        crediario: { quantidadeParcelas: 6, primeiroVencimento: '2026-09-10T00:00:00.000Z' },
      }),
    );
    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().codigo).toBe('LIMITE_CREDIARIO_EXCEDIDO');
  });

  it('considera o crediário já em aberto ao avaliar o limite', async () => {
    const primeira = vendaBase({
      clienteId: IDS.cliente,
      itens: [
        { varianteId: IDS.perfume, quantidade: 2, precoUnitarioCentavos: 18_990, descontoCentavos: 0 },
      ],
      pagamentos: [{ forma: 'CREDIARIO', valorCentavos: 37_980, trocoCentavos: 0 }],
      crediario: { quantidadeParcelas: 3, primeiroVencimento: '2026-09-10T00:00:00.000Z' },
    });
    expect((await enviarVenda(primeira)).statusCode).toBe(201);

    // Restam R$ 120,20 de limite; esta tentativa pede R$ 189,90.
    const segunda = vendaBase({
      clienteId: IDS.cliente,
      itens: [
        { varianteId: IDS.perfume, quantidade: 1, precoUnitarioCentavos: 18_990, descontoCentavos: 0 },
      ],
      pagamentos: [{ forma: 'CREDIARIO', valorCentavos: 18_990, trocoCentavos: 0 }],
      crediario: { quantidadeParcelas: 2, primeiroVencimento: '2026-10-10T00:00:00.000Z' },
    });
    const resposta = await enviarVenda(segunda);
    expect(resposta.statusCode).toBe(403);
    expect(resposta.json().codigo).toBe('LIMITE_CREDIARIO_EXCEDIDO');
  });
});

describe('venda offline com preço desatualizado', () => {
  it('aceita a venda e registra a divergência em auditoria, sem recusar', async () => {
    // A venda fechou offline por 79,90; depois o preço subiu para 89,90.
    const venda = vendaBase({
      itens: [
        { varianteId: IDS.conjunto, quantidade: 1, precoUnitarioCentavos: 7990, descontoCentavos: 0 },
      ],
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 7990, trocoCentavos: 0 }],
      criadaEmCliente: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });

    const resposta = await enviarVenda(venda);
    // A cliente já saiu da loja com a sacola: recusar criaria uma venda que
    // existe no mundo real e não no sistema.
    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().totalCentavos).toBe(7990);

    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({
      where: { acao: 'DIVERGENCIA_DE_PRECO', entidadeId: venda.id as string },
    });
    const itens = (auditoria.valorAntes as { itens: { precoPraticadoCentavos: number; precoAtualDoCatalogoCentavos: number }[] }).itens;
    expect(itens[0]!.precoPraticadoCentavos).toBe(7990);
    expect(itens[0]!.precoAtualDoCatalogoCentavos).toBe(8990);
  });

  it('recusa venda com data no futuro — relógio do caixa errado', async () => {
    const resposta = await enviarVenda(
      vendaBase({ criadaEmCliente: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
    );
    expect(resposta.statusCode).toBe(400);
  });
});

describe('sessão de caixa', () => {
  it('recusa venda em sessão já fechada', async () => {
    await prisma.sessaoCaixa.update({
      where: { id: IDS.sessao },
      data: { status: 'FECHADA', fechadaEm: new Date() },
    });

    const resposta = await enviarVenda(vendaBase());
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().codigo).toBe('SESSAO_FECHADA');
  });
});
