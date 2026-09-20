/**
 * Contas a receber, dados de cartão e cabeçalhos de segurança.
 *
 * O que estes testes protegem:
 *
 *   1. O valor em aberto é o que FALTA na parcela, não o valor cheio.
 *      Recebimento parcial já descontado — usar o cheio inflaria a expectativa
 *      de caixa justamente nas parcelas que o cliente vem pagando aos poucos.
 *   2. Atraso é comparado por DIA, não por instante: parcela que vence hoje
 *      não está vencida.
 *   3. Bandeira, autorização e parcelas do cartão são persistidas. Elas não
 *      entram em conta nenhuma, mas sem elas não há como conciliar o extrato
 *      da adquirente.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';
import type { RelatorioContasAReceber } from '../servicos/relatorio.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let tokenOperadora: string;
let tokenGerente: string;
let operadoraId: string;
let clienteId: string;
let sessaoCaixaId: string;
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

const comoGerente = () => ({ authorization: `Bearer ${tokenGerente}` });

/** Dias a partir de hoje, à meia-noite — para montar vencimentos previsíveis. */
function emDias(dias: number): Date {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return new Date(data.getFullYear(), data.getMonth(), data.getDate(), 0, 0, 0, 0);
}

/** Venda fiada com parcelas nos vencimentos pedidos. */
async function criarVendaFiada(
  parcelas: { valorCentavos: number; vencimento: Date }[],
): Promise<{ vendaId: string; parcelaIds: string[] }> {
  const total = parcelas.reduce((soma, p) => soma + p.valorCentavos, 0);
  const venda = await prisma.venda.create({
    data: {
      id: crypto.randomUUID(),
      sessaoCaixaId,
      operadorId: operadoraId,
      clienteId,
      subtotalCentavos: total,
      totalCentavos: total,
      criadaEmCliente: new Date(),
      itens: {
        create: [
          {
            varianteId,
            sequencia: 1,
            descricao: 'Conjunto',
            sku: 'CJ-1',
            quantidade: 1,
            precoUnitarioCentavos: total,
            descontoCentavos: 0,
            totalCentavos: total,
          },
        ],
      },
      pagamentos: { create: [{ forma: 'CREDIARIO', valorCentavos: total, trocoCentavos: 0 }] },
    },
  });

  const titulo = await prisma.tituloCrediario.create({
    data: {
      vendaId: venda.id,
      clienteId,
      valorTotalCentavos: total,
      parcelas: {
        create: parcelas.map((parcela, indice) => ({
          numero: indice + 1,
          valorCentavos: parcela.valorCentavos,
          vencimento: parcela.vencimento,
        })),
      },
    },
    select: { parcelas: { select: { id: true }, orderBy: { numero: 'asc' } } },
  });

  return { vendaId: venda.id, parcelaIds: titulo.parcelas.map((p) => p.id) };
}

async function buscarContas(): Promise<RelatorioContasAReceber> {
  const resposta = await app.inject({
    method: 'GET',
    url: '/relatorios/contas-a-receber',
    headers: comoGerente(),
  });
  return resposta.json() as RelatorioContasAReceber;
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
      login: 'ana.receber',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
    },
  });
  operadoraId = ana.id;
  await prisma.usuario.create({
    data: {
      nome: 'Bia',
      login: 'bia.receber',
      senhaHash: await gerarHashSenha('gerente123'),
      papel: 'GERENTE',
    },
  });

  const entrar = async (login: string, senha: string) => {
    const resposta = await app.inject({ method: 'POST', url: '/sessao/login', payload: { login, senha } });
    return (resposta.json() as { token: string }).token;
  };
  tokenOperadora = await entrar('ana.receber', 'caixa123');
  tokenGerente = await entrar('bia.receber', 'gerente123');

  const cliente = await prisma.cliente.create({
    data: { nome: 'Carla', telefone: '11999990000', limiteCrediarioCentavos: 100_000 },
  });
  clienteId = cliente.id;

  const terminal = await prisma.terminal.create({ data: { nome: 'Caixa 1' } });
  const sessao = await prisma.sessaoCaixa.create({
    data: { terminalId: terminal.id, operadorId: operadoraId, fundoTrocoCentavos: 0 },
  });
  sessaoCaixaId = sessao.id;

  const produto = await prisma.produto.create({ data: { nome: 'Conjunto' } });
  const variante = await prisma.variante.create({
    data: { produtoId: produto.id, sku: 'CJ-1', precoCentavos: 10_000 },
  });
  varianteId = variante.id;
});

