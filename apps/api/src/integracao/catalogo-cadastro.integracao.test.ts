/**
 * Cadastro de catálogo, inventário, relatório Z e auditoria — contra o banco real.
 *
 * O que estes testes protegem:
 *
 *   1. Escrever no catálogo é de gerente. Operadora lê, não cadastra nem muda
 *      preço — senão a alçada de desconto não significa nada, porque bastaria
 *      baixar o preço da peça.
 *   2. Mudança de preço vira auditoria. É o registro que responde "por que essa
 *      peça saiu por R$ 40?" depois.
 *   3. Ajuste de inventário LANÇA movimento, nunca escreve saldo. O estoque
 *      continua sendo a soma do livro-razão.
 *   4. No relatório Z, só DINHEIRO entra na conferência da gaveta.
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
let operadoraId: string;

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

const comoGerente = () => ({ authorization: `Bearer ${tokenGerente}` });
const comoOperadora = () => ({ authorization: `Bearer ${tokenOperadora}` });

/** Produto de exemplo com grade de dois tamanhos. */
const PRODUTO_BASE = {
  nome: 'Conjunto Renda',
  marca: 'RM',
  variantes: [
    { sku: 'CJ-RENDA-PRETO-P', tamanho: 'P', cor: 'preto', precoCentavos: 8_990, custoCentavos: 3_000 },
    { sku: 'CJ-RENDA-PRETO-M', tamanho: 'M', cor: 'preto', precoCentavos: 8_990, custoCentavos: 3_000 },
  ],
};

async function criarProdutoBase(): Promise<{ produtoId: string; variantes: { id: string; sku: string }[] }> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/produtos',
    headers: comoGerente(),
    payload: PRODUTO_BASE,
  });
  const corpo = resposta.json() as { id: string; variantes: { id: string; sku: string }[] };
  return { produtoId: corpo.id, variantes: corpo.variantes };
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

  const ana = await prisma.usuario.create({
    data: {
      nome: 'Ana',
      login: 'ana.catalogo',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
    },
  });
  operadoraId = ana.id;
  await prisma.usuario.create({
    data: {
      nome: 'Bia',
      login: 'bia.catalogo',
      senhaHash: await gerarHashSenha('gerente123'),
      papel: 'GERENTE',
    },
  });

  const entrar = async (login: string, senha: string) => {
    const resposta = await app.inject({ method: 'POST', url: '/sessao/login', payload: { login, senha } });
    return (resposta.json() as { token: string }).token;
  };
  tokenOperadora = await entrar('ana.catalogo', 'caixa123');
  tokenGerente = await entrar('bia.catalogo', 'gerente123');
});

