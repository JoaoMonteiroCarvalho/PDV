/**
 * Regras de negócio da devolução/cancelamento — funções puras, sem banco.
 *
 * A venda é imutável: devolução não a altera, é um DOCUMENTO NOVO que aponta
 * para ela. Por isso o cálculo aqui nunca reescreve nada da venda original —
 * só calcula quanto estornar e quanto devolver ao estoque, a partir do que
 * já foi vendido e do que já foi devolvido antes.
 *
 * Devolução exige gerente SEM exceção de valor — mesma disciplina de sangria
 * e suprimento: mexer em dinheiro fora do fluxo normal de venda é o ponto
 * clássico de fraude interna que a auditoria cobre sem alçada.
 */

import { type Centavos, ZERO, multiplicar, somar, subtrair } from './dinheiro.js';

export class ErroDevolucao extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDevolucao';
  }
}

export type FormaEstorno = 'DINHEIRO' | 'PIX' | 'CARTAO' | 'VALE_TROCA';

/** Item da venda original, com o que já foi devolvido antes considerado. */
export interface ItemDisponivelParaDevolucao {
  readonly itemVendaId: string;
  readonly varianteId: string;
  readonly quantidadeVendida: number;
  readonly quantidadeJaDevolvida: number;
  /** Preço já líquido de desconto, por unidade — para o estorno ser proporcional ao que a cliente pagou de fato. */
  readonly precoUnitarioLiquidoCentavos: Centavos;
}

export interface ItemParaDevolver {
  readonly itemVendaId: string;
  readonly quantidade: number;
}

export interface ItemDevolucaoCalculado extends ItemParaDevolver {
  readonly varianteId: string;
  readonly valorCentavos: Centavos;
}

export interface DevolucaoCalculada {
  readonly itens: readonly ItemDevolucaoCalculado[];
  readonly totalCentavos: Centavos;
}

/**
 * Calcula uma devolução parcial ou total, validando que nenhum item devolva
 * mais do que ainda está disponível (vendido − já devolvido antes).
 *
 * O valor de cada item devolvido é proporcional ao preço unitário JÁ LÍQUIDO
 * de desconto — devolver metade de um item que teve desconto devolve metade
 * do valor efetivamente pago, não do preço de tabela.
 */
export function calcularDevolucao(
  disponiveis: readonly ItemDisponivelParaDevolucao[],
  itensParaDevolver: readonly ItemParaDevolver[],
): DevolucaoCalculada {
  if (itensParaDevolver.length === 0) {
    throw new ErroDevolucao('DEVOLUCAO_SEM_ITENS', 'Selecione ao menos um item para devolver.');
  }

  const porId = new Map(disponiveis.map((item) => [item.itemVendaId, item]));

  const calculados: ItemDevolucaoCalculado[] = itensParaDevolver.map((pedido, indice) => {
    const item = porId.get(pedido.itemVendaId);
    if (!item) {
      throw new ErroDevolucao(
        'ITEM_INEXISTENTE',
        `Item ${indice + 1}: não pertence a esta venda ou não foi encontrado.`,
      );
    }
    if (!Number.isInteger(pedido.quantidade) || pedido.quantidade <= 0) {
      throw new ErroDevolucao(
        'QUANTIDADE_INVALIDA',
        `Item ${indice + 1}: quantidade a devolver deve ser inteiro positivo.`,
      );
    }

    const disponivel = item.quantidadeVendida - item.quantidadeJaDevolvida;
    if (pedido.quantidade > disponivel) {
      throw new ErroDevolucao(
        'QUANTIDADE_MAIOR_QUE_DISPONIVEL',
        `Item ${indice + 1}: tentando devolver ${pedido.quantidade}, mas só há ${disponivel} disponível ` +
          `(vendido ${item.quantidadeVendida}, já devolvido ${item.quantidadeJaDevolvida}).`,
      );
    }

    return {
      itemVendaId: item.itemVendaId,
      varianteId: item.varianteId,
      quantidade: pedido.quantidade,
      valorCentavos: multiplicar(item.precoUnitarioLiquidoCentavos, pedido.quantidade),
    };
  });

  // Mesmo item pedido duas vezes na mesma devolução: erro de cliente, não
  // soma silenciosa — evita devolver o dobro por payload malformado.
  const idsRepetidos = calculados
    .map((item) => item.itemVendaId)
    .filter((id, indice, lista) => lista.indexOf(id) !== indice);
  if (idsRepetidos.length > 0) {
    throw new ErroDevolucao(
      'ITEM_DUPLICADO',
      `Item aparece mais de uma vez na mesma devolução: ${[...new Set(idsRepetidos)].join(', ')}.`,
    );
  }

  return {
    itens: calculados,
    totalCentavos: somar(...calculados.map((item) => item.valorCentavos), ZERO),
  };
}

// ---------------------------------------------------------------------------
// Autorização — devolução SEMPRE exige gerente, sem alçada de valor
// ---------------------------------------------------------------------------

export interface ContextoAutorizacaoDevolucao {
  readonly autorizadoPorId?: string | undefined;
  readonly autorizadorEhGerente: boolean;
}

export function validarAutorizacaoDevolucao(contexto: ContextoAutorizacaoDevolucao): void {
  if (!contexto.autorizadoPorId) {
    throw new ErroDevolucao('AUTORIZACAO_OBRIGATORIA', 'Devolução exige gerente identificado.');
  }
  if (!contexto.autorizadorEhGerente) {
    throw new ErroDevolucao('AUTORIZADOR_SEM_PERMISSAO', 'Quem autorizou não tem perfil de gerente.');
  }
}

// ---------------------------------------------------------------------------
// Movimentos de estoque e caixa gerados pela devolução
// ---------------------------------------------------------------------------

/** A peça devolvida volta ao estoque: quantidade positiva no livro-razão. */
export function movimentosDeEstoqueDaDevolucao(
  devolucao: DevolucaoCalculada,
): { varianteId: string; tipo: 'CANCELAMENTO_VENDA'; quantidade: number }[] {
  return devolucao.itens.map((item) => ({
    varianteId: item.varianteId,
    tipo: 'CANCELAMENTO_VENDA' as const,
    quantidade: item.quantidade,
  }));
}

/**
 * Só DINHEIRO e PIX tiram dinheiro da gaveta na hora — a maquininha de
 * cartão opera separada do PDV e não tem como ser estornada automaticamente
 * por aqui, e vale-troca não mexe em caixa nenhum (vira crédito futuro).
 */
export function movimentoDeCaixaDaDevolucao(
  formaEstorno: FormaEstorno,
  valorCentavos: Centavos,
): { tipo: 'CANCELAMENTO'; valorCentavos: Centavos } | null {
  if (formaEstorno !== 'DINHEIRO' && formaEstorno !== 'PIX') return null;
  return { tipo: 'CANCELAMENTO', valorCentavos: subtrair(ZERO, valorCentavos) };
}

/** Usado pela API para validar o campo antes de bater no banco. */
export function ehFormaEstornoValida(valor: string): valor is FormaEstorno {
  return valor === 'DINHEIRO' || valor === 'PIX' || valor === 'CARTAO' || valor === 'VALE_TROCA';
}
