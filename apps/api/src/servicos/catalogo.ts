/**
 * Cadastro de catálogo: categoria, produto e variante.
 *
 * Três regras governam este arquivo.
 *
 * 1. **Nada é apagado, só desativado.** Variante assina `ItemVenda` e
 *    `MovimentoEstoque`; apagar romperia a chave estrangeira ou, pior, apagaria
 *    o que foi vendido. `ativo: false` também é o canal pelo qual o caixa
 *    remove o item do índice local — a sincronização devolve o registro
 *    desativado de propósito, em vez de omiti-lo (ver `GET /catalogo`).
 *
 * 2. **Mudança de preço é evento de auditoria.** Preço é dinheiro, e quem
 *    mudou de quanto para quanto é exatamente o que ninguém consegue
 *    reconstituir depois. O schema já reservava a ação `ALTERACAO_PRECO`.
 *
 * 3. **SKU e código de barras são únicos, e o erro diz qual conflitou.**
 *    Devolver "violação de restrição" faria a operadora tentar de novo sem
 *    saber o que mudar.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AtualizarProdutoEntrada,
  AtualizarVarianteEntrada,
  CriarProdutoEntrada,
  ListarProdutosEntrada,
} from '../esquemas/catalogo.js';

export class ErroCatalogo extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroCatalogo';
  }
}

/** Campo vazio vira `null`, nunca string vazia — o banco distingue os dois. */
function ouNulo(valor: string | undefined): string | null {
  return valor !== undefined && valor.length > 0 ? valor : null;
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export async function listarCategorias(prisma: PrismaClient) {
  return prisma.categoria.findMany({
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true, ativo: true, _count: { select: { produtos: true } } },
  });
}

export async function criarCategoria(prisma: PrismaClient, nome: string) {
  const existente = await prisma.categoria.findUnique({ where: { nome }, select: { id: true } });
  if (existente) {
    throw new ErroCatalogo('CATEGORIA_EM_USO', `Já existe a categoria "${nome}".`);
  }
  return prisma.categoria.create({
    data: { nome },
    select: { id: true, nome: true, ativo: true },
  });
}

// ---------------------------------------------------------------------------
// Unicidade
// ---------------------------------------------------------------------------

/**
 * Confere SKU e código de barras ANTES de gravar qualquer coisa.
 *
 * `exceto` permite editar uma variante sem que ela colida consigo mesma.
 */
