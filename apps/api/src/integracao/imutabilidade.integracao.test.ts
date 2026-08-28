/**
 * Prova, contra um PostgreSQL real, que as regras inegociáveis são garantidas
 * pelo BANCO e não pela boa vontade da aplicação.
 *
 * Estes testes tentam deliberadamente violar cada regra pelo caminho que um
 * desenvolvedor apressado usaria — o próprio Prisma — e exigem que o banco
 * recuse. Se algum dia alguém remover um trigger, aqui quebra.
 *
 * Exige `npm run db:up`. Rode com `npm run test:integracao`.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();

/** TRUNCATE não dispara triggers de linha — foi por isso que a limpeza é possível. */
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
  await prisma.usuario.create({
    data: { id: 'u1', nome: 'Ana Operadora', login: 'ana', senhaHash: 'scrypt$x', limiteDescontoBps: 500 },
  });
  await prisma.usuario.create({
    data: { id: 'g1', nome: 'Bia Gerente', login: 'bia', senhaHash: 'scrypt$y', papel: 'GERENTE' },
  });
  await prisma.terminal.create({ data: { id: 't1', nome: 'Caixa 1' } });
  await prisma.sessaoCaixa.create({
    data: { id: 's1', terminalId: 't1', operadorId: 'u1', fundoTrocoCentavos: 10_000 },
  });
  await prisma.categoria.create({ data: { id: 'c1', nome: 'Lingerie' } });
  await prisma.produto.create({ data: { id: 'p1', nome: 'Conjunto Renda', categoriaId: 'c1' } });
  await prisma.variante.create({
    data: {
      id: 'v1',
      produtoId: 'p1',
      sku: 'CJ-REN-M-PRETO',
      tamanho: 'M',
      cor: 'Preto',
      precoCentavos: 8990,
      custoCentavos: 3500,
    },
  });
}

