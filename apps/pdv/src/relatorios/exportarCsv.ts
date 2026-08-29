/**
 * Exportação do relatório em CSV.
 *
 * Ponto-e-vírgula como separador, não vírgula: é o que o Excel brasileiro
 * espera por padrão (a vírgula já é o separador decimal do pt-BR), e é o
 * mesmo motivo pelo qual o valor sai formatado como "1.234,56" em vez de
 * "1234.56" — abrir direto no Excel sem passar por assistente de importação.
 *
 * Função pura: recebe os dados já carregados e devolve uma string. Quem
 * decide o nome do arquivo e dispara o download é `baixarComoCsv`.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import type { RelatorioResumo } from '../api/cliente.js';

const NOME_DA_FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  PIX: 'PIX',
  CREDIARIO: 'Crediário',
  CARTAO: 'Cartão',
  VALE_TROCA: 'Vale-troca',
};

/** Escapa um campo para CSV: aspas duplas quando contém `;`, `"` ou quebra de linha. */
function campo(valor: string | number): string {
  const texto = String(valor);
  if (/[;"\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function linha(...campos: Array<string | number>): string {
  return campos.map(campo).join(';');
}

function reais(valorCentavos: number): string {
  return formatarBRL(centavos(valorCentavos), { simbolo: false });
}

export function montarCsvRelatorio(dados: RelatorioResumo): string {
  const linhas: string[] = [];

  linhas.push(linha('RELATÓRIO DE VENDAS'));
  linhas.push(
    linha(
      'Período',
      `${new Date(dados.periodo.desde).toLocaleDateString('pt-BR')} a ${new Date(dados.periodo.ate).toLocaleDateString('pt-BR')}`,
    ),
  );
  linhas.push('');

  linhas.push(linha('RESUMO'));
  linhas.push(linha('Quantidade de vendas', dados.quantidadeVendas));
  linhas.push(linha('Total vendido (R$)', reais(dados.totalVendidoCentavos)));
  linhas.push(linha('Total devolvido (R$)', reais(dados.totalDevolvidoCentavos)));
  linhas.push(linha('Total líquido (R$)', reais(dados.totalLiquidoCentavos)));
  linhas.push(linha('Ticket médio (R$)', reais(dados.ticketMedioCentavos)));
  linhas.push(linha('Itens vendidos', dados.totalItensVendidos));
  linhas.push(linha('Quantidade de devoluções', dados.quantidadeDevolucoes));
  linhas.push('');

  linhas.push(linha('VENDAS POR DIA'));
  linhas.push(linha('Data', 'Qtd. vendas', 'Total (R$)'));
  for (const dia of dados.porDia) {
    linhas.push(linha(new Date(dia.data).toLocaleDateString('pt-BR'), dia.quantidadeVendas, reais(dia.totalCentavos)));
  }
  linhas.push('');

  linhas.push(linha('POR FORMA DE PAGAMENTO'));
  linhas.push(linha('Forma', 'Qtd.', 'Total (R$)'));
  for (const forma of dados.porFormaPagamento) {
    linhas.push(linha(NOME_DA_FORMA[forma.forma] ?? forma.forma, forma.quantidade, reais(forma.totalCentavos)));
  }
  linhas.push('');

  linhas.push(linha('POR OPERADOR'));
  linhas.push(linha('Operador', 'Qtd. vendas', 'Total (R$)', 'Ticket médio (R$)'));
  for (const operador of dados.porOperador) {
    linhas.push(
      linha(operador.nome, operador.quantidadeVendas, reais(operador.totalCentavos), reais(operador.ticketMedioCentavos)),
    );
  }
  linhas.push('');

  linhas.push(linha('PRODUTOS MAIS VENDIDOS'));
  linhas.push(linha('SKU', 'Descrição', 'Qtd. vendida', 'Total (R$)'));
  for (const produto of dados.produtosMaisVendidos) {
    linhas.push(linha(produto.sku, produto.descricao, produto.quantidadeVendida, reais(produto.totalCentavos)));
  }
  linhas.push('');

  linhas.push(linha('DEVOLUÇÕES POR FORMA DE ESTORNO'));
  linhas.push(linha('Forma', 'Qtd.', 'Valor (R$)'));
  for (const devolucao of dados.devolucoesPorFormaEstorno) {
    linhas.push(
      linha(NOME_DA_FORMA[devolucao.formaEstorno] ?? devolucao.formaEstorno, devolucao.quantidade, reais(devolucao.valorCentavos)),
    );
  }

  // BOM no início: sem ele, o Excel do Windows abre acento como "RelatÃ³rio".
  return `﻿${linhas.join('\r\n')}`;
}

export function baixarComoCsv(dados: RelatorioResumo): void {
  const csv = montarCsvRelatorio(dados);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const dataArquivo = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `relatorio-vendas-${dataArquivo}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
