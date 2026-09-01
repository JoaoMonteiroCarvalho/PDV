/**
 * Exportação CSV para abrir no Excel em português.
 *
 * Três detalhes decidem se o arquivo serve ou vira lixo na mão da contadora:
 *
 *   1. SEPARADOR `;`, não vírgula. No Windows em pt-BR, o Excel usa o
 *      separador de lista do sistema — que é ponto e vírgula. Um CSV com
 *      vírgula abre com TUDO numa coluna só, e a pessoa desiste ou passa a
 *      tarde no "Texto para Colunas".
 *
 *   2. DECIMAL com vírgula. "1234.56" no Excel pt-BR não é número: vira texto,
 *      e a soma da coluna dá zero. Pior que dar erro, porque parece certo.
 *
 *   3. BOM no começo. Sem ele o Excel lê o arquivo como Latin-1 e "Calcinha
 *      Fio Duplo Algodão" vira "AlgodÃ£o".
 *
 * Nada disso é preferência estética. É a diferença entre um relatório que a
 * loja usa e um que ela abre uma vez e nunca mais.
 */

/** Marca de ordem de bytes UTF-8. Sem ela o Excel estraga todo acento. */
export const BOM = '﻿';
export const SEPARADOR = ';';

/**
 * Escapa um campo.
 *
 * Aspas duplicadas e o campo entre aspas quando contém separador, aspas ou
 * quebra de linha — é a regra do RFC 4180. A observação de uma sangria pode
 * ter ponto e vírgula, e sem isso ela partiria a linha em duas colunas.
 */
export function escaparCampo(valor: string): string {
  if (!/[";\n\r]/.test(valor)) return valor;
  return `"${valor.replace(/"/g, '""')}"`;
}

/** Centavos para o texto que o Excel pt-BR reconhece como número. */
export function centavosParaCsv(centavos: number): string {
  const negativo = centavos < 0;
  const absoluto = Math.abs(Math.trunc(centavos));
  const inteiro = Math.floor(absoluto / 100);
  const resto = String(absoluto % 100).padStart(2, '0');
  /*
   * Sem separador de milhar de propósito: "1.234,56" faria o Excel ler o ponto
   * como separador decimal em algumas configurações, e o valor viraria 1,234.
   * Sem milhar não há ambiguidade nenhuma.
   */
  return `${negativo ? '-' : ''}${inteiro},${resto}`;
}

/** Data no formato que o Excel pt-BR entende sem perguntar nada. */
export function dataParaCsv(data: Date): string {
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${dois(data.getDate())}/${dois(data.getMonth() + 1)}/${data.getFullYear()}`;
}

export interface ColunaCsv<T> {
  readonly titulo: string;
  readonly valor: (linha: T) => string;
}

/** Monta o conteúdo do arquivo. `\r\n` é o que o Excel espera. */
export function montarCsv<T>(colunas: readonly ColunaCsv<T>[], linhas: readonly T[]): string {
  const cabecalho = colunas.map((coluna) => escaparCampo(coluna.titulo)).join(SEPARADOR);
  const corpo = linhas.map((linha) =>
    colunas.map((coluna) => escaparCampo(coluna.valor(linha))).join(SEPARADOR),
  );
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}

/**
 * Entrega o arquivo ao navegador.
 *
 * `text/csv` com charset explícito: sem isso alguns navegadores servem como
 * texto simples e o Windows abre no Bloco de Notas em vez do Excel.
 */
export function baixarCsv(nomeArquivo: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  URL.revokeObjectURL(url);
}

/** Nome com a data no arquivo: a loja acumula exportações na pasta Downloads. */
export function nomeDoArquivo(prefixo: string, de: string, ate: string): string {
  return `${prefixo}-${de}-a-${ate}.csv`;
}