describe('cadastro de produto', () => {
  it('cria o produto com a grade inteira numa requisição', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: comoGerente(),
      payload: PRODUTO_BASE,
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json() as { id: string; variantes: unknown[] };
    expect(corpo.variantes).toHaveLength(2);

    const gravadas = await prisma.variante.count({ where: { produtoId: corpo.id } });
    expect(gravadas).toBe(2);
  });

  it('operadora não cadastra produto', async () => {
    // Sem isto, a alçada de desconto não significaria nada: bastaria cadastrar
    // a peça de novo com o preço que se quer praticar.
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: comoOperadora(),
      payload: PRODUTO_BASE,
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('operadora LÊ o catálogo — consultar produto é trabalho de balcão', async () => {
    await criarProdutoBase();
    const resposta = await app.inject({ method: 'GET', url: '/produtos', headers: comoOperadora() });
    expect(resposta.statusCode).toBe(200);
  });

  it('SKU repetido dentro do próprio cadastro é recusado antes de gravar', async () => {
    // Colar a linha e esquecer de trocar o código é o erro mais fácil; o banco
    // só reclamaria da segunda variante, com a primeira já gravada.
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: comoGerente(),
      payload: {
        nome: 'Camisola',
        variantes: [
          { sku: 'IGUAL', tamanho: 'P', precoCentavos: 5_000 },
          { sku: 'IGUAL', tamanho: 'M', precoCentavos: 5_000 },
        ],
      },
    });

    expect(resposta.statusCode).toBe(409);
    expect((resposta.json() as { codigo: string }).codigo).toBe('SKU_EM_USO');
    expect(await prisma.produto.count()).toBe(0);
  });

  it('SKU já usado por outro produto é recusado, dizendo por quem', async () => {
    await criarProdutoBase();
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: comoGerente(),
      payload: {
        nome: 'Outro',
        variantes: [{ sku: 'CJ-RENDA-PRETO-P', precoCentavos: 1_000 }],
      },
    });

    expect(resposta.statusCode).toBe(409);
    expect((resposta.json() as { mensagem: string }).mensagem).toContain('Conjunto Renda');
  });

  it('recusa preço com centavo fracionado — float não entra', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: comoGerente(),
      payload: { nome: 'Body', variantes: [{ sku: 'BODY-1', precoCentavos: 89.9 }] },
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe('alteração de preço', () => {
  it('grava auditoria com o antes e o depois', async () => {
    const { variantes } = await criarProdutoBase();

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/variantes/${variantes[0]!.id}`,
      headers: comoGerente(),
      payload: { precoCentavos: 4_990 },
    });
    expect(resposta.statusCode).toBe(200);

    const registro = await prisma.registroAuditoria.findFirst({
      where: { acao: 'ALTERACAO_PRECO', entidadeId: variantes[0]!.id },
    });
    expect(registro).not.toBeNull();
    expect(registro?.valorAntes).toMatchObject({ precoCentavos: 8_990 });
    expect(registro?.valorDepois).toMatchObject({ precoCentavos: 4_990 });
  });

  it('salvar sem mexer no preço NÃO gera registro de alteração', async () => {
    // Auditoria cheia de linha "nada mudou" é auditoria que ninguém lê.
    const { variantes } = await criarProdutoBase();

    await app.inject({
      method: 'PATCH',
      url: `/variantes/${variantes[0]!.id}`,
      headers: comoGerente(),
      payload: { precoCentavos: 8_990, custoCentavos: 3_500 },
    });

    expect(await prisma.registroAuditoria.count({ where: { acao: 'ALTERACAO_PRECO' } })).toBe(0);
  });

  it('operadora não muda preço', async () => {
    const { variantes } = await criarProdutoBase();
    const resposta = await app.inject({
      method: 'PATCH',
      url: `/variantes/${variantes[0]!.id}`,
      headers: comoOperadora(),
      payload: { precoCentavos: 100 },
    });
    expect(resposta.statusCode).toBe(403);
  });
});

describe('ajuste de inventário', () => {
  async function darEntrada(varianteId: string, quantidade: number): Promise<void> {
    await prisma.movimentoEstoque.create({
      data: { varianteId, tipo: 'ENTRADA_COMPRA', quantidade, usuarioId: operadoraId },
    });
  }

  it('lança o movimento que falta para o saldo bater com a contagem', async () => {
    const { variantes } = await criarProdutoBase();
    const varianteId = variantes[0]!.id;
    await darEntrada(varianteId, 10);

    const resposta = await app.inject({
      method: 'POST',
      url: `/variantes/${varianteId}/inventario`,
      headers: comoGerente(),
      payload: { quantidadeContada: 7, observacao: 'inventário mensal' },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      saldoAnterior: 10,
      saldoNovo: 7,
      diferenca: -3,
      ajustado: true,
    });

    // O saldo continua sendo a SOMA do livro-razão, não um campo escrito.
    const ajuste = await prisma.movimentoEstoque.findFirst({
      where: { varianteId, tipo: 'AJUSTE_INVENTARIO' },
    });
    expect(ajuste?.quantidade).toBe(-3);
  });

  it('contagem que bate não lança movimento, mas fica auditada', async () => {
    const { variantes } = await criarProdutoBase();
    const varianteId = variantes[0]!.id;
    await darEntrada(varianteId, 5);

    const resposta = await app.inject({
      method: 'POST',
      url: `/variantes/${varianteId}/inventario`,
      headers: comoGerente(),
      payload: { quantidadeContada: 5, observacao: 'conferência da arara' },
    });

    expect((resposta.json() as { ajustado: boolean }).ajustado).toBe(false);
    expect(
      await prisma.movimentoEstoque.count({ where: { varianteId, tipo: 'AJUSTE_INVENTARIO' } }),
    ).toBe(0);
    // A conferência que não achou diferença é informação: diz desde quando
    // aquele saldo é confiável.
    expect(await prisma.registroAuditoria.count({ where: { acao: 'AJUSTE_INVENTARIO' } })).toBe(1);
  });

  it('exige motivo — ajuste sem justificativa é como sumiço vira erro de sistema', async () => {
    const { variantes } = await criarProdutoBase();
    const resposta = await app.inject({
      method: 'POST',
      url: `/variantes/${variantes[0]!.id}/inventario`,
      headers: comoGerente(),
      payload: { quantidadeContada: 3, observacao: '' },
    });
    expect(resposta.statusCode).toBe(400);
  });

  it('operadora não ajusta inventário', async () => {
    const { variantes } = await criarProdutoBase();
    const resposta = await app.inject({
      method: 'POST',
      url: `/variantes/${variantes[0]!.id}/inventario`,
      headers: comoOperadora(),
      payload: { quantidadeContada: 3, observacao: 'tentativa' },
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('variante inexistente devolve 404 — aqui ela é o recurso endereçado', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/variantes/${crypto.randomUUID()}/inventario`,
      headers: comoGerente(),
      payload: { quantidadeContada: 1, observacao: 'qualquer' },
    });
    expect(resposta.statusCode).toBe(404);
  });
});

