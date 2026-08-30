/**
 * Ponta a ponta de produto/variante/estoque/importação de XML, contra
 * PostgreSQL real.
 *
 * Foco: estoque nunca é uma coluna — é sempre a soma de MovimentoEstoque; a
 * importação de XML é em duas etapas (prévia sem gravar nada, depois
 * confirmação) porque a nota nunca traz preço de venda; e PERDA/AJUSTE
 * exigem gerente sem alçada de quantidade, igual sangria/suprimento.
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
  categoria: '44444444-4444-4444-8444-444444444444',
  produto: '55555555-5555-4555-8555-555555555555',
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
    data: { id: IDS.gerente, nome: 'Bia Martins', login: 'bia', senhaHash: senha, papel: 'GERENTE' },
  });
  await prisma.categoria.create({ data: { id: IDS.categoria, nome: 'Pijamas' } });
  await prisma.produto.create({
    data: { id: IDS.produto, nome: 'Pijama Longo Floral', categoriaId: IDS.categoria },
  });
  await prisma.variante.create({
    data: {
      id: IDS.variante,
      produtoId: IDS.produto,
      sku: 'PJL-FLR-M',
      codigoBarras: '7891234567890',
      tamanho: 'M',
      precoCentavos: 8990,
      custoCentavos: 4000,
    },
  });
}

async function autenticar(): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana', senha: 'caixa123' },
  });
  return resposta.json().token as string;
}

function movimentoEstoque(varianteId: string, corpo: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/variantes/${varianteId}/movimentos-estoque`,
    headers: { authorization: `Bearer ${token}` },
    payload: corpo,
  });
}

function xmlComItens(itens: { ean: string; descricao: string; qtd: string; vUn: string }[]): string {
  const detalhes = itens
    .map(
      (item, indice) => `
    <det nItem="${indice + 1}">
      <prod>
        <cProd>P${indice + 1}</cProd>
        <cEAN>${item.ean}</cEAN>
        <xProd>${item.descricao}</xProd>
        <NCM>61071100</NCM>
        <qCom>${item.qtd}</qCom>
        <vUnCom>${item.vUn}</vUnCom>
      </prod>
    </det>`,
    )
    .join('');
  return `<?xml version="1.0"?>
<nfeProc>
  <NFe>
    <infNFe>
      <ide><nNF>123</nNF></ide>
      ${detalhes}
    </infNFe>
  </NFe>
</nfeProc>`;
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

describe('produtos e variantes — CRUD', () => {
  it('cria produto e depois variante dentro dele', async () => {
    const produto = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: 'Camisola Cetim', categoriaId: IDS.categoria },
    });
    expect(produto.statusCode).toBe(201);

    const variante = await app.inject({
      method: 'POST',
      url: `/produtos/${produto.json().id}/variantes`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: 'CAM-CET-P', precoCentavos: 12900 },
    });
    expect(variante.statusCode).toBe(201);
  });

  it('lista produtos com variantes e saldo de estoque zero quando não há movimento', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/produtos',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resposta.statusCode).toBe(200);
    const produto = resposta.json().itens.find((item: any) => item.id === IDS.produto);
    expect(produto.variantes[0].saldoEstoque).toBe(0);
  });

  it('atualiza preço da variante', async () => {
    const resposta = await app.inject({
      method: 'PATCH',
      url: `/variantes/${IDS.variante}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { precoCentavos: 9990 },
    });
    expect(resposta.statusCode).toBe(200);

    const variante = await prisma.variante.findUniqueOrThrow({ where: { id: IDS.variante } });
    expect(variante.precoCentavos).toBe(9990);
  });

  it('404 ao atualizar produto inexistente', async () => {
    const resposta = await app.inject({
      method: 'PATCH',
      url: '/produtos/99999999-9999-4999-8999-999999999999',
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: 'X' },
    });
    expect(resposta.statusCode).toBe(404);
  });
});

describe('movimento manual de estoque', () => {
  it('entrada de compra soma no saldo, sem exigir gerente', async () => {
    const resposta = await movimentoEstoque(IDS.variante, {
      tipo: 'ENTRADA_COMPRA',
      quantidade: 20,
      custoUnitarioCentavos: 4000,
    });
    expect(resposta.statusCode).toBe(201);

    const estoque = await app.inject({
      method: 'GET',
      url: `/variantes/${IDS.variante}/estoque`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(estoque.json().saldo).toBe(20);
  });

  it('perda exige gerente, sem alçada de quantidade', async () => {
    await movimentoEstoque(IDS.variante, { tipo: 'ENTRADA_COMPRA', quantidade: 20 });

    const semGerente = await movimentoEstoque(IDS.variante, {
      tipo: 'PERDA',
      quantidade: -1,
      autorizadoPorId: IDS.operadora,
    });
    expect(semGerente.statusCode).toBe(403);

    const comGerente = await movimentoEstoque(IDS.variante, {
      tipo: 'PERDA',
      quantidade: -1,
      observacao: 'Peça rasgada',
      autorizadoPorId: IDS.gerente,
    });
    expect(comGerente.statusCode).toBe(201);

    const auditoria = await prisma.registroAuditoria.findFirstOrThrow({
      where: { acao: 'PERDA', entidadeId: IDS.variante },
    });
    expect(auditoria.autorizadoPorId).toBe(IDS.gerente);

    const estoque = await app.inject({
      method: 'GET',
      url: `/variantes/${IDS.variante}/estoque`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(estoque.json().saldo).toBe(19);
  });

  it('ajuste de inventário pode somar ou tirar, sempre com gerente', async () => {
    const resposta = await movimentoEstoque(IDS.variante, {
      tipo: 'AJUSTE_INVENTARIO',
      quantidade: 3,
      autorizadoPorId: IDS.gerente,
      observacao: 'Contagem física achou 3 a mais',
    });
    expect(resposta.statusCode).toBe(201);

    const estoque = await app.inject({
      method: 'GET',
      url: `/variantes/${IDS.variante}/estoque`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(estoque.json().saldo).toBe(3);
  });

  it('recusa quantidade zero — Zod aceita o inteiro, a regra de negócio recusa', async () => {
    const resposta = await movimentoEstoque(IDS.variante, { tipo: 'ENTRADA_COMPRA', quantidade: 0 });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('QUANTIDADE_INVALIDA');
  });
});

describe('importação de XML de NF-e', () => {
  it('prévia casa item existente pelo código de barras e não grava nada', async () => {
    const xml = xmlComItens([
      { ean: '7891234567890', descricao: 'Pijama Longo Floral M', qtd: '10', vUn: '40.00' },
    ]);
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos/importar-xml',
      headers: { authorization: `Bearer ${token}` },
      payload: { xml },
    });
    expect(resposta.statusCode).toBe(200);
    const item = resposta.json().itens[0];
    expect(item.varianteExistenteId).toBe(IDS.variante);
    expect(item.quantidade).toBe(10);
    expect(item.custoUnitarioCentavos).toBe(4000);

    const movimentos = await prisma.movimentoEstoque.count();
    expect(movimentos).toBe(0); // prévia não grava
  });

  it('prévia marca item sem código de barras cadastrado como produto novo', async () => {
    const xml = xmlComItens([{ ean: '9999999999999', descricao: 'Camisola Nova', qtd: '5', vUn: '25.50' }]);
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos/importar-xml',
      headers: { authorization: `Bearer ${token}` },
      payload: { xml },
    });
    expect(resposta.json().itens[0].varianteExistenteId).toBeNull();
  });

  it('confirmação lança ENTRADA_COMPRA para item existente e cria produto novo quando preciso', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos/confirmar-importacao-xml',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        numeroNota: '123',
        itens: [
          { varianteId: IDS.variante, quantidade: 10, custoUnitarioCentavos: 4000 },
          {
            codigoBarras: '9999999999999',
            produtoNovo: { nome: 'Camisola Nova', sku: 'CAM-NOV-U', precoCentavos: 5900 },
            quantidade: 5,
            custoUnitarioCentavos: 2550,
          },
        ],
      },
    });
    expect(resposta.statusCode).toBe(201);
    expect(resposta.json().movimentosCriados).toBe(2);

    const estoqueExistente = await app.inject({
      method: 'GET',
      url: `/variantes/${IDS.variante}/estoque`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(estoqueExistente.json().saldo).toBe(10);

    const novaVariante = await prisma.variante.findFirstOrThrow({ where: { codigoBarras: '9999999999999' } });
    expect(novaVariante.custoCentavos).toBe(2550);
    expect(novaVariante.precoCentavos).toBe(5900);

    const movimentoNovo = await prisma.movimentoEstoque.findFirstOrThrow({
      where: { varianteId: novaVariante.id },
    });
    expect(movimentoNovo.tipo).toBe('ENTRADA_COMPRA');
    expect(movimentoNovo.quantidade).toBe(5);
    expect(movimentoNovo.documentoId).toBe('123');
  });

  it('recusa XML que não é NF-e', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos/importar-xml',
      headers: { authorization: `Bearer ${token}` },
      payload: { xml: '<algumaCoisa><x>1</x></algumaCoisa>' },
    });
    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().codigo).toBe('XML_INVALIDO');
  });

  it('recusa confirmar item sem variante existente nem produto novo', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/produtos/confirmar-importacao-xml',
      headers: { authorization: `Bearer ${token}` },
      payload: { itens: [{ quantidade: 1, custoUnitarioCentavos: 100 }] },
    });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().codigo).toBe('ITEM_SEM_DESTINO');
  });
});
