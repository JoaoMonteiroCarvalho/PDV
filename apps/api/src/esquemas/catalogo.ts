/**
 * Contrato HTTP do cadastro de catálogo.
 *
 * Dinheiro entra em CENTAVOS inteiros, como em toda fronteira do sistema —
 * `z.number().int()` recusa float antes de o domínio ver o valor.
 *
 * Os campos fiscais (`ncm`, `cest`, `origem`, `situacaoTributaria`) são aceitos
 * e gravados, mas nada os lê nesta versão. Existem aqui para a loja poder ir
 * preenchendo conforme cadastra, em vez de ter que revisitar dez mil SKUs no
 * dia em que a NFC-e for ligada.
 */

import { z } from 'zod';

const centavosNaoNegativos = z
  .number()
  .int('Valor monetário deve ser inteiro em centavos — float não é aceito')
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

/**
 * SKU: o código que a loja usa para achar a peça. Normalizado para maiúsculas
 * porque quem digita no balcão não distingue caixa, e dois SKUs que só diferem
 * nisso seriam dois produtos diferentes para o banco e o mesmo para a pessoa.
 */
const sku = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9._/-]+$/, 'Use letras sem acento, números, ponto, barra, hífen ou sublinhado.');

/**
 * Código de barras. Só dígitos e comprimento de EAN/UPC — é o que o leitor
 * emite, e aceitar qualquer string deixaria passar um código que o scanner
 * nunca vai encontrar.
 */
const codigoBarras = z
  .string()
  .trim()
  .regex(/^\d{8,14}$/, 'Código de barras tem de 8 a 14 dígitos.');

/** Texto opcional que vira `null` quando vazio — nunca string vazia no banco. */
const textoOpcional = (max: number) => z.string().trim().max(max).optional();

export const esquemaVarianteNova = z.object({
  sku,
  codigoBarras: codigoBarras.optional(),
  tamanho: textoOpcional(20),
  cor: textoOpcional(30),
  precoCentavos: centavosNaoNegativos,
  custoCentavos: centavosNaoNegativos.default(0),
});

export const esquemaCriarProduto = z.object({
  nome: z.string().trim().min(2).max(120),
  descricao: textoOpcional(500),
  marca: textoOpcional(60),
  categoriaId: z.string().uuid().optional(),

  ncm: textoOpcional(10),
  cest: textoOpcional(10),
  origem: z.number().int().min(0).max(8).optional(),
  situacaoTributaria: textoOpcional(10),

  /*
   * Produto nasce com a grade inteira. Peça de lingerie chega em P/M/G × três
   * cores; cadastrar o produto e depois nove variantes, uma requisição cada,
   * transformaria o cadastro da coleção numa tarde de trabalho — e deixaria
   * produto sem variante nenhuma toda vez que alguém desistisse no meio.
   */
  variantes: z.array(esquemaVarianteNova).min(1, 'Produto precisa de ao menos uma variação.'),
});

export const esquemaAtualizarProduto = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  descricao: textoOpcional(500),
  marca: textoOpcional(60),
  /** `null` desvincula da categoria; ausente deixa como está. */
  categoriaId: z.string().uuid().nullable().optional(),
  ncm: textoOpcional(10),
  cest: textoOpcional(10),
  origem: z.number().int().min(0).max(8).optional(),
  situacaoTributaria: textoOpcional(10),
  ativo: z.boolean().optional(),
});

export const esquemaAtualizarVariante = z.object({
  sku: sku.optional(),
  /** `null` remove o código de barras. */
  codigoBarras: codigoBarras.nullable().optional(),
  tamanho: textoOpcional(20),
  cor: textoOpcional(30),
  precoCentavos: centavosNaoNegativos.optional(),
  custoCentavos: centavosNaoNegativos.optional(),
  ativo: z.boolean().optional(),
});

export const esquemaListarProdutos = z.object({
  busca: z.string().trim().min(1).optional(),
  categoriaId: z.string().uuid().optional(),
  /** Por padrão a lista esconde o que foi desativado. */
  incluirInativos: z.coerce.boolean().default(false),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

export const esquemaCriarCategoria = z.object({
  nome: z.string().trim().min(2).max(60),
});

/**
 * Ajuste de inventário.
 *
 * A entrada é a quantidade CONTADA na arara, não a diferença. Quem confere
 * estoque conta peça, não calcula delta — pedir a diferença seria pedir que a
 * pessoa fizesse a conta que o sistema sabe fazer, e errar o sinal aqui
 * inverte o ajuste.
 */
export const esquemaAjusteInventario = z.object({
  quantidadeContada: z.number().int().min(0),
  /** Obrigatória: ajuste sem motivo registrado é como sumiço vira "erro de sistema". */
  observacao: z.string().trim().min(3).max(200),
});

export const esquemaHistoricoMovimentacao = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export type CriarProdutoEntrada = z.infer<typeof esquemaCriarProduto>;
export type AtualizarProdutoEntrada = z.infer<typeof esquemaAtualizarProduto>;
export type AtualizarVarianteEntrada = z.infer<typeof esquemaAtualizarVariante>;
export type ListarProdutosEntrada = z.infer<typeof esquemaListarProdutos>;
export type AjusteInventarioEntrada = z.infer<typeof esquemaAjusteInventario>;
