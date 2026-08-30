/**
 * Regras de negócio de cliente e crediário — funções puras, sem banco.
 */

import { type Centavos, subtrair } from './dinheiro.js';

export class ErroCliente extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroCliente';
  }
}

export function validarCadastroCliente(nome: string, limiteCrediarioCentavos: Centavos): void {
  if (nome.trim().length === 0) {
    throw new ErroCliente('NOME_OBRIGATORIO', 'Informe o nome do cliente.');
  }
  if (limiteCrediarioCentavos < 0) {
    throw new ErroCliente('LIMITE_NEGATIVO', 'O limite de crediário não pode ser negativo.');
  }
}

/** Limite ainda não usado = limite cadastrado menos o que está em parcelas abertas. */
export function calcularLimiteDisponivel(
  limiteCrediarioCentavos: Centavos,
  emAbertoCentavos: Centavos,
): Centavos {
  const disponivel = subtrair(limiteCrediarioCentavos, emAbertoCentavos);
  return (disponivel < 0 ? 0 : disponivel) as Centavos;
}

/**
 * Recebimento de parcela: exige o valor exato da parcela — sem quitação
 * parcial nesta versão, para não precisar rastrear saldo residual por
 * parcela. Uma parcela grande demais para o cliente pagar de uma vez deveria
 * ter sido parcelada em mais vezes na venda, não paga aos pedaços depois.
 */
export function validarRecebimentoParcela(
  statusParcela: 'ABERTA' | 'PAGA' | 'CANCELADA',
  valorParcelaCentavos: Centavos,
  valorRecebidoCentavos: Centavos,
): void {
  if (statusParcela !== 'ABERTA') {
    throw new ErroCliente('PARCELA_JA_QUITADA', 'Esta parcela já foi paga ou cancelada.');
  }
  if (valorRecebidoCentavos !== valorParcelaCentavos) {
    throw new ErroCliente(
      'VALOR_DIVERGENTE',
      `O valor recebido precisa ser exatamente o da parcela (${valorParcelaCentavos} centavos).`,
    );
  }
}
