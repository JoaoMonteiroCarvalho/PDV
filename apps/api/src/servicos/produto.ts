/**
 * Serviço de produto/variante/estoque.
 *
 * Estoque nunca é uma coluna gravada: é sempre a soma assinada de
 * `MovimentoEstoque` por variante. Venda e devolução já escrevem nesse livro
 * (registrar-venda.ts, devolucao.ts) — este arquivo cobre CRUD de catálogo e
 * os movimentos manuais (compra avulsa, perda, ajuste de inventário).
 */

import type { PrismaClient } from '@prisma/client';
import { ErroEstoque, validarMovimentoManualEstoque, type TipoMovimentoManualEstoque } from '@pdv/shared';
import type {
  EntradaAtualizarProduto,
  EntradaAtualizarVariante,
  EntradaCriarProduto,
  EntradaCriarVariante,
  EntradaListarProdutos,
  EntradaMovimentoEstoque,
} from '../esquemas/produto.js';

async function autorizadorEhGerente(
  prisma: PrismaClient,
  autorizadoPorId: string | undefined,
): Promise<boolean> {
  if (!autorizadoPorId) return false;
  const usuario = await prisma.usuario.findUnique({
    where: { id: autorizadoPorId },
    select: { papel: true, ativo: true },
  });
  return !!usuario && usuario.ativo && (usuario.papel === 'GERENTE' || usuario.papel === 'ADMIN');
}

// ---------------------------------------------------------------------------
// Produto
// ---------------------------------------------------------------------------

export async function criarProduto(prisma: PrismaClient, entrada: EntradaCriarProduto): Promise<{ id: string }> {
  const produto = await prisma.produto.create({
    data: {
      nome: entrada.nome,
      descricao: entrada.descricao ?? null,
      marca: entrada.marca ?? null,
      categoriaId: entrada.categoriaId ?? null,
    },
  });
  return { id: produto.id };
}

export async function atualizarProduto(
  prisma: PrismaClient,
  produtoId: string,
  entrada: EntradaAtualizarProduto,
): Promise<{ id: string }> {
  const existente = await prisma.produto.findUnique({ where: { id: produtoId }, select: { id: true } });
  if (!existente) throw new ErroEstoque('PRODUTO_INEXISTENTE', 'Produto não encontrado.');

  await prisma.produto.update({
    where: { id: produtoId },
    data: {
      ...(entrada.nome !== undefined && { nome: entrada.nome }),
      ...(entrada.descricao !== undefined && { descricao: entrada.descricao }),
      ...(entrada.marca !== undefined && { marca: entrada.marca }),
      ...(entrada.categoriaId !== undefined && { categoriaId: entrada.categoriaId }),
      ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
    },
  });
  return { id: produtoId };
}

export interface ProdutoListado {
  readonly id: string;
  readonly nome: string;
  readonly descricao: string | null;
  readonly marca: string | null;
  readonly ativo: boolean;
  readonly categoria: string | null;
  readonly variantes: readonly {
    id: string;
    sku: string;
    codigoBarras: string | null;
    tamanho: string | null;
    cor: string | null;
    precoCentavos: number;
    custoCentavos: number;
    ativo: boolean;
    saldoEstoque: number;
  }[];
}

export interface ResultadoListaProdutos {
  readonly itens: readonly ProdutoListado[];
  readonly proximoCursor: string | null;
}

export async function listarProdutos(
  prisma: PrismaClient,
  entrada: EntradaListarProdutos,
): Promise<ResultadoListaProdutos> {
  const produtos = await prisma.produto.findMany({
    where: {
      ...(entrada.busca && { nome: { contains: entrada.busca, mode: 'insensitive' } }),
      ...(entrada.categoriaId && { categoriaId: entrada.categoriaId }),
      ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
    },
    include: { categoria: true, variantes: true },
    orderBy: { id: 'asc' },
    take: entrada.limite + 1,
    ...(entrada.cursor && { cursor: { id: entrada.cursor }, skip: 1 }),
  });

  const temMais = produtos.length > entrada.limite;
  const pagina = temMais ? produtos.slice(0, entrada.limite) : produtos;

  const varianteIds = pagina.flatMap((produto) => produto.variantes.map((variante) => variante.id));
  const saldos = await obterSaldosEstoque(prisma, varianteIds);

  const itens: ProdutoListado[] = pagina.map((produto) => ({
    id: produto.id,
    nome: produto.nome,
    descricao: produto.descricao,
    marca: produto.marca,
    ativo: produto.ativo,
    categoria: produto.categoria?.nome ?? null,
    variantes: produto.variantes.map((variante) => ({
      id: variante.id,
      sku: variante.sku,
      codigoBarras: variante.codigoBarras,
      tamanho: variante.tamanho,
      cor: variante.cor,
      precoCentavos: variante.precoCentavos,
      custoCentavos: variante.custoCentavos,
      ativo: variante.ativo,
      saldoEstoque: saldos.get(variante.id) ?? 0,
    })),
  }));

  return { itens, proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null };
}

// ---------------------------------------------------------------------------
// Variante
// ---------------------------------------------------------------------------

