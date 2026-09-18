/**
 * Regras de UI da tela de devolução — o que a tela decide ANTES de mandar
 * qualquer coisa ao servidor.
 *
 * O cálculo de dinheiro (total a devolver, rateio de desconto) mora em
 * `@pdv/shared` e é o mesmo código do servidor — não é reproduzido aqui. Este
 * arquivo só resolve o que é específico da tela: quanto cada linha pode
 * subir/descer, e quando o botão de confirmar libera.
 */

import type { ItemDisponivelParaDevolucao } from '../api/cliente.js';

/** O que ainda pode ser devolvido de um item — nunca negativo. */
export function quantidadeDisponivel(item: ItemDisponivelParaDevolucao): number {
  return Math.max(0, item.quantidadeVendida - item.quantidadeJaDevolvida);
}

/**
 * Ajusta a quantidade marcada para devolução de um item, sem deixar passar
 * do disponível nem cair abaixo de zero.
 *
 * A tela usa isto tanto no botão "+"/"−" quanto numa eventual digitação
 * direta — centralizar aqui evita que um caminho esqueça o teto e o outro
 * não.
 */
export function ajustarQuantidade(
  item: ItemDisponivelParaDevolucao,
  quantidadeAtual: number,
  delta: number,
): number {
  const proposta = quantidadeAtual + delta;
  return Math.min(Math.max(0, proposta), quantidadeDisponivel(item));
}

export interface LinhaDevolucao {
  readonly itemVendaId: string;
  readonly quantidade: number;
}

/** Soma o valor a devolver, dado quanto de cada item foi marcado. */
export function totalADevolverCentavos(
  itens: readonly ItemDisponivelParaDevolucao[],
  marcados: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const item of itens) {
    const quantidade = marcados.get(item.itemVendaId) ?? 0;
    total += quantidade * item.precoUnitarioLiquidoCentavos;
  }
  return total;
}

/**
 * A devolução só pode ser confirmada com pelo menos uma peça marcada, motivo
 * preenchido e gerente identificada.
 *
 * Não valida forma de estorno aqui: ela sempre tem um valor padrão
 * selecionado na tela, então nunca fica vazia — validar um campo que a UI
 * nunca deixa vazio só duplicaria uma garantia que o `<select>` já dá.
 */
export function podeConfirmarDevolucao(params: {
  readonly totalCentavos: number;
  readonly motivo: string;
  readonly gerenteId: string | null;
}): boolean {
  return params.totalCentavos > 0 && params.motivo.trim().length > 0 && params.gerenteId !== null;
}

/** Monta os itens no formato que a API espera, descartando os zerados. */
export function itensParaEnviar(
  marcados: ReadonlyMap<string, number>,
): { itemVendaId: string; quantidade: number }[] {
  return [...marcados.entries()]
    .filter(([, quantidade]) => quantidade > 0)
    .map(([itemVendaId, quantidade]) => ({ itemVendaId, quantidade }));
}
