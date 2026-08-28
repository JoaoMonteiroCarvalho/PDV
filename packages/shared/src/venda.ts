/**
 * Regras de negócio da venda — funções puras, sem banco e sem rede.
 *
 * Tudo que decide dinheiro mora aqui e é testável isoladamente. A camada de
 * rota só valida formato (Zod), chama estas funções e persiste o resultado.
 *
 * Duas invariantes que este módulo garante e o banco reforça com CHECK:
 *   totalItem  = precoUnitario × quantidade − descontoItem   (e ≥ 0)
 *   totalVenda = subtotal − desconto                          (e ≥ 0)
 */

import {
  type Centavos,
  type PontosBase,
  ZERO,
  multiplicar,
  pontosBase,
  ratear,
  ratearProporcional,
  somar,
  subtrair,
} from './dinheiro.js';

export type FormaPagamento = 'DINHEIRO' | 'DEBITO' | 'CREDITO' | 'PIX' | 'CREDIARIO';

/** Erro de regra de negócio. `codigo` é estável e vira o corpo da resposta HTTP. */
export class ErroVenda extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroVenda';
  }
}

export interface ItemEntrada {
  readonly varianteId: string;
  readonly quantidade: number;
  readonly precoUnitarioCentavos: Centavos;
  /** Desconto concedido diretamente neste item. */
  readonly descontoCentavos: Centavos;
}

export interface ItemCalculado extends ItemEntrada {
  /** Preço × quantidade, antes de qualquer desconto. */
  readonly brutoCentavos: Centavos;
  /** Desconto do item + a parte que lhe coube do desconto sobre o total. */
  readonly descontoTotalCentavos: Centavos;
  readonly totalCentavos: Centavos;
}

export interface VendaCalculada {
  readonly itens: readonly ItemCalculado[];
  readonly subtotalCentavos: Centavos;
  readonly descontoCentavos: Centavos;
  readonly totalCentavos: Centavos;
  /** Desconto efetivo sobre o subtotal, em pontos-base. Base da alçada. */
  readonly descontoBps: PontosBase;
}

/**
 * Calcula os totais da venda.
 *
 * O desconto aplicado sobre o total é RATEADO entre os itens, proporcional ao
 * valor de cada um. Isso não é detalhe cosmético: sem rateio, a soma dos itens
 * não bate com o total pago, a margem por produto fica errada e a devolução de
 * um item isolado não sabe quanto devolver.
 */
export function calcularVenda(
  itens: readonly ItemEntrada[],
  descontoSobreTotalCentavos: Centavos = ZERO,
): VendaCalculada {
  if (itens.length === 0) {
    throw new ErroVenda('VENDA_SEM_ITENS', 'Uma venda precisa de ao menos um item.');
  }
  if (descontoSobreTotalCentavos < 0) {
    throw new ErroVenda('DESCONTO_NEGATIVO', 'Desconto sobre o total não pode ser negativo.');
  }

  const brutos = itens.map((item, indice) => {
    if (!Number.isInteger(item.quantidade) || item.quantidade <= 0) {
      throw new ErroVenda(
        'QUANTIDADE_INVALIDA',
        `Item ${indice + 1}: quantidade deve ser inteiro positivo (recebido ${item.quantidade}).`,
      );
    }
    if (item.precoUnitarioCentavos < 0) {
      throw new ErroVenda('PRECO_NEGATIVO', `Item ${indice + 1}: preço não pode ser negativo.`);
    }
    if (item.descontoCentavos < 0) {
      throw new ErroVenda('DESCONTO_NEGATIVO', `Item ${indice + 1}: desconto não pode ser negativo.`);
    }
    const bruto = multiplicar(item.precoUnitarioCentavos, item.quantidade);
    if (item.descontoCentavos > bruto) {
      throw new ErroVenda(
        'DESCONTO_MAIOR_QUE_ITEM',
        `Item ${indice + 1}: desconto excede o valor do item.`,
      );
    }
    return bruto;
  });

  const subtotal = somar(...brutos);
  const aposDescontoDeItem = itens.map((item, indice) => subtrair(brutos[indice]!, item.descontoCentavos));
  const baseParaDescontoTotal = somar(...aposDescontoDeItem);

  if (descontoSobreTotalCentavos > baseParaDescontoTotal) {
    throw new ErroVenda(
      'DESCONTO_MAIOR_QUE_TOTAL',
      'Desconto sobre o total excede o valor da venda.',
    );
  }

  // Peso do rateio é o valor do item já líquido do desconto próprio: quem
  // recebeu desconto individual não recebe de novo desproporcionalmente.
  const rateio = ratearProporcional(descontoSobreTotalCentavos, aposDescontoDeItem);

  const calculados: ItemCalculado[] = itens.map((item, indice) => {
    const bruto = brutos[indice]!;
    const descontoTotal = somar(item.descontoCentavos, rateio[indice]!);
    return {
      ...item,
      brutoCentavos: bruto,
      descontoTotalCentavos: descontoTotal,
      totalCentavos: subtrair(bruto, descontoTotal),
    };
  });

  const desconto = somar(...calculados.map((item) => item.descontoTotalCentavos));
  const total = subtrair(subtotal, desconto);

  return {
    itens: calculados,
    subtotalCentavos: subtotal,
    descontoCentavos: desconto,
    totalCentavos: total,
    descontoBps: calcularDescontoBps(subtotal, desconto),
  };
}