export async function criarVariante(
  prisma: PrismaClient,
  produtoId: string,
  entrada: EntradaCriarVariante,
): Promise<{ id: string }> {
  const produto = await prisma.produto.findUnique({ where: { id: produtoId }, select: { id: true } });
  if (!produto) throw new ErroEstoque('PRODUTO_INEXISTENTE', 'Produto não encontrado.');

  const variante = await prisma.variante.create({
    data: {
      produtoId,
      sku: entrada.sku,
      codigoBarras: entrada.codigoBarras ?? null,
      tamanho: entrada.tamanho ?? null,
      cor: entrada.cor ?? null,
      precoCentavos: entrada.precoCentavos,
      custoCentavos: entrada.custoCentavos ?? 0,
    },
  });
  return { id: variante.id };
}

export async function atualizarVariante(
  prisma: PrismaClient,
  varianteId: string,
  entrada: EntradaAtualizarVariante,
): Promise<{ id: string }> {
  const existente = await prisma.variante.findUnique({ where: { id: varianteId }, select: { id: true } });
  if (!existente) throw new ErroEstoque('VARIANTE_INEXISTENTE', 'Variante não encontrada.');

  await prisma.variante.update({
    where: { id: varianteId },
    data: {
      ...(entrada.precoCentavos !== undefined && { precoCentavos: entrada.precoCentavos }),
      ...(entrada.custoCentavos !== undefined && { custoCentavos: entrada.custoCentavos }),
      ...(entrada.tamanho !== undefined && { tamanho: entrada.tamanho }),
      ...(entrada.cor !== undefined && { cor: entrada.cor }),
      ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
    },
  });
  return { id: varianteId };
}

// ---------------------------------------------------------------------------
// Estoque
// ---------------------------------------------------------------------------

/** Soma assinada de MovimentoEstoque por variante — a definição de "saldo atual". */
export async function obterSaldosEstoque(
  prisma: PrismaClient,
  varianteIds: readonly string[],
): Promise<Map<string, number>> {
  if (varianteIds.length === 0) return new Map();
  const agregados = await prisma.movimentoEstoque.groupBy({
    by: ['varianteId'],
    where: { varianteId: { in: [...varianteIds] } },
    _sum: { quantidade: true },
  });
  return new Map(agregados.map((agregado) => [agregado.varianteId, agregado._sum.quantidade ?? 0]));
}

export interface EstoqueVariante {
  readonly varianteId: string;
  readonly saldo: number;
  readonly movimentos: readonly {
    id: string;
    tipo: string;
    quantidade: number;
    custoUnitarioCentavos: number;
    observacao: string | null;
    criadoEm: Date;
  }[];
}

export async function obterEstoqueVariante(
  prisma: PrismaClient,
  varianteId: string,
  limite = 50,
): Promise<EstoqueVariante> {
  const variante = await prisma.variante.findUnique({ where: { id: varianteId }, select: { id: true } });
  if (!variante) throw new ErroEstoque('VARIANTE_INEXISTENTE', 'Variante não encontrada.');

  const [saldos, movimentos] = await Promise.all([
    obterSaldosEstoque(prisma, [varianteId]),
    prisma.movimentoEstoque.findMany({
      where: { varianteId },
      orderBy: { criadoEm: 'desc' },
      take: limite,
    }),
  ]);

  return {
    varianteId,
    saldo: saldos.get(varianteId) ?? 0,
    movimentos: movimentos.map((movimento) => ({
      id: movimento.id,
      tipo: movimento.tipo,
      quantidade: movimento.quantidade,
      custoUnitarioCentavos: movimento.custoUnitarioCentavos,
      observacao: movimento.observacao,
      criadoEm: movimento.criadoEm,
    })),
  };
}

export async function registrarMovimentoEstoqueManual(
  prisma: PrismaClient,
  varianteId: string,
  entrada: EntradaMovimentoEstoque,
  contexto: { operadorId: string },
): Promise<{ id: string }> {
  const tipo = entrada.tipo as TipoMovimentoManualEstoque;
  const ehGerente = await autorizadorEhGerente(prisma, entrada.autorizadoPorId);

  validarMovimentoManualEstoque(tipo, entrada.quantidade, {
    autorizadoPorId: entrada.autorizadoPorId,
    autorizadorEhGerente: ehGerente,
  });

  const variante = await prisma.variante.findUnique({ where: { id: varianteId }, select: { id: true } });
  if (!variante) throw new ErroEstoque('VARIANTE_INEXISTENTE', 'Variante não encontrada.');

  const movimento = await prisma.$transaction(async (tx) => {
    const registro = await tx.movimentoEstoque.create({
      data: {
        varianteId,
        tipo,
        quantidade: entrada.quantidade,
        custoUnitarioCentavos: entrada.custoUnitarioCentavos ?? 0,
        observacao: entrada.observacao ?? null,
        usuarioId: contexto.operadorId,
        documentoTipo: 'AJUSTE_MANUAL',
      },
    });

    // Perda e ajuste de inventário mexem no estoque sem nota fiscal por
    // trás — sempre auditados, com quem autorizou.
    if (tipo === 'PERDA' || tipo === 'AJUSTE_INVENTARIO') {
      await tx.registroAuditoria.create({
        data: {
          acao: tipo,
          entidade: 'Variante',
          entidadeId: varianteId,
          usuarioId: contexto.operadorId,
          autorizadoPorId: entrada.autorizadoPorId ?? null,
          valorDepois: { quantidade: entrada.quantidade, observacao: entrada.observacao ?? null },
        },
      });
    }

    return registro;
  });

  return { id: movimento.id };
}
