/**
 * Relatório de vendas contra o banco real.
 *
 * O que estes testes protegem:
 *
 *   1. O recorte é o DIA DA LOJA, local. Com corte em UTC, no Brasil toda
 *      venda depois das 21h cairia no dia seguinte.
 *   2. Venda cancelada não conta como faturamento — o registro continua no
 *      banco, mas não infla o relatório.
 *   3. O total por forma de pagamento é LÍQUIDO do troco, senão a soma das
 *      formas não fecha com o total das vendas.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';
import type { RelatorioVendas } from '../servicos/relatorio.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let token: string;
let sessaoCaixaId: string;
let operadorId: string;
let varianteId: string;

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

interface VendaDeTeste {
  readonly registradaEm: Date;
  readonly totalCentavos: number;
  readonly descontoCentavos?: number;
  readonly quantidade?: number;
  readonly pagamentos?: { forma: 'DINHEIRO' | 'PIX' | 'DEBITO'; valorCentavos: number; trocoCentavos: number }[];
  readonly cancelada?: boolean;
}

async function criarVenda(dados: VendaDeTeste) {
  const venda = await prisma.venda.create({
    data: {
      id: crypto.randomUUID(),
      sessaoCaixaId,
      operadorId,
      subtotalCentavos: dados.totalCentavos + (dados.descontoCentavos ?? 0),
      descontoCentavos: dados.descontoCentavos ?? 0,
      totalCentavos: dados.totalCentavos,
      criadaEmCliente: dados.registradaEm,
      registradaEm: dados.registradaEm,
      itens: {
        create: [
          {
            varianteId,
            sequencia: 1,
            descricao: 'Conjunto Renda',
            sku: 'CJ-1',
            quantidade: dados.quantidade ?? 1,
            /*
             * O banco tem CHECK `item_venda_total_coerente`: preço × quantidade
             * menos desconto TEM que dar o total. Inventar números soltos aqui
             * é recusado — e é assim que se garante que nenhum caminho grava
             * item incoerente.
             */
            precoUnitarioCentavos: Math.round(dados.totalCentavos / (dados.quantidade ?? 1)),
            descontoCentavos: 0,
            totalCentavos:
              Math.round(dados.totalCentavos / (dados.quantidade ?? 1)) * (dados.quantidade ?? 1),
          },
        ],
      },
      pagamentos: {
        create: dados.pagamentos ?? [
          { forma: 'DINHEIRO', valorCentavos: dados.totalCentavos, trocoCentavos: 0 },
        ],
      },
    },
  });

  if (dados.cancelada) {
    await prisma.cancelamento.create({
      data: {
        vendaOriginalId: venda.id,
        motivo: 'teste',
        valorCentavos: dados.totalCentavos,
        formaEstorno: 'DINHEIRO',
        autorizadoPorId: operadorId,
        usuarioId: operadorId,
      },
    });
  }

  return venda;
}