/** Desconto efetivo em pontos-base, arredondado para cima (conservador na alçada). */
function calcularDescontoBps(subtotal: Centavos, desconto: Centavos): PontosBase {
  if (subtotal === 0) return pontosBase(0);
  return pontosBase(Math.ceil((desconto * 10_000) / subtotal));
}

// ---------------------------------------------------------------------------
// Alçada de desconto
// ---------------------------------------------------------------------------

export interface ContextoAlcada {
  /** Teto de desconto do operador, em pontos-base. */
  readonly limiteOperadorBps: PontosBase;
  /** Gerente que liberou a operação, se houve liberação. */
  readonly autorizadoPorId?: string | undefined;
  /** Se o autorizador informado é de fato GERENTE ou ADMIN. */
  readonly autorizadorEhGerente: boolean;
}

export interface ResultadoAlcada {
  readonly exigiuAutorizacao: boolean;
  readonly descontoBps: PontosBase;
}

/**
 * Verifica se o desconto cabe na alçada do operador. Se não couber, exige um
 * gerente identificado — e sinaliza que o fato precisa ir para a auditoria.
 */
export function validarAlcadaDesconto(
  venda: VendaCalculada,
  contexto: ContextoAlcada,
): ResultadoAlcada {
  const dentroDoLimite = venda.descontoBps <= contexto.limiteOperadorBps;
  if (dentroDoLimite) {
    return { exigiuAutorizacao: false, descontoBps: venda.descontoBps };
  }

  if (!contexto.autorizadoPorId) {
    throw new ErroVenda(
      'DESCONTO_ACIMA_DA_ALCADA',
      `Desconto de ${formatarBps(venda.descontoBps)} excede o limite do operador ` +
        `(${formatarBps(contexto.limiteOperadorBps)}). Exige liberação de gerente.`,
    );
  }
  if (!contexto.autorizadorEhGerente) {
    throw new ErroVenda(
      'AUTORIZADOR_SEM_PERMISSAO',
      'Quem liberou o desconto não tem perfil de gerente.',
    );
  }

  return { exigiuAutorizacao: true, descontoBps: venda.descontoBps };
}

