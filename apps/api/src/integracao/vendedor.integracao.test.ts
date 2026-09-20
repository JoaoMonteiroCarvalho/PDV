/**
 * Vendedor da venda — a base da comissão.
 *
 * O que estes testes protegem:
 *
 *   1. Quem ATENDEU pode ser diferente de quem operou o caixa. Numa loja com
 *      duas pessoas, uma acompanha a prova e a outra fecha a venda; derivar do
 *      operador daria a comissão à pessoa errada justamente nos dias de
 *      movimento.
 *   2. Vendedor ausente ou inválido NÃO recusa a venda — ela já aconteceu no
 *      mundo real. Cai para o operador e vira auditoria, para alguém poder
 *      notar e corrigir.
 *   3. As vendas anteriores ao campo existir aparecem como "não informado".
 *      `Venda` é imutável por trigger: não há backfill possível, e inventar um
 *      vendedor para elas seria fabricar base de comissão.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';
import { registrarVenda } from '../servicos/registrar-venda.js';
import { gerarRelatorioVendas } from '../servicos/relatorio.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let tokenOperadora: string;
let anaId: string;
let biaId: string;
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

function venda(extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    sessaoCaixaId,
    criadaEmCliente: new Date(),
    itens: [{ varianteId, quantidade: 1, precoUnitarioCentavos: 10_000, descontoCentavos: 0 }],
    descontoSobreTotalCentavos: 0,
    pagamentos: [{ forma: 'DINHEIRO' as const, valorCentavos: 10_000, trocoCentavos: 0 }],
    ...extra,
  };
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
      login: 'ana.vendedor',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
    },
  });
  anaId = ana.id;

  const bia = await prisma.usuario.create({
    data: {
      nome: 'Bia',
      login: 'bia.vendedor',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
    },
  });
  biaId = bia.id;

  const entrar = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana.vendedor', senha: 'caixa123' },
  });
  tokenOperadora = (entrar.json() as { token: string }).token;

  const terminal = await prisma.terminal.create({ data: { nome: 'Caixa 1' } });
  const sessao = await prisma.sessaoCaixa.create({
    data: { terminalId: terminal.id, operadorId: anaId, fundoTrocoCentavos: 0 },
  });
  sessaoCaixaId = sessao.id;

  const produto = await prisma.produto.create({ data: { nome: 'Conjunto' } });
  const variante = await prisma.variante.create({
    data: { produtoId: produto.id, sku: 'CJ-V', precoCentavos: 10_000 },
  });
  varianteId = variante.id;
});

describe('quem atendeu', () => {
  it('grava a vendedora informada, diferente de quem operou o caixa', async () => {
    // Ana está no caixa; Bia atendeu. A comissão é da Bia.
    const resultado = await registrarVenda(prisma, venda({ vendedorId: biaId }), {
      operadorId: anaId,
    });

    const gravada = await prisma.venda.findUnique({
      where: { id: resultado.vendaId },
      select: { operadorId: true, vendedorId: true },
    });
    expect(gravada?.operadorId).toBe(anaId);
    expect(gravada?.vendedorId).toBe(biaId);
  });

  it('sem vendedora informada, cai para quem operou', async () => {
    // O caso da maioria das vendas: uma pessoa só no balcão.
    const resultado = await registrarVenda(prisma, venda(), { operadorId: anaId });

    const gravada = await prisma.venda.findUnique({
      where: { id: resultado.vendaId },
      select: { vendedorId: true },
    });
    expect(gravada?.vendedorId).toBe(anaId);
  });
});

describe('vendedora que não dá para honrar', () => {
  it('id inexistente NÃO recusa a venda — ela já aconteceu', async () => {
    const resultado = await registrarVenda(
      prisma,
      venda({ vendedorId: crypto.randomUUID() }),
      { operadorId: anaId },
    );

    expect(await prisma.venda.count()).toBe(1);
    const gravada = await prisma.venda.findUnique({
      where: { id: resultado.vendaId },
      select: { vendedorId: true },
    });
    expect(gravada?.vendedorId).toBe(anaId);
  });

  it('a troca vira auditoria, para alguém poder notar', async () => {
    /*
     * Sem este registro, a pessoa que atendeu simplesmente não veria a venda
     * dela no relatório do mês e não teria como saber por quê.
     */
    const inexistente = crypto.randomUUID();
    await registrarVenda(prisma, venda({ vendedorId: inexistente }), { operadorId: anaId });

    const registro = await prisma.registroAuditoria.findFirst({
      where: { acao: 'VENDEDOR_SUBSTITUIDO' },
    });
    expect(registro).not.toBeNull();
    expect(registro?.valorAntes).toMatchObject({ vendedorPedido: inexistente });
    expect(registro?.valorDepois).toMatchObject({ vendedorGravado: anaId });
  });

  it('vendedora desativada também cai para o operador', async () => {
    await prisma.usuario.update({ where: { id: biaId }, data: { ativo: false } });

    const resultado = await registrarVenda(prisma, venda({ vendedorId: biaId }), {
      operadorId: anaId,
    });

    const gravada = await prisma.venda.findUnique({
      where: { id: resultado.vendaId },
      select: { vendedorId: true },
    });
    expect(gravada?.vendedorId).toBe(anaId);
  });

  it('vendedora igual ao operador não gera auditoria', async () => {
    // É o caso normal. Auditoria cheia de linha "nada de estranho" é auditoria
    // que ninguém lê.
    await registrarVenda(prisma, venda({ vendedorId: anaId }), { operadorId: anaId });

    expect(await prisma.registroAuditoria.count({ where: { acao: 'VENDEDOR_SUBSTITUIDO' } })).toBe(
      0,
    );
  });
});