async function buscarRelatorio(de: string, ate: string) {
  const resposta = await app.inject({
    method: 'GET',
    url: `/relatorios/vendas?de=${de}&ate=${ate}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: resposta.statusCode, corpo: resposta.json() as RelatorioVendas };
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

  const usuario = await prisma.usuario.create({
    data: {
      nome: 'Ana',
      login: 'ana.relatorio',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
    },
  });
  operadorId = usuario.id;

  const login = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana.relatorio', senha: 'caixa123' },
  });
  token = (login.json() as { token: string }).token;

  const terminal = await prisma.terminal.create({ data: { nome: 'Caixa 1' } });
  const sessao = await prisma.sessaoCaixa.create({
    data: { terminalId: terminal.id, operadorId, fundoTrocoCentavos: 0 },
  });
  sessaoCaixaId = sessao.id;

  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({
    data: { nome: 'Conjunto', categoriaId: categoria.id },
  });
  const variante = await prisma.variante.create({
    data: { produtoId: produto.id, sku: 'CJ-1', precoCentavos: 8_990, custoCentavos: 3_000 },
  });
  varianteId = variante.id;
});

describe('relatório de vendas', () => {
  it('exige autenticação', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/relatorios/vendas?de=2026-09-01&ate=2026-09-01' });
    expect(resposta.statusCode).toBe(401);
  });

  it('soma total, desconto, peças e ticket médio', async () => {
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 10), totalCentavos: 10_000, quantidade: 2 });
    await criarVenda({
      registradaEm: new Date(2026, 8, 1, 15),
      totalCentavos: 21_000,
      descontoCentavos: 1_000,
      quantidade: 3,
    });

    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-01');

    expect(corpo.resumo).toMatchObject({
      quantidadeVendas: 2,
      totalCentavos: 31_000,
      descontoCentavos: 1_000,
      ticketMedioCentavos: 15_500,
      pecasVendidas: 5,
    });
  });

  it('período sem venda devolve zeros, não erro', async () => {
    const { status, corpo } = await buscarRelatorio('2026-09-01', '2026-09-01');
    expect(status).toBe(200);
    expect(corpo.resumo).toMatchObject({ quantidadeVendas: 0, totalCentavos: 0, ticketMedioCentavos: 0 });
    expect(corpo.porDia).toEqual([]);
  });
});

describe('o dia é o DIA DA LOJA', () => {
  it('venda das 22h fica no dia dela, não no seguinte', async () => {
    /*
     * Este é o teste que justifica o recorte local. Com corte em UTC, no
     * Brasil (UTC-3) a venda das 22h de 1/9 apareceria em 2/9 e o fechamento
     * do dia não bateria com o relatório.
     */
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 22, 30), totalCentavos: 5_000 });

    const primeiro = await buscarRelatorio('2026-09-01', '2026-09-01');
    expect(primeiro.corpo.resumo.quantidadeVendas).toBe(1);

    const segundo = await buscarRelatorio('2026-09-02', '2026-09-02');
    expect(segundo.corpo.resumo.quantidadeVendas).toBe(0);
  });

  it('venda das 23h59 do último dia entra no período', async () => {
    await criarVenda({ registradaEm: new Date(2026, 8, 3, 23, 59, 59), totalCentavos: 5_000 });
    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-03');
    expect(corpo.resumo.quantidadeVendas).toBe(1);
  });

  it('venda do dia seguinte ao fim NÃO entra', async () => {
    await criarVenda({ registradaEm: new Date(2026, 8, 4, 0, 1), totalCentavos: 5_000 });
    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-03');
    expect(corpo.resumo.quantidadeVendas).toBe(0);
  });

  it('agrupa por dia em ordem cronológica', async () => {
    await criarVenda({ registradaEm: new Date(2026, 8, 3, 10), totalCentavos: 3_000 });
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 10), totalCentavos: 1_000 });
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 18), totalCentavos: 2_000 });

    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-03');

    expect(corpo.porDia).toEqual([
      { dia: '2026-09-01', quantidade: 2, totalCentavos: 3_000 },
      { dia: '2026-09-03', quantidade: 1, totalCentavos: 3_000 },
    ]);
  });

  it('recusa período invertido em vez de devolver vazio', async () => {
    // Vazio pareceria "não vendeu nada", que é uma resposta errada e confiável.
    const resposta = await app.inject({
      method: 'GET',
      url: '/relatorios/vendas?de=2026-09-10&ate=2026-09-01',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toMatchObject({ codigo: 'PERIODO_INVERTIDO' });
  });

  it('recusa data em formato errado', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/relatorios/vendas?de=01/09/2026&ate=30/09/2026',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(400);
  });
});

describe('venda cancelada', () => {
  it('não conta como faturamento', async () => {
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 10), totalCentavos: 10_000 });
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 11), totalCentavos: 50_000, cancelada: true });

    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-01');

    expect(corpo.resumo.quantidadeVendas).toBe(1);
    expect(corpo.resumo.totalCentavos).toBe(10_000);
  });
});

describe('formas de pagamento', () => {
  it('soma o LÍQUIDO do troco', async () => {
    /*
     * O bruto contaria a nota de R$ 100 dada para pagar R$ 50 como cem reais
     * de faturamento em dinheiro, e a soma das formas não fecharia com o total
     * das vendas.
     */
    await criarVenda({
      registradaEm: new Date(2026, 8, 1, 10),
      totalCentavos: 5_000,
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 10_000, trocoCentavos: 5_000 }],
    });

    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-01');

    expect(corpo.porForma).toEqual([{ forma: 'DINHEIRO', quantidade: 1, totalCentavos: 5_000 }]);
    // A soma das formas bate com o total das vendas.
    expect(corpo.porForma.reduce((s, f) => s + f.totalCentavos, 0)).toBe(corpo.resumo.totalCentavos);
  });

  it('separa venda dividida em duas formas', async () => {
    await criarVenda({
      registradaEm: new Date(2026, 8, 1, 10),
      totalCentavos: 10_000,
      pagamentos: [
        { forma: 'PIX', valorCentavos: 4_000, trocoCentavos: 0 },
        { forma: 'DINHEIRO', valorCentavos: 6_000, trocoCentavos: 0 },
      ],
    });

    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-01');
    expect(corpo.porForma).toHaveLength(2);
    // Ordenado do maior para o menor.
    expect(corpo.porForma[0]).toMatchObject({ forma: 'DINHEIRO', totalCentavos: 6_000 });
  });
});

describe('produtos mais vendidos', () => {
  it('agrupa por SKU e ordena por quantidade', async () => {
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 10), totalCentavos: 3_000, quantidade: 3 });
    await criarVenda({ registradaEm: new Date(2026, 8, 1, 11), totalCentavos: 5_000, quantidade: 5 });

    const { corpo } = await buscarRelatorio('2026-09-01', '2026-09-01');

    expect(corpo.maisVendidos).toHaveLength(1);
    expect(corpo.maisVendidos[0]).toMatchObject({ sku: 'CJ-1', quantidade: 8 });
  });
});