function formatarBps(bps: PontosBase): string {
  const inteiro = Math.floor(bps / 100);
  const fracao = String(bps % 100).padStart(2, '0');
  return `${inteiro},${fracao}%`;
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------

export interface PagamentoEntrada {
  readonly forma: FormaPagamento;
  /** Valor entregue pelo cliente nesta forma. Em dinheiro, pode superar o total. */
  readonly valorCentavos: Centavos;
  readonly trocoCentavos: Centavos;
}

export interface ContextoPagamento {
  readonly clienteId?: string | undefined;
  /** Saldo que ainda cabe no limite de crediário do cliente. */
  readonly limiteCrediarioDisponivelCentavos?: Centavos | undefined;
}

/**
 * Confere se os pagamentos fecham a venda.
 *
 * A conta que precisa fechar é: soma dos valores − troco = total da venda.
 * Troco existe apenas em dinheiro, e nunca pode ser maior do que o dinheiro
 * efetivamente recebido.
 */
export function validarPagamentos(
  venda: VendaCalculada,
  pagamentos: readonly PagamentoEntrada[],
  contexto: ContextoPagamento = {},
): void {
  if (pagamentos.length === 0) {
    throw new ErroVenda('VENDA_SEM_PAGAMENTO', 'A venda precisa de ao menos uma forma de pagamento.');
  }

  for (const [indice, pagamento] of pagamentos.entries()) {
    if (pagamento.valorCentavos <= 0) {
      throw new ErroVenda(
        'PAGAMENTO_INVALIDO',
        `Pagamento ${indice + 1}: valor deve ser positivo.`,
      );
    }
    if (pagamento.trocoCentavos < 0) {
      throw new ErroVenda('TROCO_NEGATIVO', `Pagamento ${indice + 1}: troco não pode ser negativo.`);
    }
    if (pagamento.trocoCentavos > 0 && pagamento.forma !== 'DINHEIRO') {
      throw new ErroVenda(
        'TROCO_FORA_DE_DINHEIRO',
        `Pagamento ${indice + 1}: só existe troco em dinheiro. ` +
          `A maquininha opera separada do PDV e não devolve troco.`,
      );
    }
    if (pagamento.trocoCentavos > pagamento.valorCentavos) {
      throw new ErroVenda(
        'TROCO_MAIOR_QUE_RECEBIDO',
        `Pagamento ${indice + 1}: troco maior que o valor recebido.`,
      );
    }
  }

  const recebido = somar(...pagamentos.map((pagamento) => pagamento.valorCentavos));
  const troco = somar(...pagamentos.map((pagamento) => pagamento.trocoCentavos));
  const liquido = subtrair(recebido, troco);

  if (liquido !== venda.totalCentavos) {
    throw new ErroVenda(
      'PAGAMENTO_NAO_FECHA',
      `Pagamentos somam ${liquido} centavos líquidos, mas a venda é de ${venda.totalCentavos}.`,
    );
  }

  const crediario = pagamentos.filter((pagamento) => pagamento.forma === 'CREDIARIO');
  if (crediario.length > 0) {
    if (!contexto.clienteId) {
      throw new ErroVenda(
        'CREDIARIO_SEM_CLIENTE',
        'Venda no crediário exige cliente identificado.',
      );
    }
    const valorCrediario = somar(...crediario.map((pagamento) => pagamento.valorCentavos));
    const disponivel = contexto.limiteCrediarioDisponivelCentavos;
    if (disponivel !== undefined && valorCrediario > disponivel) {
      throw new ErroVenda(
        'LIMITE_CREDIARIO_EXCEDIDO',
        `Crediário de ${valorCrediario} centavos excede o limite disponível de ${disponivel}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Crediário
// ---------------------------------------------------------------------------

export interface ParcelaCalculada {
  readonly numero: number;
  readonly valorCentavos: Centavos;
  readonly vencimento: Date;
}

/**
 * Divide o valor do crediário em parcelas mensais.
 *
 * Usa `ratear`, então a soma das parcelas é sempre exatamente o valor
 * financiado — nunca sobra nem falta centavo. O resto vai para as primeiras
 * parcelas, que é a convenção do varejo.
 *
 * O vencimento respeita meses curtos: uma compra no dia 31 com vencimento em
 * fevereiro cai no último dia de fevereiro, e não transborda para março.
 */
export function calcularParcelas(
  valorCentavos: Centavos,
  quantidadeParcelas: number,
  primeiroVencimento: Date,
): ParcelaCalculada[] {
  if (valorCentavos <= 0) {
    throw new ErroVenda('CREDIARIO_VALOR_INVALIDO', 'Valor financiado deve ser positivo.');
  }
  if (!Number.isInteger(quantidadeParcelas) || quantidadeParcelas <= 0) {
    throw new ErroVenda(
      'CREDIARIO_PARCELAS_INVALIDAS',
      `Número de parcelas deve ser inteiro positivo (recebido ${quantidadeParcelas}).`,
    );
  }

  const valores = ratear(valorCentavos, quantidadeParcelas);
  const diaBase = primeiroVencimento.getUTCDate();

  return valores.map((valor, indice) => ({
    numero: indice + 1,
    valorCentavos: valor,
    vencimento: adicionarMeses(primeiroVencimento, indice, diaBase),
  }));
}

function adicionarMeses(base: Date, meses: number, diaDesejado: number): Date {
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth() + meses;
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(diaDesejado, ultimoDiaDoMes);
  return new Date(
    Date.UTC(ano, mes, dia, base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()),
  );
}

// ---------------------------------------------------------------------------
// Movimentos de estoque gerados pela venda
// ---------------------------------------------------------------------------

export interface MovimentoEstoqueCalculado {
  readonly varianteId: string;
  readonly tipo: 'VENDA' | 'CANCELAMENTO_VENDA';
  readonly quantidade: number;
}

/** Venda tira do estoque: quantidade negativa no livro-razão. */
export function movimentosDaVenda(venda: VendaCalculada): MovimentoEstoqueCalculado[] {
  return venda.itens.map((item) => ({
    varianteId: item.varianteId,
    tipo: 'VENDA' as const,
    quantidade: -item.quantidade,
  }));
}

/** Cancelamento devolve ao estoque: movimento novo, espelho do original. */
export function movimentosDoCancelamento(
  itens: readonly { varianteId: string; quantidade: number }[],
): MovimentoEstoqueCalculado[] {
  return itens.map((item) => ({
    varianteId: item.varianteId,
    tipo: 'CANCELAMENTO_VENDA' as const,
    quantidade: Math.abs(item.quantidade),
  }));
}
