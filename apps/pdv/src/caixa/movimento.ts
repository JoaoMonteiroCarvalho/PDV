/**
 * Regras da sangria e do suprimento, do lado do caixa.
 *
 * O servidor é a autoridade e revalida tudo (inclusive se quem autorizou é
 * mesmo gerente). Isto aqui existe para a operadora descobrir o problema
 * ANTES de chamar a gerente até o balcão — não para substituir a validação.
 *
 * Duas assimetrias deliberadas entre os dois tipos:
 *
 *   - SANGRIA exige justificativa; suprimento não. Dinheiro SAINDO da gaveta
 *     fora de venda é o ponto clássico de desvio, e "sangria de R$ 300 sem
 *     observação" é exatamente o registro que ninguém consegue explicar três
 *     semanas depois. Dinheiro entrando não tem esse risco.
 *
 *   - SANGRIA não pode passar do que existe na gaveta; suprimento não tem
 *     teto. Tirar mais do que há deixaria o saldo esperado negativo, e o
 *     fechamento acusaria uma "sobra" que é só erro de digitação.
 */

export type TipoMovimento = 'SANGRIA' | 'SUPRIMENTO';

/** Justificativa curta demais não é justificativa — é uma tecla apertada. */
export const MINIMO_OBSERVACAO = 5;

export interface DadosMovimento {
  readonly tipo: TipoMovimento;
  readonly valorCentavos: number;
  readonly observacao: string;
  /** Saldo esperado da gaveta, conhecido só depois de a gerente se identificar. */
  readonly saldoEsperadoCentavos: number | null;
  readonly gerenteAutenticada: boolean;
}

/**
 * Lista o que impede registrar, em ordem de quem resolve primeiro.
 *
 * Devolve TODOS os impedimentos, não só o primeiro: a operadora corrige tudo
 * de uma vez em vez de descobrir um erro por tentativa.
 */
export function impedimentosDoMovimento(dados: DadosMovimento): string[] {
  const impedimentos: string[] = [];

  if (dados.valorCentavos <= 0) {
    impedimentos.push('Informe um valor maior que zero.');
  }

  if (dados.tipo === 'SANGRIA' && dados.observacao.trim().length < MINIMO_OBSERVACAO) {
    impedimentos.push(
      'Diga para onde o dinheiro foi. Sangria sem justificativa é o registro que ninguém consegue explicar depois.',
    );
  }

  /*
   * O teto só é conferido depois que a gerente entra, porque é ela quem pode
   * ver o saldo. Antes disso, `saldoEsperadoCentavos` vem nulo de propósito —
   * checar aqui vazaria o número para a operadora e desfaria a conferência às
   * cegas do fechamento.
   */
  if (
    dados.tipo === 'SANGRIA' &&
    dados.saldoEsperadoCentavos !== null &&
    dados.valorCentavos > dados.saldoEsperadoCentavos
  ) {
    impedimentos.push('A sangria é maior do que o dinheiro que a gaveta tem.');
  }

  if (!dados.gerenteAutenticada) {
    impedimentos.push('Sangria e suprimento exigem gerente identificada, sem exceção de valor.');
  }

  return impedimentos;
}

export function podeRegistrar(dados: DadosMovimento): boolean {
  return impedimentosDoMovimento(dados).length === 0;
}

/** Papéis que podem autorizar. Operador não autoriza, nem o próprio movimento. */
export function ehPapelAutorizador(papel: string): boolean {
  return papel === 'GERENTE' || papel === 'ADMIN';
}

/** Como o movimento altera o saldo da gaveta: sangria tira, suprimento põe. */
export function efeitoNoSaldo(tipo: TipoMovimento, valorCentavos: number): number {
  return tipo === 'SANGRIA' ? -valorCentavos : valorCentavos;
}