async function garantirCodigosLivres(
  prisma: Prisma.TransactionClient | PrismaClient,
  codigos: readonly { readonly sku?: string | undefined; readonly codigoBarras?: string | null | undefined }[],
  exceto?: string,
): Promise<void> {
  const skus = codigos.map((c) => c.sku).filter((valor): valor is string => !!valor);
  const barras = codigos
    .map((c) => c.codigoBarras)
    .filter((valor): valor is string => typeof valor === 'string' && valor.length > 0);

  // Duplicata dentro do próprio lote: cadastrar P/M/G com o mesmo SKU é o erro
  // mais fácil de cometer colando linha, e o banco só reclamaria da segunda.
  const skuRepetido = skus.find((valor, indice) => skus.indexOf(valor) !== indice);
  if (skuRepetido) {
    throw new ErroCatalogo('SKU_EM_USO', `O SKU "${skuRepetido}" aparece duas vezes neste cadastro.`);
  }
  const barrasRepetido = barras.find((valor, indice) => barras.indexOf(valor) !== indice);
  if (barrasRepetido) {
    throw new ErroCatalogo(
      'CODIGO_BARRAS_EM_USO',
      `O código de barras "${barrasRepetido}" aparece duas vezes neste cadastro.`,
    );
  }

  if (skus.length > 0) {
    const conflito = await prisma.variante.findFirst({
      where: { sku: { in: skus }, ...(exceto ? { id: { not: exceto } } : {}) },
      select: { sku: true, produto: { select: { nome: true } } },
    });
    if (conflito) {
      throw new ErroCatalogo(
        'SKU_EM_USO',
        `O SKU "${conflito.sku}" já é usado por "${conflito.produto.nome}".`,
      );
    }
  }

  if (barras.length > 0) {
    const conflito = await prisma.variante.findFirst({
      where: { codigoBarras: { in: barras }, ...(exceto ? { id: { not: exceto } } : {}) },
      select: { codigoBarras: true, produto: { select: { nome: true } } },
    });
    if (conflito) {
      throw new ErroCatalogo(
        'CODIGO_BARRAS_EM_USO',
        `O código de barras "${conflito.codigoBarras}" já é usado por "${conflito.produto.nome}".`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listarProdutos(prisma: PrismaClient, filtros: ListarProdutosEntrada) {
  const filtro: Prisma.ProdutoWhereInput = {
    ...(filtros.incluirInativos ? {} : { ativo: true }),
    ...(filtros.categoriaId ? { categoriaId: filtros.categoriaId } : {}),
    ...(filtros.busca
      ? {
          OR: [
            { nome: { contains: filtros.busca, mode: 'insensitive' } },
            { marca: { contains: filtros.busca, mode: 'insensitive' } },
            // Achar o produto pelo SKU de uma variação: é o código que a
            // operadora tem em mãos, não o nome que ela talvez não lembre.
            { variantes: { some: { sku: { contains: filtros.busca, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [produtos, total] = await Promise.all([
    prisma.produto.findMany({
      where: filtro,
      orderBy: { nome: 'asc' },
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      select: {
        id: true,
        nome: true,
        marca: true,
        ativo: true,
        categoria: { select: { id: true, nome: true } },
        _count: { select: { variantes: true } },
      },
    }),
    prisma.produto.count({ where: filtro }),
  ]);

  return {
    itens: produtos.map((produto) => ({
      id: produto.id,
      nome: produto.nome,
      marca: produto.marca,
      ativo: produto.ativo,
      categoria: produto.categoria,
      quantidadeVariantes: produto._count.variantes,
    })),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

/** Ficha do produto com a grade inteira e o saldo de cada variação. */
export async function obterProduto(prisma: PrismaClient, produtoId: string) {
  const produto = await prisma.produto.findUnique({
    where: { id: produtoId },
    select: {
      id: true,
      nome: true,
      descricao: true,
      marca: true,
      ativo: true,
      ncm: true,
      cest: true,
      origem: true,
      situacaoTributaria: true,
      categoria: { select: { id: true, nome: true } },
      variantes: {
        orderBy: [{ tamanho: 'asc' }, { cor: 'asc' }],
        select: {
          id: true,
          sku: true,
          codigoBarras: true,
          tamanho: true,
          cor: true,
          precoCentavos: true,
          custoCentavos: true,
          ativo: true,
        },
      },
    },
  });
  if (!produto) throw new ErroCatalogo('PRODUTO_INEXISTENTE', 'Produto não encontrado.');

  const saldos = await saldoDasVariantes(
    prisma,
    produto.variantes.map((variante) => variante.id),
  );

  return {
    ...produto,
    variantes: produto.variantes.map((variante) => ({
      ...variante,
      saldoEstoque: saldos.get(variante.id) ?? 0,
    })),
  };
}

/** Saldo do livro-razão, pela view `EstoqueAtual`. Nunca um campo editado. */
export async function saldoDasVariantes(
  prisma: PrismaClient,
  varianteIds: readonly string[],
): Promise<Map<string, number>> {
  if (varianteIds.length === 0) return new Map();
  const linhas = await prisma.$queryRaw<{ varianteId: string; saldo: number }[]>`
    SELECT "varianteId", "saldo" FROM "EstoqueAtual"
    WHERE "varianteId" IN (${Prisma.join([...varianteIds])})
  `;
  return new Map(linhas.map((linha) => [linha.varianteId, linha.saldo]));
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export async function criarProduto(
  prisma: PrismaClient,
  entrada: CriarProdutoEntrada,
  contexto: { operadorId: string },
) {
  await garantirCodigosLivres(prisma, entrada.variantes);

  if (entrada.categoriaId) {
    const categoria = await prisma.categoria.findUnique({
      where: { id: entrada.categoriaId },
      select: { id: true },
    });
    if (!categoria) throw new ErroCatalogo('CATEGORIA_INEXISTENTE', 'Categoria não encontrada.');
  }

  return prisma.$transaction(async (tx) => {
    const produto = await tx.produto.create({
      data: {
        nome: entrada.nome,
        descricao: ouNulo(entrada.descricao),
        marca: ouNulo(entrada.marca),
        categoriaId: entrada.categoriaId ?? null,
        ncm: ouNulo(entrada.ncm),
        cest: ouNulo(entrada.cest),
        origem: entrada.origem ?? null,
        situacaoTributaria: ouNulo(entrada.situacaoTributaria),
        variantes: {
          create: entrada.variantes.map((variante) => ({
            sku: variante.sku,
            codigoBarras: ouNulo(variante.codigoBarras),
            tamanho: ouNulo(variante.tamanho),
            cor: ouNulo(variante.cor),
            precoCentavos: variante.precoCentavos,
            custoCentavos: variante.custoCentavos,
          })),
        },
      },
      select: { id: true, nome: true, variantes: { select: { id: true, sku: true } } },
    });

    await tx.registroAuditoria.create({
      data: {
        acao: 'CADASTRO_PRODUTO',
        entidade: 'Produto',
        entidadeId: produto.id,
        usuarioId: contexto.operadorId,
        valorDepois: {
          nome: produto.nome,
          variantes: produto.variantes.length,
          skus: produto.variantes.map((variante) => variante.sku),
        } as Prisma.InputJsonValue,
      },
    });

    return produto;
  });
}

export async function atualizarProduto(
  prisma: PrismaClient,
  produtoId: string,
  entrada: AtualizarProdutoEntrada,
  contexto: { operadorId: string },
) {
  const atual = await prisma.produto.findUnique({
    where: { id: produtoId },
    select: { id: true, nome: true, ativo: true },
  });
  if (!atual) throw new ErroCatalogo('PRODUTO_INEXISTENTE', 'Produto não encontrado.');

  if (entrada.categoriaId) {
    const categoria = await prisma.categoria.findUnique({
      where: { id: entrada.categoriaId },
      select: { id: true },
    });
    if (!categoria) throw new ErroCatalogo('CATEGORIA_INEXISTENTE', 'Categoria não encontrada.');
  }

  return prisma.$transaction(async (tx) => {
    const produto = await tx.produto.update({
      where: { id: produtoId },
      data: {
        ...(entrada.nome !== undefined && { nome: entrada.nome }),
        ...(entrada.descricao !== undefined && { descricao: ouNulo(entrada.descricao) }),
        ...(entrada.marca !== undefined && { marca: ouNulo(entrada.marca) }),
        ...(entrada.categoriaId !== undefined && { categoriaId: entrada.categoriaId }),
        ...(entrada.ncm !== undefined && { ncm: ouNulo(entrada.ncm) }),
        ...(entrada.cest !== undefined && { cest: ouNulo(entrada.cest) }),
        ...(entrada.origem !== undefined && { origem: entrada.origem }),
        ...(entrada.situacaoTributaria !== undefined && {
          situacaoTributaria: ouNulo(entrada.situacaoTributaria),
        }),
        ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
      },
      select: { id: true, nome: true, ativo: true },
    });

    /*
     * Desativar produto derruba todas as variações dele no caixa de uma vez
     * (ver `GET /catalogo`). Isso tira peça de venda, então fica registrado.
     */
    if (entrada.ativo !== undefined && entrada.ativo !== atual.ativo) {
      await tx.registroAuditoria.create({
        data: {
          acao: entrada.ativo ? 'REATIVACAO_PRODUTO' : 'DESATIVACAO_PRODUTO',
          entidade: 'Produto',
          entidadeId: produtoId,
          usuarioId: contexto.operadorId,
          valorAntes: { nome: atual.nome, ativo: atual.ativo } as Prisma.InputJsonValue,
          valorDepois: { nome: produto.nome, ativo: produto.ativo } as Prisma.InputJsonValue,
        },
      });
    }

    return produto;
  });
}

export async function criarVariante(
  prisma: PrismaClient,
  produtoId: string,
  entrada: {
    sku: string;
    codigoBarras?: string | undefined;
    tamanho?: string | undefined;
    cor?: string | undefined;
    precoCentavos: number;
    custoCentavos: number;
  },
  contexto: { operadorId: string },
) {
  const produto = await prisma.produto.findUnique({
    where: { id: produtoId },
    select: { id: true, nome: true },
  });
  if (!produto) throw new ErroCatalogo('PRODUTO_INEXISTENTE', 'Produto não encontrado.');

  await garantirCodigosLivres(prisma, [entrada]);

  return prisma.$transaction(async (tx) => {
    const variante = await tx.variante.create({
      data: {
        produtoId,
        sku: entrada.sku,
        codigoBarras: ouNulo(entrada.codigoBarras),
        tamanho: ouNulo(entrada.tamanho),
        cor: ouNulo(entrada.cor),
        precoCentavos: entrada.precoCentavos,
        custoCentavos: entrada.custoCentavos,
      },
      select: { id: true, sku: true, tamanho: true, cor: true, precoCentavos: true },
    });

    await tx.registroAuditoria.create({
      data: {
        acao: 'CADASTRO_VARIANTE',
        entidade: 'Variante',
        entidadeId: variante.id,
        usuarioId: contexto.operadorId,
        valorDepois: {
          produto: produto.nome,
          sku: variante.sku,
          precoCentavos: variante.precoCentavos,
        } as Prisma.InputJsonValue,
      },
    });

    return variante;
  });
}

export async function atualizarVariante(
  prisma: PrismaClient,
  varianteId: string,
  entrada: AtualizarVarianteEntrada,
  contexto: { operadorId: string },
) {
  const atual = await prisma.variante.findUnique({
    where: { id: varianteId },
    select: {
      id: true,
      sku: true,
      precoCentavos: true,
      custoCentavos: true,
      ativo: true,
      produto: { select: { nome: true } },
    },
  });
  if (!atual) throw new ErroCatalogo('VARIANTE_INEXISTENTE', 'Variação não encontrada.');

  await garantirCodigosLivres(prisma, [entrada], varianteId);

  return prisma.$transaction(async (tx) => {
    const variante = await tx.variante.update({
      where: { id: varianteId },
      data: {
        ...(entrada.sku !== undefined && { sku: entrada.sku }),
        ...(entrada.codigoBarras !== undefined && { codigoBarras: entrada.codigoBarras }),
        ...(entrada.tamanho !== undefined && { tamanho: ouNulo(entrada.tamanho) }),
        ...(entrada.cor !== undefined && { cor: ouNulo(entrada.cor) }),
        ...(entrada.precoCentavos !== undefined && { precoCentavos: entrada.precoCentavos }),
        ...(entrada.custoCentavos !== undefined && { custoCentavos: entrada.custoCentavos }),
        ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
      },
      select: {
        id: true,
        sku: true,
        codigoBarras: true,
        tamanho: true,
        cor: true,
        precoCentavos: true,
        custoCentavos: true,
        ativo: true,
      },
    });

    /*
     * Preço é dinheiro: de quanto para quanto, por quem, e quando. Sem este
     * registro, "por que essa peça saiu por R$ 40?" não tem resposta — a venda
     * congela o preço praticado, mas não guarda quem o alterou no catálogo.
     */
    if (entrada.precoCentavos !== undefined && entrada.precoCentavos !== atual.precoCentavos) {
      await tx.registroAuditoria.create({
        data: {
          acao: 'ALTERACAO_PRECO',
          entidade: 'Variante',
          entidadeId: varianteId,
          usuarioId: contexto.operadorId,
          valorAntes: {
            produto: atual.produto.nome,
            sku: atual.sku,
            precoCentavos: atual.precoCentavos,
          } as Prisma.InputJsonValue,
          valorDepois: {
            sku: variante.sku,
            precoCentavos: variante.precoCentavos,
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (entrada.ativo !== undefined && entrada.ativo !== atual.ativo) {
      await tx.registroAuditoria.create({
        data: {
          acao: entrada.ativo ? 'REATIVACAO_VARIANTE' : 'DESATIVACAO_VARIANTE',
          entidade: 'Variante',
          entidadeId: varianteId,
          usuarioId: contexto.operadorId,
          valorAntes: {
            produto: atual.produto.nome,
            sku: atual.sku,
            ativo: atual.ativo,
          } as Prisma.InputJsonValue,
          valorDepois: { ativo: variante.ativo } as Prisma.InputJsonValue,
        },
      });
    }

    return variante;
  });
}
