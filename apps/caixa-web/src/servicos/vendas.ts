import type { FormaPagamento } from '@pdv/shared';

/**
 * Contrato de venda com o backend. Só tipos aqui — desde a Fase 4, ninguém
 * chama `POST /vendas` diretamente: toda venda passa por
 * `banco-local/motorSincronizacao.ts` (`enfileirarVenda`), que grava no
 * Dexie primeiro e só então tenta a rede.
 */

export interface ItemVendaEntrada {
  readonly varianteId: string;
  readonly quantidade: number;
  readonly precoUnitarioCentavos: number;
  readonly descontoCentavos: number;
}

export interface PagamentoVendaEntrada {
  readonly forma: FormaPagamento;
  readonly valorCentavos: number;
  readonly trocoCentavos: number;
}

export interface CrediarioEntrada {
  readonly quantidadeParcelas: number;
  readonly primeiroVencimento: string;
}

export interface RegistrarVendaEntrada {
  readonly id: string;
  readonly sessaoCaixaId: string;
  readonly clienteId?: string;
  readonly criadaEmCliente: string;
  readonly itens: readonly ItemVendaEntrada[];
  readonly descontoSobreTotalCentavos: number;
  readonly pagamentos: readonly PagamentoVendaEntrada[];
  readonly crediario?: CrediarioEntrada;
}

export interface RespostaVenda {
  readonly vendaId: string;
  readonly numero: number;
  readonly totalCentavos: number;
  readonly jaEstavaRegistrada: boolean;
}
