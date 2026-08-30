/**
 * Importação de XML de NF-e (nota de entrada/compra).
 *
 * A nota fiscal nunca traz preço de venda — só custo. Por isso o fluxo é em
 * duas etapas:
 *
 *   1. `preVisualizarImportacao` — só lê o XML e casa cada item por
 *      código de barras (EAN) com variante existente. Nada é gravado.
 *   2. `confirmarImportacao` — recebe de volta a mesma lista, já revisada
 *      pelo operador (produtos novos ganharam nome/preço de venda), e grava
 *      tudo em transação: cria produto/variante que faltar e lança
 *      `MovimentoEstoque(ENTRADA_COMPRA)` para cada item.
 */

import { XMLParser } from 'fast-xml-parser';
import type { PrismaClient } from '@prisma/client';
import { ErroEstoque } from '@pdv/shared';
import type { EntradaConfirmarImportacaoXml } from '../esquemas/produto.js';

interface ItemNotaFiscal {
  readonly codigoBarras: string | null;
  readonly descricao: string;
  readonly ncm: string | null;
  readonly quantidade: number;
  readonly custoUnitarioCentavos: number;
}

export interface ItemPreviaImportacao extends ItemNotaFiscal {
  readonly varianteExistenteId: string | null;
  readonly skuExistente: string | null;
  readonly nomeExistente: string | null;
}

export interface PreviaImportacao {
  readonly numeroNota: string | null;
  readonly itens: readonly ItemPreviaImportacao[];
}

function paraNumero(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    throw new ErroEstoque('XML_INVALIDO', `Valor numérico inválido na nota: "${String(valor)}".`);
  }
  return numero;
}

function extrairItens(xml: string): { numeroNota: string | null; itens: ItemNotaFiscal[] } {
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });
  let documento: unknown;
  try {
    documento = parser.parse(xml);
  } catch {
    throw new ErroEstoque('XML_INVALIDO', 'Não foi possível ler o XML enviado.');
  }

  const raiz = documento as Record<string, any>;
  const infNFe = raiz?.nfeProc?.NFe?.infNFe ?? raiz?.NFe?.infNFe ?? raiz?.infNFe;
  if (!infNFe) {
    throw new ErroEstoque('XML_INVALIDO', 'XML não parece ser uma NF-e (tag infNFe não encontrada).');
  }

  const numeroNota: string | null = infNFe?.ide?.nNF ? String(infNFe.ide.nNF) : null;

  const detBruto = infNFe.det;
  if (!detBruto) {
    throw new ErroEstoque('XML_INVALIDO', 'Nota fiscal sem itens (tag det ausente).');
  }
  const detalhes = Array.isArray(detBruto) ? detBruto : [detBruto];

  const itens: ItemNotaFiscal[] = detalhes.map((det) => {
    const prod = det?.prod;
    if (!prod) throw new ErroEstoque('XML_INVALIDO', 'Item da nota sem tag prod.');

    const ean = typeof prod.cEAN === 'string' ? prod.cEAN.trim() : String(prod.cEAN ?? '').trim();

    return {
      codigoBarras: ean && ean !== 'SEM GTIN' && ean !== '' ? ean : null,
      descricao: String(prod.xProd ?? '').trim(),
      ncm: prod.NCM ? String(prod.NCM) : null,
      quantidade: Math.round(paraNumero(prod.qCom)),
      custoUnitarioCentavos: Math.round(paraNumero(prod.vUnCom) * 100),
    };
  });

  return { numeroNota, itens };
}

export async function preVisualizarImportacao(prisma: PrismaClient, xml: string): Promise<PreviaImportacao> {
  const { numeroNota, itens } = extrairItens(xml);

  const codigosBarras = itens.map((item) => item.codigoBarras).filter((codigo): codigo is string => !!codigo);
  const variantesExistentes =
    codigosBarras.length > 0
      ? await prisma.variante.findMany({
          where: { codigoBarras: { in: codigosBarras } },
          select: { id: true, sku: true, codigoBarras: true, produto: { select: { nome: true } } },
        })
      : [];
  const porCodigoBarras = new Map(variantesExistentes.map((variante) => [variante.codigoBarras, variante]));

  return {
    numeroNota,
    itens: itens.map((item) => {
      const existente = item.codigoBarras ? porCodigoBarras.get(item.codigoBarras) : undefined;
      return {
        ...item,
        varianteExistenteId: existente?.id ?? null,
        skuExistente: existente?.sku ?? null,
        nomeExistente: existente?.produto.nome ?? null,
      };
    }),
  };
}

export async function confirmarImportacao(
  prisma: PrismaClient,
  entrada: EntradaConfirmarImportacaoXml,
  contexto: { operadorId: string },
): Promise<{ movimentosCriados: number }> {
  for (const item of entrada.itens) {
    if (!item.varianteId && !item.produtoNovo) {
      throw new ErroEstoque(
        'ITEM_SEM_DESTINO',
        'Todo item precisa apontar para uma variante existente ou trazer dados de produto novo.',
      );
    }
  }

  const criados = await prisma.$transaction(async (tx) => {
    let quantidadeMovimentos = 0;

    for (const item of entrada.itens) {
      let varianteId = item.varianteId;

      if (!varianteId && item.produtoNovo) {
        const produto = await tx.produto.create({
          data: {
            nome: item.produtoNovo.nome,
            categoriaId: item.produtoNovo.categoriaId ?? null,
          },
        });
        const variante = await tx.variante.create({
          data: {
            produtoId: produto.id,
            sku: item.produtoNovo.sku,
            codigoBarras: item.codigoBarras ?? null,
            precoCentavos: item.produtoNovo.precoCentavos,
            custoCentavos: item.custoUnitarioCentavos,
          },
        });
        varianteId = variante.id;
      }

      await tx.movimentoEstoque.create({
        data: {
          varianteId: varianteId!,
          tipo: 'ENTRADA_COMPRA',
          quantidade: item.quantidade,
          custoUnitarioCentavos: item.custoUnitarioCentavos,
          documentoTipo: 'NFE_IMPORTADA',
          documentoId: entrada.numeroNota ?? null,
          usuarioId: contexto.operadorId,
        },
      });
      quantidadeMovimentos += 1;
    }

    return quantidadeMovimentos;
  });

  return { movimentosCriados: criados };
}
