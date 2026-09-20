/**
 * Relatório de vendas do período.
 *
 * O DIA DA LOJA é o recorte que importa, e ele é local. Uma venda das 22h de
 * segunda tem que aparecer na segunda, não na terça — se o corte for feito em
 * UTC, no Brasil (UTC-3) toda venda depois das 21h cai no dia seguinte e o
 * relatório do dia fecha errado sem ninguém entender por quê.
 *
 * Por isso o período chega como data (`2026-09-01`), não como instante, e o
 * intervalo é montado como [início do primeiro dia, início do dia seguinte ao
 * último) no fuso do servidor — que é o mesmo da loja.
 *
 * Só vendas NÃO canceladas entram. Uma venda cancelada continua no banco (o
 * registro é imutável), mas não é faturamento.
 */

import type { PrismaClient } from '@prisma/client';

export class ErroRelatorio extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroRelatorio';
  }
}

export interface PeriodoRelatorio {
  /** `YYYY-MM-DD`, inclusive. */
  readonly de: string;
  /** `YYYY-MM-DD`, inclusive — o dia inteiro entra. */
  readonly ate: string;
}

export interface RelatorioVendas {
  readonly de: string;
  readonly ate: string;
  readonly resumo: {
    readonly quantidadeVendas: number;
    readonly totalCentavos: number;
    readonly descontoCentavos: number;
    readonly ticketMedioCentavos: number;
    readonly pecasVendidas: number;
  };
  readonly porDia: { readonly dia: string; readonly quantidade: number; readonly totalCentavos: number }[];
  readonly porForma: { readonly forma: string; readonly quantidade: number; readonly totalCentavos: number }[];
  /**
   * Quanto cada pessoa vendeu — a base da comissão.
   *
   * `vendedor: null` agrupa as vendas anteriores ao campo existir. `Venda` é
   * imutável por trigger, então elas não podem ser preenchidas nem por
   * migration, e inventar um vendedor para elas seria fabricar base de
   * comissão. Aparecem como "não informado", que é a verdade.
   */
  readonly porVendedor: {
    readonly vendedorId: string | null;
    readonly vendedor: string | null;
    readonly quantidade: number;
    readonly totalCentavos: number;
  }[];
  readonly maisVendidos: {
    readonly descricao: string;
    readonly sku: string;
    readonly quantidade: number;
    readonly totalCentavos: number;
  }[];
}

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Converte `YYYY-MM-DD` no início daquele dia, no fuso do servidor. */
function inicioDoDia(data: string): Date {
  const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number];
  return new Date(ano, mes - 1, dia, 0, 0, 0, 0);
}

export function montarIntervalo(periodo: PeriodoRelatorio): { inicio: Date; fim: Date } {
  if (!FORMATO_DATA.test(periodo.de) || !FORMATO_DATA.test(periodo.ate)) {
    throw new ErroRelatorio('PERIODO_INVALIDO', 'Informe as datas no formato AAAA-MM-DD.');
  }

  const inicio = inicioDoDia(periodo.de);
  // Fim EXCLUSIVO no início do dia seguinte: assim a venda das 23h59 do último
  // dia entra, e nada do dia seguinte entra junto.
  const fim = inicioDoDia(periodo.ate);
  fim.setDate(fim.getDate() + 1);

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    throw new ErroRelatorio('PERIODO_INVALIDO', 'Data inválida.');
  }
  if (inicio >= fim) {
    throw new ErroRelatorio('PERIODO_INVERTIDO', 'A data inicial é depois da final.');
  }

  return { inicio, fim };
}

