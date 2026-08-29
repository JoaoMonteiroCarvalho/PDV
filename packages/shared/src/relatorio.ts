/**
 * Relatório de vendas: agregação pura, sem I/O.
 *
 * A consulta ao banco (apps/api/src/servicos/relatorios.ts) busca as vendas
 * do período com os relacionamentos necessários e entrega para
 * `calcularRelatorio`. Toda a matemática — ticket médio, agrupamento por dia,
 * por operador, por forma de pagamento, produtos mais vendidos — mora aqui,
 * onde dá para testar sem subir Postgres.
 *
 * Mesma disciplina do resto do sistema: nenhum float participa da conta.
 * "Vendas de R$ 47.382,19 dividida por 213 vendas" não pode virar
 * 222.4batata — o ticket médio é obtido com `ratear`, que preserva o total
 * exatamente, e não com `total / quantidade`.
 */

import { centavos, ratear, somar, ZERO, type Centavos } from './dinheiro.js';
import type { FormaPagamento } from './venda.js';

/** Uma venda do período, com só o que o relatório precisa enxergar. */
export interface VendaParaRelatorio {
  readonly registradaEm: Date;
  readonly totalCentavos: Centavos;
  readonly operador: { readonly id: string; readonly nome: string };
  readonly itens: ReadonlyArray<{
    readonly varianteId: string;
    readonly descricao: string;
    readonly sku: string;
    readonly quantidade: number;
    readonly totalCentavos: Centavos;
  }>;
  readonly pagamentos: ReadonlyArray<{
    readonly forma: FormaPagamento;
    /** Valor entregue pelo cliente. Em dinheiro, pode superar o total — o
     *  excedente é `trocoCentavos`, devolvido na hora. */
    readonly valorCentavos: Centavos;
    readonly trocoCentavos: Centavos;
  }>;
  readonly cancelamentos: ReadonlyArray<{
    readonly formaEstorno: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'VALE_TROCA';
    readonly valorCentavos: Centavos;
  }>;
}

export interface PontoPorDia {
  readonly data: string; // "AAAA-MM-DD"
  readonly quantidadeVendas: number;
  readonly totalCentavos: Centavos;
}

export interface LinhaPorFormaPagamento {
  readonly forma: FormaPagamento;
  readonly quantidade: number;
  readonly totalCentavos: Centavos;
}

export interface LinhaPorOperador {
  readonly operadorId: string;
  readonly nome: string;
  readonly quantidadeVendas: number;
  readonly totalCentavos: Centavos;
  readonly ticketMedioCentavos: Centavos;
}

export interface LinhaProdutoMaisVendido {
  readonly varianteId: string;
  readonly descricao: string;
  readonly sku: string;
  readonly quantidadeVendida: number;
  readonly totalCentavos: Centavos;
}

export interface LinhaDevolucaoPorForma {
  readonly formaEstorno: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'VALE_TROCA';
  readonly quantidade: number;
  readonly valorCentavos: Centavos;
}

export interface Relatorio {
  readonly quantidadeVendas: number;
  readonly totalVendidoCentavos: Centavos;
  readonly totalDevolvidoCentavos: Centavos;
  /** Vendido menos devolvido — o que a loja efetivamente faturou no período. */
  readonly totalLiquidoCentavos: Centavos;
  readonly ticketMedioCentavos: Centavos;
  readonly totalItensVendidos: number;
  readonly quantidadeDevolucoes: number;
  readonly porDia: readonly PontoPorDia[];
  readonly porFormaPagamento: readonly LinhaPorFormaPagamento[];
  readonly porOperador: readonly LinhaPorOperador[];
  /** Top 10 por quantidade vendida, decrescente. */
  readonly produtosMaisVendidos: readonly LinhaProdutoMaisVendido[];
  readonly devolucoesPorFormaEstorno: readonly LinhaDevolucaoPorForma[];
}

