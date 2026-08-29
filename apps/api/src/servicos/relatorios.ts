/**
 * Serviço de relatório de vendas.
 *
 * Busca as vendas do período com os relacionamentos necessários e delega
 * toda a agregação para `calcularRelatorio`, em `@pdv/shared` — a mesma
 * separação usada no resto do sistema: Prisma aqui, matemática de negócio lá,
 * testável sem banco.
 */

import type { PrismaClient } from '@prisma/client';
import { calcularRelatorio, centavos, type Relatorio, type VendaParaRelatorio } from '@pdv/shared';
import type { EntradaRelatorioResumo } from '../esquemas/relatorios.js';

export async function gerarRelatorioResumo(
  prisma: PrismaClient,
  entrada: EntradaRelatorioResumo,
): Promise<Relatorio> {
  const vendas = await prisma.venda.findMany({
    where: {
      registradaEm: { gte: entrada.desde, lte: entrada.ate },
      ...(entrada.operadorId !== undefined ? { operadorId: entrada.operadorId } : {}),
    },
    select: {
      registradaEm: true,
      totalCentavos: true,
      operador: { select: { id: true, nome: true } },
      itens: {
        select: { varianteId: true, descricao: true, sku: true, quantidade: true, totalCentavos: true },
      },
      pagamentos: { select: { forma: true, valorCentavos: true, trocoCentavos: true } },
      cancelamentos: { select: { formaEstorno: true, valorCentavos: true } },
    },
  });

  const paraCalculo: VendaParaRelatorio[] = vendas.map((venda) => ({
    registradaEm: venda.registradaEm,
    totalCentavos: centavos(venda.totalCentavos),
    operador: venda.operador,
    itens: venda.itens.map((item) => ({
      varianteId: item.varianteId,
      descricao: item.descricao,
      sku: item.sku,
      quantidade: item.quantidade,
      totalCentavos: centavos(item.totalCentavos),
    })),
    pagamentos: venda.pagamentos.map((pagamento) => ({
      forma: pagamento.forma,
      valorCentavos: centavos(pagamento.valorCentavos),
      trocoCentavos: centavos(pagamento.trocoCentavos),
    })),
    cancelamentos: venda.cancelamentos.map((cancelamento) => ({
      formaEstorno: cancelamento.formaEstorno,
      valorCentavos: centavos(cancelamento.valorCentavos),
    })),
  }));

  return calcularRelatorio(paraCalculo);
}