/** `YYYY-MM-DD` local, para agrupar por dia sem escorregar de fuso. */
function chaveDoDia(data: Date): string {
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

export async function gerarRelatorioVendas(
  prisma: PrismaClient,
  periodo: PeriodoRelatorio,
): Promise<RelatorioVendas> {
  const { inicio, fim } = montarIntervalo(periodo);

  const vendas = await prisma.venda.findMany({
    where: {
      registradaEm: { gte: inicio, lt: fim },
      // Venda cancelada continua no banco — o registro é imutável — mas não é
      // faturamento e não pode inflar o relatório.
      cancelamentos: { none: {} },
    },
    select: {
      id: true,
      registradaEm: true,
      totalCentavos: true,
      descontoCentavos: true,
      pagamentos: { select: { forma: true, valorCentavos: true, trocoCentavos: true } },
      itens: { select: { descricao: true, sku: true, quantidade: true, totalCentavos: true } },
      vendedor: { select: { id: true, nome: true } },
    },
  });

  const porDia = new Map<string, { quantidade: number; totalCentavos: number }>();
  const porForma = new Map<string, { quantidade: number; totalCentavos: number }>();
  const porProduto = new Map<string, { descricao: string; sku: string; quantidade: number; totalCentavos: number }>();
  const porVendedor = new Map<
    string,
    { vendedorId: string | null; vendedor: string | null; quantidade: number; totalCentavos: number }
  >();

  let totalCentavos = 0;
  let descontoCentavos = 0;
  let pecasVendidas = 0;

  for (const venda of vendas) {
    totalCentavos += venda.totalCentavos;
    descontoCentavos += venda.descontoCentavos;

    const dia = chaveDoDia(venda.registradaEm);
    const acumuladoDia = porDia.get(dia) ?? { quantidade: 0, totalCentavos: 0 };
    porDia.set(dia, {
      quantidade: acumuladoDia.quantidade + 1,
      totalCentavos: acumuladoDia.totalCentavos + venda.totalCentavos,
    });

    /*
     * Chave textual para o `Map` porque `null` precisa virar um grupo próprio:
     * as vendas sem vendedor são um bucket legítimo, não um caso a ignorar.
     */
    const chaveVendedor = venda.vendedor?.id ?? 'sem-vendedor';
    const acumuladoVendedor = porVendedor.get(chaveVendedor) ?? {
      vendedorId: venda.vendedor?.id ?? null,
      vendedor: venda.vendedor?.nome ?? null,
      quantidade: 0,
      totalCentavos: 0,
    };
    porVendedor.set(chaveVendedor, {
      ...acumuladoVendedor,
      quantidade: acumuladoVendedor.quantidade + 1,
      totalCentavos: acumuladoVendedor.totalCentavos + venda.totalCentavos,
    });

    for (const pagamento of venda.pagamentos) {
      const acumulado = porForma.get(pagamento.forma) ?? { quantidade: 0, totalCentavos: 0 };
      porForma.set(pagamento.forma, {
        quantidade: acumulado.quantidade + 1,
        /*
         * LÍQUIDO do troco. O bruto contaria a nota de R$ 100 dada para pagar
         * R$ 50 como cem reais de faturamento em dinheiro, e a soma das formas
         * não fecharia com o total das vendas.
         */
        totalCentavos: acumulado.totalCentavos + pagamento.valorCentavos - pagamento.trocoCentavos,
      });
    }

    for (const item of venda.itens) {
      pecasVendidas += item.quantidade;
      const chave = item.sku;
      const acumulado = porProduto.get(chave) ?? {
        descricao: item.descricao,
        sku: item.sku,
        quantidade: 0,
        totalCentavos: 0,
      };
      porProduto.set(chave, {
        ...acumulado,
        quantidade: acumulado.quantidade + item.quantidade,
        totalCentavos: acumulado.totalCentavos + item.totalCentavos,
      });
    }
  }

  return {
    de: periodo.de,
    ate: periodo.ate,
    resumo: {
      quantidadeVendas: vendas.length,
      totalCentavos,
      descontoCentavos,
      // Divisão inteira: ticket médio em centavos, sem float.
      ticketMedioCentavos: vendas.length === 0 ? 0 : Math.round(totalCentavos / vendas.length),
      pecasVendidas,
    },
    porDia: [...porDia.entries()]
      .map(([dia, dados]) => ({ dia, ...dados }))
      .sort((a, b) => a.dia.localeCompare(b.dia)),
    porForma: [...porForma.entries()]
      .map(([forma, dados]) => ({ forma, ...dados }))
      .sort((a, b) => b.totalCentavos - a.totalCentavos),
    // Quem mais vendeu primeiro: é a ordem em que a conversa sobre comissão
    // acontece.
    porVendedor: [...porVendedor.values()].sort((a, b) => b.totalCentavos - a.totalCentavos),
    maisVendidos: [...porProduto.values()]
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// Mais vendidos — o atalho da tela de venda
// ---------------------------------------------------------------------------

/**
 * Ranking de produtos do período, SEM dinheiro nenhum.
 *
 * Existe separado de `gerarRelatorioVendas` por uma razão de permissão, e ela
 * é a lição de um bug real: a tela de venda monta um atalho com o que mais
 * saiu no mês, e chamava o relatório completo para isso. Quando o relatório
 * passou a exigir gerente — faturamento é dado de dono —, o atalho quebrou
 * silenciosamente para toda operadora.
 *
 * A resposta não foi reabrir o relatório, foi separar o que cada um precisa:
 * o atalho quer SKU e quantidade para montar cards, nunca quanto a loja
 * faturou. Sem `totalCentavos` aqui, a rota pode ser de operador sem vazar
 * nada — e a separação fica imposta pelo formato, não pela disciplina de quem
 * chama.
 */
export interface ProdutoMaisVendido {
  readonly descricao: string;
  readonly sku: string;
  readonly quantidade: number;
}

export async function gerarMaisVendidos(
  prisma: PrismaClient,
  periodo: PeriodoRelatorio,
  limite = 20,
): Promise<{ de: string; ate: string; maisVendidos: ProdutoMaisVendido[] }> {
  const { inicio, fim } = montarIntervalo(periodo);

  const itens = await prisma.itemVenda.findMany({
    where: {
      venda: {
        registradaEm: { gte: inicio, lt: fim },
        // Venda cancelada não conta: sugerir como atalho a peça que a cliente
        // devolveu é o oposto do que o atalho serve para fazer.
        cancelamentos: { none: {} },
      },
    },
    select: { descricao: true, sku: true, quantidade: true },
  });

  const porSku = new Map<string, ProdutoMaisVendido>();
  for (const item of itens) {
    const acumulado = porSku.get(item.sku) ?? {
      descricao: item.descricao,
      sku: item.sku,
      quantidade: 0,
    };
    porSku.set(item.sku, { ...acumulado, quantidade: acumulado.quantidade + item.quantidade });
  }

  return {
    de: periodo.de,
    ate: periodo.ate,
    maisVendidos: [...porSku.values()]
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, limite),
  };
}

// ---------------------------------------------------------------------------
// Contas a receber — o fiado em aberto
// ---------------------------------------------------------------------------

/**
 * Quanto a loja tem para receber, e de quem.
 *
 * O crediário é a única parte do sistema em que a venda já aconteceu e o
 * dinheiro ainda não entrou. Sem este relatório a loja sabe o que faturou, não
 * o que tem a receber — e são números diferentes: uma venda fiada de R$ 300
 * entra inteira no faturamento do dia e não põe um centavo na gaveta.
 *
 * O valor de cada parcela é o que FALTA: parcela de R$ 100 com R$ 40 já
 * recebidos vale R$ 60 aqui. Usar o valor cheio inflaria a expectativa de
 * caixa justamente nas parcelas que o cliente vem pagando aos poucos.
 *
 * Parcela vencida é a que passou do dia — comparação por DIA, não por
 * instante: uma parcela que vence hoje às 23h não está vencida às 9h da manhã.
 */
export interface ParcelaAReceber {
  readonly parcelaId: string;
  readonly numero: number;
  readonly totalParcelas: number;
  readonly vendaNumero: number;
  readonly vencimento: Date;
  readonly valorCentavos: number;
  readonly recebidoCentavos: number;
  readonly abertoCentavos: number;
  readonly diasDeAtraso: number;
}

export interface ClienteAReceber {
  readonly clienteId: string;
  readonly nome: string;
  readonly telefone: string | null;
  readonly abertoCentavos: number;
  readonly vencidoCentavos: number;
  readonly parcelas: readonly ParcelaAReceber[];
}

export interface RelatorioContasAReceber {
  readonly resumo: {
    readonly clientes: number;
    readonly parcelas: number;
    readonly abertoCentavos: number;
    readonly vencidoCentavos: number;
    readonly aVencerCentavos: number;
  };
  readonly clientes: readonly ClienteAReceber[];
}

/** Meia-noite de hoje, no fuso da loja. Base da comparação de atraso. */
function inicioDeHoje(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

export async function gerarContasAReceber(
  prisma: PrismaClient,
): Promise<RelatorioContasAReceber> {
  const parcelas = await prisma.parcelaCrediario.findMany({
    where: {
      status: 'ABERTA',
      // Título cancelado não é dívida: a venda foi desfeita.
      titulo: { status: 'ABERTO' },
    },
    orderBy: { vencimento: 'asc' },
    select: {
      id: true,
      numero: true,
      valorCentavos: true,
      vencimento: true,
      recebimentos: { select: { valorCentavos: true } },
      titulo: {
        select: {
          cliente: { select: { id: true, nome: true, telefone: true } },
          venda: { select: { numero: true } },
          _count: { select: { parcelas: true } },
        },
      },
    },
  });

  const hoje = inicioDeHoje();
  const porCliente = new Map<
    string,
    { nome: string; telefone: string | null; parcelas: ParcelaAReceber[] }
  >();

  for (const parcela of parcelas) {
    const recebido = parcela.recebimentos.reduce((soma, r) => soma + r.valorCentavos, 0);
    const aberto = parcela.valorCentavos - recebido;
    // Parcela já quitada por recebimentos parciais que somaram o total: o
    // status ainda diria ABERTA se algo falhou no fechamento, e ela não deve
    // aparecer como dívida.
    if (aberto <= 0) continue;

    const vencimento = parcela.vencimento;
    const diaDoVencimento = new Date(
      vencimento.getFullYear(),
      vencimento.getMonth(),
      vencimento.getDate(),
    );
    const diasDeAtraso =
      diaDoVencimento >= hoje
        ? 0
        : Math.round((hoje.getTime() - diaDoVencimento.getTime()) / UM_DIA_MS);

    const cliente = parcela.titulo.cliente;
    const acumulado = porCliente.get(cliente.id) ?? {
      nome: cliente.nome,
      telefone: cliente.telefone,
      parcelas: [],
    };
    acumulado.parcelas.push({
      parcelaId: parcela.id,
      numero: parcela.numero,
      totalParcelas: parcela.titulo._count.parcelas,
      vendaNumero: parcela.titulo.venda.numero,
      vencimento,
      valorCentavos: parcela.valorCentavos,
      recebidoCentavos: recebido,
      abertoCentavos: aberto,
      diasDeAtraso,
    });
    porCliente.set(cliente.id, acumulado);
  }

  const clientes: ClienteAReceber[] = [...porCliente.entries()]
    .map(([clienteId, dados]) => ({
      clienteId,
      nome: dados.nome,
      telefone: dados.telefone,
      abertoCentavos: dados.parcelas.reduce((soma, p) => soma + p.abertoCentavos, 0),
      vencidoCentavos: dados.parcelas
        .filter((p) => p.diasDeAtraso > 0)
        .reduce((soma, p) => soma + p.abertoCentavos, 0),
      parcelas: dados.parcelas,
    }))
    /*
     * Quem deve vencido vem primeiro, e dentro disso quem deve mais. É a ordem
     * da ligação de cobrança: a lista existe para alguém começar do topo.
     */
    .sort((a, b) => b.vencidoCentavos - a.vencidoCentavos || b.abertoCentavos - a.abertoCentavos);

  const abertoTotal = clientes.reduce((soma, c) => soma + c.abertoCentavos, 0);
  const vencidoTotal = clientes.reduce((soma, c) => soma + c.vencidoCentavos, 0);

  return {
    resumo: {
      clientes: clientes.length,
      parcelas: clientes.reduce((soma, c) => soma + c.parcelas.length, 0),
      abertoCentavos: abertoTotal,
      vencidoCentavos: vencidoTotal,
      aVencerCentavos: abertoTotal - vencidoTotal,
    },
    clientes,
  };
}