/** Data no fuso do servidor, truncada para o dia — chave de agrupamento do gráfico. */
function chaveDoDia(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * Agrega vendas já carregadas em memória.
 *
 * Buscar tudo do período de uma vez e agregar em JS — em vez de várias
 * consultas SQL com GROUP BY — é deliberado: a loja tem 1 caixa, o volume de
 * vendas de qualquer período razoável (um mês, um ano) cabe folgado em
 * memória, e manter a agregação pura permite testar cada regra sem Postgres.
 */
export function calcularRelatorio(vendas: readonly VendaParaRelatorio[]): Relatorio {
  const quantidadeVendas = vendas.length;
  const totalVendidoCentavos =
    quantidadeVendas === 0 ? ZERO : somar(...vendas.map((v) => v.totalCentavos));

  const todosCancelamentos = vendas.flatMap((v) => v.cancelamentos);
  const totalDevolvidoCentavos =
    todosCancelamentos.length === 0 ? ZERO : somar(...todosCancelamentos.map((c) => c.valorCentavos));

  const totalLiquidoCentavos = centavos(totalVendidoCentavos - totalDevolvidoCentavos);
  const ticketMedioCentavos =
    quantidadeVendas === 0 ? ZERO : ratear(totalVendidoCentavos, quantidadeVendas)[0]!;

  const totalItensVendidos = vendas.reduce(
    (soma, v) => soma + v.itens.reduce((s, item) => s + item.quantidade, 0),
    0,
  );

  return {
    quantidadeVendas,
    totalVendidoCentavos,
    totalDevolvidoCentavos,
    totalLiquidoCentavos,
    ticketMedioCentavos,
    totalItensVendidos,
    quantidadeDevolucoes: todosCancelamentos.length,
    porDia: agregarPorDia(vendas),
    porFormaPagamento: agregarPorFormaPagamento(vendas),
    porOperador: agregarPorOperador(vendas),
    produtosMaisVendidos: agregarProdutosMaisVendidos(vendas),
    devolucoesPorFormaEstorno: agregarDevolucoesPorForma(todosCancelamentos),
  };
}

function agregarPorDia(vendas: readonly VendaParaRelatorio[]): PontoPorDia[] {
  const porChave = new Map<string, { quantidade: number; total: Centavos }>();
  for (const venda of vendas) {
    const chave = chaveDoDia(venda.registradaEm);
    const atual = porChave.get(chave) ?? { quantidade: 0, total: ZERO };
    porChave.set(chave, {
      quantidade: atual.quantidade + 1,
      total: centavos(atual.total + venda.totalCentavos),
    });
  }
  return [...porChave.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([data, valores]) => ({
      data,
      quantidadeVendas: valores.quantidade,
      totalCentavos: valores.total,
    }));
}

/**
 * Soma o LÍQUIDO de cada forma (`valorCentavos - trocoCentavos`), nunca o
 * bruto recebido. Um pagamento em dinheiro de R$ 100,00 com R$ 10,10 de
 * troco representa R$ 89,90 de receita, não R$ 100,00 — somar o bruto
 * infla o total da forma "Dinheiro" acima do que a venda realmente valeu, e
 * a soma das formas deixa de bater com `totalVendidoCentavos`.
 */
function agregarPorFormaPagamento(vendas: readonly VendaParaRelatorio[]): LinhaPorFormaPagamento[] {
  const porForma = new Map<FormaPagamento, { quantidade: number; total: Centavos }>();
  for (const venda of vendas) {
    for (const pagamento of venda.pagamentos) {
      const liquido = centavos(pagamento.valorCentavos - pagamento.trocoCentavos);
      const atual = porForma.get(pagamento.forma) ?? { quantidade: 0, total: ZERO };
      porForma.set(pagamento.forma, {
        quantidade: atual.quantidade + 1,
        total: centavos(atual.total + liquido),
      });
    }
  }
  return [...porForma.entries()]
    .map(([forma, valores]) => ({ forma, quantidade: valores.quantidade, totalCentavos: valores.total }))
    .sort((a, b) => b.totalCentavos - a.totalCentavos);
}

function agregarPorOperador(vendas: readonly VendaParaRelatorio[]): LinhaPorOperador[] {
  const porOperador = new Map<string, { nome: string; quantidade: number; total: Centavos }>();
  for (const venda of vendas) {
    const atual = porOperador.get(venda.operador.id) ?? {
      nome: venda.operador.nome,
      quantidade: 0,
      total: ZERO,
    };
    porOperador.set(venda.operador.id, {
      nome: atual.nome,
      quantidade: atual.quantidade + 1,
      total: centavos(atual.total + venda.totalCentavos),
    });
  }
  return [...porOperador.entries()]
    .map(([operadorId, valores]) => ({
      operadorId,
      nome: valores.nome,
      quantidadeVendas: valores.quantidade,
      totalCentavos: valores.total,
      ticketMedioCentavos: ratear(valores.total, valores.quantidade)[0]!,
    }))
    .sort((a, b) => b.totalCentavos - a.totalCentavos);
}

function agregarProdutosMaisVendidos(vendas: readonly VendaParaRelatorio[]): LinhaProdutoMaisVendido[] {
  const porVariante = new Map<
    string,
    { descricao: string; sku: string; quantidade: number; total: Centavos }
  >();
  for (const venda of vendas) {
    for (const item of venda.itens) {
      const atual = porVariante.get(item.varianteId) ?? {
        descricao: item.descricao,
        sku: item.sku,
        quantidade: 0,
        total: ZERO,
      };
      porVariante.set(item.varianteId, {
        // Fica com a descrição mais recente vista no período — se o nome do
        // produto mudou no meio do caminho, o relatório reflete o atual.
        descricao: item.descricao,
        sku: item.sku,
        quantidade: atual.quantidade + item.quantidade,
        total: centavos(atual.total + item.totalCentavos),
      });
    }
  }
  return [...porVariante.entries()]
    .map(([varianteId, valores]) => ({
      varianteId,
      descricao: valores.descricao,
      sku: valores.sku,
      quantidadeVendida: valores.quantidade,
      totalCentavos: valores.total,
    }))
    .sort((a, b) => b.quantidadeVendida - a.quantidadeVendida)
    .slice(0, 10);
}

function agregarDevolucoesPorForma(
  cancelamentos: readonly VendaParaRelatorio['cancelamentos'][number][],
): LinhaDevolucaoPorForma[] {
  const porForma = new Map<string, { quantidade: number; total: Centavos }>();
  for (const cancelamento of cancelamentos) {
    const atual = porForma.get(cancelamento.formaEstorno) ?? { quantidade: 0, total: ZERO };
    porForma.set(cancelamento.formaEstorno, {
      quantidade: atual.quantidade + 1,
      total: centavos(atual.total + cancelamento.valorCentavos),
    });
  }
  return [...porForma.entries()]
    .map(([formaEstorno, valores]) => ({
      formaEstorno: formaEstorno as LinhaDevolucaoPorForma['formaEstorno'],
      quantidade: valores.quantidade,
      valorCentavos: valores.total,
    }))
    .sort((a, b) => b.valorCentavos - a.valorCentavos);
}
