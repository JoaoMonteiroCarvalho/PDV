import { describe, expect, it } from 'vitest';
import type { RelatorioResumo } from '../api/cliente.js';
import { montarCsvRelatorio } from './exportarCsv.js';

function relatorioBase(sobrescrever: Partial<RelatorioResumo> = {}): RelatorioResumo {
  return {
    periodo: { desde: '2026-08-01T00:00:00.000Z', ate: '2026-08-31T23:59:59.999Z' },
    quantidadeVendas: 2,
    totalVendidoCentavos: 17_980,
    totalDevolvidoCentavos: 0,
    totalLiquidoCentavos: 17_980,
    ticketMedioCentavos: 8990,
    totalItensVendidos: 2,
    quantidadeDevolucoes: 0,
    porDia: [{ data: '2026-08-01', quantidadeVendas: 2, totalCentavos: 17_980 }],
    porFormaPagamento: [{ forma: 'PIX', quantidade: 2, totalCentavos: 17_980 }],
    porOperador: [{ operadorId: 'op-1', nome: 'Ana Souza', quantidadeVendas: 2, totalCentavos: 17_980, ticketMedioCentavos: 8990 }],
    produtosMaisVendidos: [
      { varianteId: 'v1', descricao: 'Conjunto Renda', sku: 'CJ-REN', quantidadeVendida: 2, totalCentavos: 17_980 },
    ],
    devolucoesPorFormaEstorno: [],
    ...sobrescrever,
  };
}

describe('montarCsvRelatorio', () => {
  it('começa com o marcador BOM, para o Excel abrir acento corretamente', () => {
    const csv = montarCsvRelatorio(relatorioBase());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('usa ponto-e-vírgula como separador, não vírgula', () => {
    const csv = montarCsvRelatorio(relatorioBase());
    expect(csv).toContain('Quantidade de vendas;2');
  });

  it('formata dinheiro com vírgula decimal, sem símbolo de moeda no valor', () => {
    // O cabeçalho da coluna diz "(R$)" de propósito, para deixar clara a
    // unidade — só o VALOR em si não pode vir prefixado com o símbolo.
    const csv = montarCsvRelatorio(relatorioBase({ totalVendidoCentavos: 179_80 }));
    expect(csv).toContain('Total vendido (R$);179,80');
    expect(csv).not.toMatch(/;R\$/);
  });

  it('inclui todas as seções esperadas', () => {
    const csv = montarCsvRelatorio(relatorioBase());
    for (const secao of [
      'RESUMO',
      'VENDAS POR DIA',
      'POR FORMA DE PAGAMENTO',
      'POR OPERADOR',
      'PRODUTOS MAIS VENDIDOS',
      'DEVOLUÇÕES POR FORMA DE ESTORNO',
    ]) {
      expect(csv).toContain(secao);
    }
  });

  it('traduz a forma de pagamento para o nome legível', () => {
    const csv = montarCsvRelatorio(relatorioBase({ porFormaPagamento: [{ forma: 'PIX', quantidade: 1, totalCentavos: 1000 }] }));
    expect(csv).toContain('PIX');
  });

  it('escapa campo que contém o separador entre aspas', () => {
    const csv = montarCsvRelatorio(
      relatorioBase({
        produtosMaisVendidos: [
          { varianteId: 'v1', descricao: 'Kit; Presente', sku: 'KIT', quantidadeVendida: 1, totalCentavos: 1000 },
        ],
      }),
    );
    expect(csv).toContain('"Kit; Presente"');
  });

  it('lida com relatório de período vazio sem quebrar', () => {
    const csv = montarCsvRelatorio(
      relatorioBase({
        quantidadeVendas: 0,
        totalVendidoCentavos: 0,
        totalLiquidoCentavos: 0,
        ticketMedioCentavos: 0,
        totalItensVendidos: 0,
        porDia: [],
        porFormaPagamento: [],
        porOperador: [],
        produtosMaisVendidos: [],
      }),
    );
    expect(csv).toContain('Quantidade de vendas;0');
  });
});
