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
    },
  });

  const porDia = new Map<string, { quantidade: number; totalCentavos: number }>();
  const porForma = new Map<string, { quantidade: number; totalCentavos: number }>();
  const porProduto = new Map<string, { descricao: string; sku: string; quantidade: number; totalCentavos: number }>();

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
    maisVendidos: [...porProduto.values()]
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 20),
  };
}