/** Venda de R$ 89,90 com R$ 9,90 de desconto = R$ 80,00, paga em dinheiro. */
async function criarVendaFechada(): Promise<void> {
  await prisma.venda.create({
    data: {
      id: 'venda-1',
      sessaoCaixaId: 's1',
      operadorId: 'u1',
      subtotalCentavos: 8990,
      descontoCentavos: 990,
      totalCentavos: 8000,
      criadaEmCliente: new Date(),
      itens: {
        create: {
          id: 'i1',
          varianteId: 'v1',
          sequencia: 1,
          descricao: 'Conjunto Renda',
          sku: 'CJ-REN-M-PRETO',
          tamanho: 'M',
          cor: 'Preto',
          quantidade: 1,
          precoUnitarioCentavos: 8990,
          descontoCentavos: 990,
          totalCentavos: 8000,
        },
      },
      pagamentos: {
        create: { id: 'pg1', forma: 'DINHEIRO', valorCentavos: 10_000, trocoCentavos: 2000 },
      },
      movimentos: {
        create: {
          id: 'm1',
          varianteId: 'v1',
          tipo: 'VENDA',
          quantidade: -1,
          custoUnitarioCentavos: 3500,
          documentoTipo: 'VENDA',
          documentoId: 'venda-1',
        },
      },
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await limparBase();
  await semear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('venda fechada é imutável', () => {
  beforeEach(criarVendaFechada);

  it('o banco recusa UPDATE na venda', async () => {
    await expect(
      prisma.venda.update({ where: { id: 'venda-1' }, data: { totalCentavos: 1 } }),
    ).rejects.toThrow(/imutavel/i);
  });

  it('o banco recusa DELETE da venda', async () => {
    await expect(prisma.venda.delete({ where: { id: 'venda-1' } })).rejects.toThrow(/imutavel/i);
  });

  it('o banco recusa UPDATE em item da venda', async () => {
    await expect(
      prisma.itemVenda.update({ where: { id: 'i1' }, data: { quantidade: 99 } }),
    ).rejects.toThrow(/imutavel/i);
  });

  it('o banco recusa UPDATE em pagamento', async () => {
    await expect(
      prisma.pagamento.update({ where: { id: 'pg1' }, data: { valorCentavos: 1 } }),
    ).rejects.toThrow(/imutavel/i);
  });

  it('o banco recusa UPDATE no livro-razão de estoque', async () => {
    await expect(
      prisma.movimentoEstoque.update({ where: { id: 'm1' }, data: { quantidade: 999 } }),
    ).rejects.toThrow(/imutavel/i);
  });

  it('o banco recusa DELETE em registro de auditoria', async () => {
    await prisma.registroAuditoria.create({
      data: { id: 'a1', acao: 'SANGRIA', entidade: 'SessaoCaixa', entidadeId: 's1', usuarioId: 'u1' },
    });
    await expect(prisma.registroAuditoria.delete({ where: { id: 'a1' } })).rejects.toThrow(
      /imutavel/i,
    );
  });
});

describe('coerência de valores é imposta pelo banco', () => {
  it('recusa venda cujo total não é subtotal menos desconto', async () => {
    await expect(
      prisma.venda.create({
        data: {
          id: 'venda-ruim',
          sessaoCaixaId: 's1',
          operadorId: 'u1',
          subtotalCentavos: 1000,
          descontoCentavos: 0,
          totalCentavos: 999, // deveria ser 1000
          criadaEmCliente: new Date(),
        },
      }),
    ).rejects.toThrow(/venda_total_coerente/);
  });

  it('recusa item cujo total não bate com preço × quantidade − desconto', async () => {
    await criarVendaFechada();
    await expect(
      prisma.itemVenda.create({
        data: {
          id: 'i-ruim',
          vendaId: 'venda-1',
          varianteId: 'v1',
          sequencia: 2,
          descricao: 'x',
          sku: 'x',
          quantidade: 2,
          precoUnitarioCentavos: 1000,
          descontoCentavos: 0,
          totalCentavos: 1500, // deveria ser 2000
        },
      }),
    ).rejects.toThrow(/item_venda_total_coerente/);
  });

  it('recusa movimento de estoque com quantidade zero', async () => {
    await expect(
      prisma.movimentoEstoque.create({
        data: { varianteId: 'v1', tipo: 'AJUSTE_INVENTARIO', quantidade: 0 },
      }),
    ).rejects.toThrow(/quantidade_nao_zero/);
  });

  it('recusa variante com preço negativo', async () => {
    await expect(
      prisma.variante.create({
        data: { produtoId: 'p1', sku: 'NEG', precoCentavos: -100 },
      }),
    ).rejects.toThrow(/preco_nao_negativo/);
  });
});

describe('correção de venda acontece por documento novo', () => {
  beforeEach(criarVendaFechada);

  it('cancelamento é registro novo e deixa a venda original intacta', async () => {
    await prisma.cancelamento.create({
      data: {
        id: 'canc1',
        vendaOriginalId: 'venda-1',
        motivo: 'Cliente desistiu',
        valorCentavos: 8000,
        formaEstorno: 'DINHEIRO',
        usuarioId: 'u1',
        autorizadoPorId: 'g1',
      },
    });

    const original = await prisma.venda.findUniqueOrThrow({ where: { id: 'venda-1' } });
    expect(original.subtotalCentavos).toBe(8990);
    expect(original.descontoCentavos).toBe(990);
    expect(original.totalCentavos).toBe(8000);
  });

  it('venda cancelada é identificada pela existência do documento, não por status', async () => {
    const antes = await prisma.venda.findUniqueOrThrow({
      where: { id: 'venda-1' },
      include: { cancelamentos: true },
    });
    expect(antes.cancelamentos).toHaveLength(0);

    await prisma.cancelamento.create({
      data: {
        vendaOriginalId: 'venda-1',
        motivo: 'Troca',
        valorCentavos: 8000,
        formaEstorno: 'DINHEIRO',
        usuarioId: 'u1',
        autorizadoPorId: 'g1',
      },
    });

    const depois = await prisma.venda.findUniqueOrThrow({
      where: { id: 'venda-1' },
      include: { cancelamentos: true },
    });
    expect(depois.cancelamentos[0]?.motivo).toBe('Troca');
  });

  it('a mesma venda pode ter várias devoluções ao longo do tempo', async () => {
    await prisma.cancelamento.create({
      data: {
        vendaOriginalId: 'venda-1',
        motivo: 'Primeira devolução parcial',
        valorCentavos: 3000,
        formaEstorno: 'DINHEIRO',
        usuarioId: 'u1',
        autorizadoPorId: 'g1',
      },
    });
    await prisma.cancelamento.create({
      data: {
        vendaOriginalId: 'venda-1',
        motivo: 'Segunda devolução parcial',
        valorCentavos: 2000,
        formaEstorno: 'PIX',
        usuarioId: 'u1',
        autorizadoPorId: 'g1',
      },
    });

    const cancelamentos = await prisma.cancelamento.findMany({
      where: { vendaOriginalId: 'venda-1' },
    });
    expect(cancelamentos).toHaveLength(2);
  });

  it('cancelamento exige gerente — a coluna é obrigatória por decisão de negócio', async () => {
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "Cancelamento" ("id","vendaOriginalId","motivo","valorCentavos","formaEstorno","usuarioId")
        VALUES ('sem-gerente','venda-1','Sem autorizacao',8000,'DINHEIRO','u1')
      `),
      // 23502 = not_null_violation. O Prisma nao repassa o nome da coluna em
      // query crua, entao casamos o codigo do Postgres, que e estavel.
    ).rejects.toThrow(/23502/);
  });
});

describe('estoque é derivado do livro-razão', () => {
  async function saldoDe(varianteId: string): Promise<number> {
    const linhas = await prisma.$queryRawUnsafe<{ saldo: number }[]>(
      `SELECT "saldo" FROM "EstoqueAtual" WHERE "varianteId" = $1`,
      varianteId,
    );
    return linhas[0]?.saldo ?? 0;
  }

  it('parte de zero quando não há movimento', async () => {
    expect(await saldoDe('v1')).toBe(0);
  });

  it('a venda baixa o saldo e a entrada de compra o repõe', async () => {
    await prisma.movimentoEstoque.create({
      data: { varianteId: 'v1', tipo: 'ENTRADA_COMPRA', quantidade: 10, custoUnitarioCentavos: 3400 },
    });
    expect(await saldoDe('v1')).toBe(10);

    await criarVendaFechada();
    expect(await saldoDe('v1')).toBe(9);

    await prisma.movimentoEstoque.create({
      data: { varianteId: 'v1', tipo: 'CANCELAMENTO_VENDA', quantidade: 1, custoUnitarioCentavos: 3500 },
    });
    expect(await saldoDe('v1')).toBe(10);
  });

  it('não existe campo de saldo editável na tabela de variante', async () => {
    const colunas = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Variante'`,
    );
    const nomes = colunas.map((coluna) => coluna.column_name.toLowerCase());
    expect(nomes).not.toContain('quantidadeatual');
    expect(nomes).not.toContain('saldo');
    expect(nomes).not.toContain('estoque');
  });
});