describe('histórico de movimentação', () => {
  it('reconstrói o saldo movimento a movimento, do mais recente para trás', async () => {
    const { variantes } = await criarProdutoBase();
    const varianteId = variantes[0]!.id;

    await prisma.movimentoEstoque.create({
      data: { varianteId, tipo: 'ENTRADA_COMPRA', quantidade: 10, usuarioId: operadoraId },
    });
    await prisma.movimentoEstoque.create({
      data: { varianteId, tipo: 'VENDA', quantidade: -2, usuarioId: operadoraId },
    });

    const resposta = await app.inject({
      method: 'GET',
      url: `/variantes/${varianteId}/movimentacao`,
      headers: comoOperadora(),
    });

    const corpo = resposta.json() as {
      saldoAtual: number;
      movimentos: { quantidade: number; saldoDepois: number }[];
    };
    expect(corpo.saldoAtual).toBe(8);
    // Mais recente primeiro: a venda deixou o saldo em 8, a entrada em 10.
    expect(corpo.movimentos[0]).toMatchObject({ quantidade: -2, saldoDepois: 8 });
    expect(corpo.movimentos[1]).toMatchObject({ quantidade: 10, saldoDepois: 10 });
  });
});

describe('relatório Z', () => {
  it('quebra por forma de pagamento e só conta dinheiro na gaveta', async () => {
    const { variantes } = await criarProdutoBase();
    const terminal = await prisma.terminal.create({ data: { nome: 'Caixa Z' } });
    const sessao = await prisma.sessaoCaixa.create({
      data: { terminalId: terminal.id, operadorId: operadoraId, fundoTrocoCentavos: 10_000 },
    });
    await prisma.movimentoCaixa.create({
      data: {
        sessaoCaixaId: sessao.id,
        tipo: 'ABERTURA',
        valorCentavos: 10_000,
        usuarioId: operadoraId,
      },
    });

    // Uma venda em dinheiro e uma no Pix, de valores diferentes.
    for (const [forma, valor] of [
      ['DINHEIRO', 5_000],
      ['PIX', 7_000],
    ] as const) {
      const venda = await prisma.venda.create({
        data: {
          id: crypto.randomUUID(),
          sessaoCaixaId: sessao.id,
          operadorId: operadoraId,
          subtotalCentavos: valor,
          totalCentavos: valor,
          criadaEmCliente: new Date(),
          itens: {
            create: [
              {
                varianteId: variantes[0]!.id,
                sequencia: 1,
                descricao: 'Conjunto Renda',
                sku: variantes[0]!.sku,
                quantidade: 1,
                precoUnitarioCentavos: valor,
                descontoCentavos: 0,
                totalCentavos: valor,
              },
            ],
          },
          pagamentos: { create: [{ forma, valorCentavos: valor, trocoCentavos: 0 }] },
        },
      });
      if (forma === 'DINHEIRO') {
        await prisma.movimentoCaixa.create({
          data: {
            sessaoCaixaId: sessao.id,
            tipo: 'VENDA_DINHEIRO',
            valorCentavos: valor,
            usuarioId: operadoraId,
            documentoTipo: 'VENDA',
            documentoId: venda.id,
          },
        });
      }
    }

    const resposta = await app.inject({
      method: 'GET',
      url: `/sessoes-caixa/${sessao.id}/relatorio`,
      headers: comoOperadora(),
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json() as {
      vendas: { quantidade: number; totalCentavos: number };
      porForma: { forma: string; totalCentavos: number }[];
      gaveta: { esperadoCentavos: number; vendasEmDinheiroCentavos: number };
    };

    expect(corpo.vendas).toMatchObject({ quantidade: 2, totalCentavos: 12_000 });
    expect(corpo.porForma).toContainEqual({ forma: 'PIX', quantidade: 1, totalCentavos: 7_000 });
    expect(corpo.porForma).toContainEqual({
      forma: 'DINHEIRO',
      quantidade: 1,
      totalCentavos: 5_000,
    });

    /*
     * O Pix NÃO entra no esperado da gaveta: ele vai direto para a conta da
     * loja. Somá-lo faria toda gaveta fechar com sobra fantasma de R$ 70.
     */
    expect(corpo.gaveta.vendasEmDinheiroCentavos).toBe(5_000);
    expect(corpo.gaveta.esperadoCentavos).toBe(15_000);
  });
});

describe('consulta de auditoria', () => {
  it('lista os registros mais recentes primeiro, com quem fez', async () => {
    await criarProdutoBase();

    const resposta = await app.inject({
      method: 'GET',
      url: '/auditoria',
      headers: comoGerente(),
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json() as { itens: { acao: string; usuario: string }[]; total: number };
    expect(corpo.total).toBeGreaterThan(0);
    expect(corpo.itens[0]).toMatchObject({ acao: 'CADASTRO_PRODUTO', usuario: 'Bia' });
  });

  it('filtra por ação', async () => {
    const { variantes } = await criarProdutoBase();
    await app.inject({
      method: 'PATCH',
      url: `/variantes/${variantes[0]!.id}`,
      headers: comoGerente(),
      payload: { precoCentavos: 1_000 },
    });

    const resposta = await app.inject({
      method: 'GET',
      url: '/auditoria?acao=ALTERACAO_PRECO',
      headers: comoGerente(),
    });

    const corpo = resposta.json() as { itens: { acao: string }[] };
    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]?.acao).toBe('ALTERACAO_PRECO');
  });

  it('operadora não consulta auditoria', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/auditoria',
      headers: comoOperadora(),
    });
    expect(resposta.statusCode).toBe(403);
  });

  it('recusa período com data em formato errado', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/auditoria?de=01/09/2026',
      headers: comoGerente(),
    });
    expect(resposta.statusCode).toBe(400);
  });
});