describe('contas a receber', () => {
  it('soma o que falta, separando vencido de a vencer', async () => {
    await criarVendaFiada([
      { valorCentavos: 10_000, vencimento: emDias(-5) }, // vencida
      { valorCentavos: 15_000, vencimento: emDias(25) }, // a vencer
    ]);

    const relatorio = await buscarContas();

    expect(relatorio.resumo).toMatchObject({
      clientes: 1,
      parcelas: 2,
      abertoCentavos: 25_000,
      vencidoCentavos: 10_000,
      aVencerCentavos: 15_000,
    });
  });

  it('desconta recebimento parcial — o valor em aberto é o que FALTA', async () => {
    const { parcelaIds } = await criarVendaFiada([
      { valorCentavos: 10_000, vencimento: emDias(10) },
    ]);

    await prisma.recebimentoParcela.create({
      data: {
        parcelaId: parcelaIds[0]!,
        valorCentavos: 4_000,
        forma: 'DINHEIRO',
        sessaoCaixaId,
        usuarioId: operadoraId,
      },
    });

    const relatorio = await buscarContas();
    expect(relatorio.resumo.abertoCentavos).toBe(6_000);
    expect(relatorio.clientes[0]?.parcelas[0]).toMatchObject({
      valorCentavos: 10_000,
      recebidoCentavos: 4_000,
      abertoCentavos: 6_000,
    });
  });

  it('parcela que vence HOJE não está vencida', async () => {
    // Comparação por dia, não por instante: às 9h da manhã, uma parcela que
    // vence às 23h de hoje ainda está em dia.
    await criarVendaFiada([{ valorCentavos: 5_000, vencimento: emDias(0) }]);

    const relatorio = await buscarContas();
    expect(relatorio.resumo.vencidoCentavos).toBe(0);
    expect(relatorio.clientes[0]?.parcelas[0]?.diasDeAtraso).toBe(0);
  });

  it('conta os dias de atraso a partir do vencimento', async () => {
    await criarVendaFiada([{ valorCentavos: 5_000, vencimento: emDias(-3) }]);

    const relatorio = await buscarContas();
    expect(relatorio.clientes[0]?.parcelas[0]?.diasDeAtraso).toBe(3);
  });

  it('parcela quitada sai da lista', async () => {
    const { parcelaIds } = await criarVendaFiada([
      { valorCentavos: 5_000, vencimento: emDias(5) },
    ]);
    await prisma.parcelaCrediario.update({
      where: { id: parcelaIds[0]! },
      data: { status: 'PAGA' },
    });

    const relatorio = await buscarContas();
    expect(relatorio.resumo.parcelas).toBe(0);
    expect(relatorio.clientes).toEqual([]);
  });

  it('quem deve vencido aparece primeiro — é a ordem da cobrança', async () => {
    const outra = await prisma.cliente.create({
      data: { nome: 'Dani', limiteCrediarioCentavos: 100_000 },
    });

    // Carla deve mais, mas tudo a vencer. Dani deve menos, porém vencido.
    await criarVendaFiada([{ valorCentavos: 50_000, vencimento: emDias(20) }]);
    clienteId = outra.id;
    await criarVendaFiada([{ valorCentavos: 8_000, vencimento: emDias(-2) }]);

    const relatorio = await buscarContas();
    expect(relatorio.clientes[0]?.nome).toBe('Dani');
  });

  it('operadora não consulta contas a receber', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/relatorios/contas-a-receber',
      headers: { authorization: `Bearer ${tokenOperadora}` },
    });
    expect(resposta.statusCode).toBe(403);
  });
});

describe('dados da maquininha', () => {
  it('persiste bandeira, autorização e parcelas do cartão', async () => {
    const vendaId = crypto.randomUUID();
    const resposta = await app.inject({
      method: 'POST',
      url: '/vendas',
      headers: { authorization: `Bearer ${tokenOperadora}` },
      payload: {
        id: vendaId,
        sessaoCaixaId,
        criadaEmCliente: new Date().toISOString(),
        itens: [
          { varianteId, quantidade: 1, precoUnitarioCentavos: 10_000, descontoCentavos: 0 },
        ],
        pagamentos: [
          {
            forma: 'CREDITO',
            valorCentavos: 10_000,
            trocoCentavos: 0,
            bandeira: 'Visa',
            autorizacao: 'A1B2C3',
            parcelasCartao: 3,
          },
        ],
      },
    });

    expect(resposta.statusCode).toBe(201);
    const pagamento = await prisma.pagamento.findFirst({ where: { vendaId } });
    expect(pagamento).toMatchObject({
      bandeira: 'Visa',
      autorizacao: 'A1B2C3',
      parcelasCartao: 3,
    });
  });

  it('venda sem os dados da maquininha continua fechando', async () => {
    // São INFORMATIVOS: a operadora não pode ficar travada porque o
    // comprovante da maquininha não saiu.
    const vendaId = crypto.randomUUID();
    const resposta = await app.inject({
      method: 'POST',
      url: '/vendas',
      headers: { authorization: `Bearer ${tokenOperadora}` },
      payload: {
        id: vendaId,
        sessaoCaixaId,
        criadaEmCliente: new Date().toISOString(),
        itens: [
          { varianteId, quantidade: 1, precoUnitarioCentavos: 10_000, descontoCentavos: 0 },
        ],
        pagamentos: [{ forma: 'DEBITO', valorCentavos: 10_000, trocoCentavos: 0 }],
      },
    });

    expect(resposta.statusCode).toBe(201);
    const pagamento = await prisma.pagamento.findFirst({ where: { vendaId } });
    expect(pagamento?.bandeira).toBeNull();
  });
});

describe('cabeçalhos de segurança', () => {
  it('manda CSP fechada e bloqueia enquadramento em iframe', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/saude' });

    // Esta API devolve JSON e nada mais: se uma resposta dela for renderizada
    // como página, por engano ou injeção, não carrega recurso nenhum.
    expect(resposta.headers['content-security-policy']).toContain("default-src 'none'");
    expect(resposta.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
  });

  it('não quebra o CORS do caixa', async () => {
    // O PWA roda em 5173 e a API em 3333: a política padrão do helmet
    // (`same-origin`) bloquearia justamente o caixa.
    const resposta = await app.inject({
      method: 'GET',
      url: '/saude',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(resposta.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(resposta.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
