import { z } from 'zod';

export const esquemaCriarProduto = z.object({
  nome: z.string().min(1).max(200),
  descricao: z.string().max(1000).optional(),
  marca: z.string().max(120).optional(),
  categoriaId: z.string().uuid().optional(),
});
export type EntradaCriarProduto = z.infer<typeof esquemaCriarProduto>;

export const esquemaAtualizarProduto = z.object({
  nome: z.string().min(1).max(200).optional(),
  descricao: z.string().max(1000).optional(),
  marca: z.string().max(120).optional(),
  categoriaId: z.string().uuid().optional(),
  ativo: z.boolean().optional(),
});
export type EntradaAtualizarProduto = z.infer<typeof esquemaAtualizarProduto>;

const centavosPositivos = z.number().int().positive();
const centavosNaoNegativos = z.number().int().nonnegative();

export const esquemaCriarVariante = z.object({
  sku: z.string().min(1).max(60),
  codigoBarras: z.string().max(60).optional(),
  tamanho: z.string().max(30).optional(),
  cor: z.string().max(30).optional(),
  precoCentavos: centavosPositivos,
  custoCentavos: centavosNaoNegativos.optional(),
});
export type EntradaCriarVariante = z.infer<typeof esquemaCriarVariante>;

export const esquemaAtualizarVariante = z.object({
  precoCentavos: centavosPositivos.optional(),
  custoCentavos: centavosNaoNegativos.optional(),
  tamanho: z.string().max(30).optional(),
  cor: z.string().max(30).optional(),
  ativo: z.boolean().optional(),
});
export type EntradaAtualizarVariante = z.infer<typeof esquemaAtualizarVariante>;

export const esquemaListarProdutos = z.object({
  busca: z.string().max(200).optional(),
  categoriaId: z.string().uuid().optional(),
  ativo: z.coerce.boolean().optional(),
  cursor: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type EntradaListarProdutos = z.infer<typeof esquemaListarProdutos>;

export const esquemaMovimentoEstoque = z.object({
  tipo: z.enum(['ENTRADA_COMPRA', 'PERDA', 'AJUSTE_INVENTARIO']),
  quantidade: z.number().int(),
  custoUnitarioCentavos: centavosNaoNegativos.optional(),
  observacao: z.string().max(500).optional(),
  autorizadoPorId: z.string().uuid().optional(),
});
export type EntradaMovimentoEstoque = z.infer<typeof esquemaMovimentoEstoque>;

export const esquemaImportarXml = z.object({
  xml: z.string().min(1),
});
export type EntradaImportarXml = z.infer<typeof esquemaImportarXml>;

const esquemaItemImportacaoConfirmado = z.object({
  codigoBarras: z.string().max(60).optional(),
  varianteId: z.string().uuid().optional(),
  produtoNovo: z
    .object({
      nome: z.string().min(1).max(200),
      categoriaId: z.string().uuid().optional(),
      precoCentavos: centavosPositivos,
      sku: z.string().min(1).max(60),
    })
    .optional(),
  quantidade: z.number().int().positive(),
  custoUnitarioCentavos: centavosNaoNegativos,
});

export const esquemaConfirmarImportacaoXml = z.object({
  numeroNota: z.string().max(60).optional(),
  itens: z.array(esquemaItemImportacaoConfirmado).min(1),
});
export type EntradaConfirmarImportacaoXml = z.infer<typeof esquemaConfirmarImportacaoXml>;
