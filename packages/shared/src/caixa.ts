/**
 * Regras de negócio da sessão de caixa — funções puras, sem banco.
 *
 * A sessão de caixa é o contexto obrigatório de toda venda: sem sessão aberta
 * não existe onde lançar o dinheiro. As três operações que ela expõe:
 *
 *   ABRIR    — define o fundo de troco inicial.
 *   SANGRIA / SUPRIMENTO — tiram ou põem dinheiro na gaveta fora de venda.
 *              SEMPRE exigem gerente identificado (regra inegociável do
 *              briefing), não têm alçada de operador como o desconto tem.
 *   FECHAR   — confere o valor contado contra o esperado. Divergência não
 *              bloqueia o fechamento (a loja precisa fechar o caixa de
 *              qualquer forma), mas é sempre registrada.
 */

import { type Centavos, ZERO, somar, subtrair } from './dinheiro.js';

export class ErroCaixa extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroCaixa';
  }
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

export function validarAbertura(fundoTrocoCentavos: Centavos): void {
  if (fundoTrocoCentavos < 0) {
    throw new ErroCaixa('FUNDO_TROCO_NEGATIVO', 'O fundo de troco não pode ser negativo.');
  }
}

// ---------------------------------------------------------------------------
// Sangria e suprimento — sempre exigem gerente
// ---------------------------------------------------------------------------

export type TipoMovimentoManual = 'SANGRIA' | 'SUPRIMENTO';

export interface ContextoMovimentoManual {
  readonly autorizadoPorId?: string | undefined;
  readonly autorizadorEhGerente: boolean;
}

/**
 * Sangria e suprimento não têm alçada de operador — ao contrário do desconto,
 * que o operador concede sozinho até um limite. Aqui, TODO valor exige
 * gerente, porque mexer na gaveta fora do fluxo de venda é o ponto clássico
 * de fraude interna que a auditoria precisa cobrir sem exceção.
 */
export function validarMovimentoManual(
  tipo: TipoMovimentoManual,
  valorCentavos: Centavos,
  contexto: ContextoMovimentoManual,
): void {
  if (valorCentavos <= 0) {
    throw new ErroCaixa(
      'VALOR_INVALIDO',
      `Valor de ${tipo === 'SANGRIA' ? 'sangria' : 'suprimento'} deve ser positivo.`,
    );
  }
  if (!contexto.autorizadoPorId) {
    throw new ErroCaixa(
      'AUTORIZACAO_OBRIGATORIA',
      `${tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'} exige gerente identificado.`,
    );
  }
  if (!contexto.autorizadorEhGerente) {
    throw new ErroCaixa('AUTORIZADOR_SEM_PERMISSAO', 'Quem autorizou não tem perfil de gerente.');
  }
}

/** Sinal do movimento no livro de caixa: sangria tira, suprimento põe. */
export function sinalDoMovimentoManual(tipo: TipoMovimentoManual, valorCentavos: Centavos): Centavos {
  return (tipo === 'SANGRIA' ? -valorCentavos : valorCentavos) as Centavos;
}

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

export interface ResumoMovimentos {
  readonly fundoTrocoCentavos: Centavos;
  /** Soma de tudo que não é o fundo inicial: vendas em dinheiro, sangria, suprimento, recebimento de crediário. */
  readonly outrosMovimentosCentavos: Centavos;
}

export interface ResultadoFechamento {
  readonly valorEsperadoCentavos: Centavos;
  readonly diferencaCentavos: Centavos;
  /** true quando a diferença é diferente de zero — sempre vira registro de auditoria. */
  readonly temDivergencia: boolean;
}

/**
 * Calcula o esperado e a diferença contra o valor contado na gaveta.
 *
 * NÃO bloqueia o fechamento por divergência — o caixa físico precisa fechar
 * de qualquer jeito, a loja não pode ficar impedida de encerrar o dia. Mas
 * `temDivergencia` sinaliza que a rota deve gravar auditoria.
 */
export function calcularFechamento(
  resumo: ResumoMovimentos,
  valorContadoCentavos: Centavos,
): ResultadoFechamento {
  if (valorContadoCentavos < 0) {
    throw new ErroCaixa('VALOR_CONTADO_NEGATIVO', 'O valor contado não pode ser negativo.');
  }

  const esperado = somar(resumo.fundoTrocoCentavos, resumo.outrosMovimentosCentavos);
  const diferenca = subtrair(valorContadoCentavos, esperado);

  return {
    valorEsperadoCentavos: esperado,
    diferencaCentavos: diferenca,
    temDivergencia: diferenca !== ZERO,
  };
}
