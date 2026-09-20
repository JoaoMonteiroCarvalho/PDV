/**
 * Contrato HTTP da venda.
 *
 * Dinheiro trafega como INTEIRO em centavos, sempre. Nunca "89.90", nunca
 * string formatada. `z.number().int()` rejeita float na fronteira — é a
 * primeira barreira antes do domínio.
 */

import { z } from 'zod';

/** Valor monetário: inteiro, não negativo, dentro do intervalo seguro. */
const centavosNaoNegativos = z
  .number()
  .int('Valor monetário deve ser inteiro em centavos — float não é aceito')
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const centavosPositivos = centavosNaoNegativos.positive();

export const esquemaItemVenda = z.object({
  varianteId: z.string().uuid(),
  quantidade: z.number().int().positive(),
  precoUnitarioCentavos: centavosNaoNegativos,
  descontoCentavos: centavosNaoNegativos.default(0),
  /** Token de gerente que liberou desconto acima da alçada neste item. */
  tokenAutorizacao: z.string().min(1).optional(),
});

export const esquemaPagamentoVenda = z.object({
  forma: z.enum(['DINHEIRO', 'DEBITO', 'CREDITO', 'PIX', 'CREDIARIO']),
  valorCentavos: centavosPositivos,
  trocoCentavos: centavosNaoNegativos.default(0),
  /**
   * Dados digitados a partir do comprovante da maquininha, que opera separada
   * do PDV. São informativos: nenhuma venda depende deles para fechar.
   */
  bandeira: z.string().max(40).optional(),
  autorizacao: z.string().max(60).optional(),
  parcelasCartao: z.number().int().min(1).max(24).optional(),
});

export const esquemaCrediario = z.object({
  quantidadeParcelas: z.number().int().min(1).max(24),
  primeiroVencimento: z.coerce.date(),
});

export const esquemaRegistrarVenda = z
  .object({
    /**
     * UUID gerado NO CAIXA, antes de qualquer chamada de rede. É a chave de
     * idempotência: reenviar a mesma venda (retry da fila offline) devolve a
     * venda já registrada em vez de criar outra.
     */
    id: z.string().uuid(),
    sessaoCaixaId: z.string().uuid(),
    /**
     * Quem ATENDEU a cliente — base da comissão.
     *
     * Opcional: o caixa manda o operador logado por padrão, mas uma venda que
     * subiu de uma versão anterior do PWA, ainda na fila offline, não tem o
     * campo. Recusá-la por isso descartaria venda já paga e impressa.
     */
    vendedorId: z.string().uuid().optional(),
    clienteId: z.string().uuid().optional(),
    /** Relógio do caixa no fechamento. Pode ser bem anterior à chegada aqui. */
    criadaEmCliente: z.coerce.date(),
    itens: z.array(esquemaItemVenda).min(1, 'Venda precisa de ao menos um item'),
    descontoSobreTotalCentavos: centavosNaoNegativos.default(0),
    pagamentos: z.array(esquemaPagamentoVenda).min(1, 'Venda precisa de ao menos um pagamento'),
    /**
     * Token de gerente que liberou desconto acima da alçada no total.
     *
     * Diferente da devolução, aqui o token pode chegar EXPIRADO: a venda é
     * fechada offline e pode subir horas depois. A rota valida a assinatura
     * (que é o que impede forjar), não o prazo — recusar por validade
     * descartaria uma venda já paga e impressa.
     */
    tokenAutorizacao: z.string().min(1).optional(),
    crediario: esquemaCrediario.optional(),
  })
  .refine(
    (venda) =>
      !venda.pagamentos.some((pagamento) => pagamento.forma === 'CREDIARIO') || venda.crediario,
    {
      message: 'Pagamento no crediário exige o plano de parcelas.',
      path: ['crediario'],
    },
  )
  .refine((venda) => venda.criadaEmCliente.getTime() <= Date.now() + 5 * 60 * 1000, {
    message: 'Data da venda está no futuro — verifique o relógio do caixa.',
    path: ['criadaEmCliente'],
  });

export type EntradaRegistrarVenda = z.infer<typeof esquemaRegistrarVenda>;