describe('relatório por vendedora', () => {
  it('soma o que cada uma vendeu, da maior para a menor', async () => {
    const hoje = new Date();
    const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    await registrarVenda(prisma, venda({ vendedorId: anaId }), { operadorId: anaId });
    await registrarVenda(prisma, venda({ vendedorId: biaId }), { operadorId: anaId });
    await registrarVenda(prisma, venda({ vendedorId: biaId }), { operadorId: anaId });

    const relatorio = await gerarRelatorioVendas(prisma, { de: dia, ate: dia });

    // Bia vendeu duas, Ana uma. Quem mais vendeu vem primeiro — é a ordem em
    // que a conversa sobre comissão acontece.
    expect(relatorio.porVendedor[0]).toMatchObject({
      vendedor: 'Bia',
      quantidade: 2,
      totalCentavos: 20_000,
    });
    expect(relatorio.porVendedor[1]).toMatchObject({ vendedor: 'Ana', quantidade: 1 });
  });

  it('venda sem vendedora aparece como grupo próprio, não some', async () => {
    /*
     * Simula as vendas anteriores ao campo existir. Elas são gravadas direto,
     * sem passar pelo serviço, porque o serviço sempre preenche o campo — e é
     * exatamente essa a situação do banco de produção após a migration.
     */
    const hoje = new Date();
    const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    await prisma.venda.create({
      data: {
        id: crypto.randomUUID(),
        sessaoCaixaId,
        operadorId: anaId,
        vendedorId: null,
        subtotalCentavos: 10_000,
        totalCentavos: 10_000,
        criadaEmCliente: new Date(),
        itens: {
          create: [
            {
              varianteId,
              sequencia: 1,
              descricao: 'Conjunto',
              sku: 'CJ-V',
              quantidade: 1,
              precoUnitarioCentavos: 10_000,
              descontoCentavos: 0,
              totalCentavos: 10_000,
            },
          ],
        },
        pagamentos: { create: [{ forma: 'DINHEIRO', valorCentavos: 10_000, trocoCentavos: 0 }] },
      },
    });

    const relatorio = await gerarRelatorioVendas(prisma, { de: dia, ate: dia });

    const semVendedor = relatorio.porVendedor.find((linha) => linha.vendedorId === null);
    expect(semVendedor).toMatchObject({ vendedor: null, quantidade: 1, totalCentavos: 10_000 });
  });

  it('o banco RECUSA preencher vendas antigas — imutabilidade', async () => {
    /*
     * Este teste existe para travar o motivo de o campo ser nulável. Se algum
     * dia alguém desligar a trigger para "arrumar o histórico", isto falha e a
     * conversa acontece antes de a base de comissão ser fabricada.
     */
    const resultado = await registrarVenda(prisma, venda(), { operadorId: anaId });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "Venda" SET "vendedorId" = $1 WHERE "id" = $2`,
        biaId,
        resultado.vendaId,
      ),
    ).rejects.toThrow(/imutavel/i);
  });
});

describe('rota de vendedores', () => {
  it('a OPERADORA consegue listar quem pode vender', async () => {
    // É ela quem marca quem atendeu, no meio do balcão. `/usuarios` é de
    // gerente e não serviria.
    const resposta = await app.inject({
      method: 'GET',
      url: '/vendedores',
      headers: { authorization: `Bearer ${tokenOperadora}` },
    });

    expect(resposta.statusCode).toBe(200);
    const lista = resposta.json() as { id: string; nome: string }[];
    expect(lista.map((v) => v.nome)).toEqual(['Ana', 'Bia']);
  });

  it('não devolve papel nem alçada — isso é informação de administração', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/vendedores',
      headers: { authorization: `Bearer ${tokenOperadora}` },
    });

    const primeira = (resposta.json() as Record<string, unknown>[])[0];
    expect(Object.keys(primeira ?? {}).sort()).toEqual(['id', 'nome']);
  });

  it('omite quem foi desativado', async () => {
    await prisma.usuario.update({ where: { id: biaId }, data: { ativo: false } });

    const resposta = await app.inject({
      method: 'GET',
      url: '/vendedores',
      headers: { authorization: `Bearer ${tokenOperadora}` },
    });

    const lista = resposta.json() as { nome: string }[];
    expect(lista.map((v) => v.nome)).toEqual(['Ana']);
  });
});
