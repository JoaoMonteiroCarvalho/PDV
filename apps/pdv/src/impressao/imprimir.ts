/**
 * Impressão do comprovante.
 *
 * A loja ainda não tem impressora térmica definida, então o caminho é
 * `window.print()` sobre um layout de 80mm em fonte monoespaçada — funciona
 * com qualquer térmica que tenha driver no Windows, e também no A4 enquanto
 * a impressora não chega.
 *
 * O texto vem de `montarComprovante`, que já respeita 48 colunas. Quando a
 * impressora ESC/POS chegar, só o transporte muda: o layout já está pronto.
 */

import type { VendaCalculada } from '@pdv/shared';
import {
  comprovanteEmTexto,
  montarComprovante,
  type DadosComprovante,
  type DadosLoja,
} from './comprovante.js';

export function imprimirComprovante(
  venda: VendaCalculada,
  dados: DadosComprovante,
  loja: DadosLoja,
): void {
  const texto = comprovanteEmTexto(montarComprovante(venda, dados, loja));

  const janela = window.open('', '_blank', 'width=380,height=700');
  if (!janela) {
    // Bloqueio de pop-up não pode impedir a venda de ser concluída: a venda já
    // está gravada e enfileirada. Cai para o download do texto.
    baixarComoTexto(texto, dados.vendaId);
    return;
  }

  janela.document.write(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { margin: 0; }
  pre {
    font-family: "Courier New", Consolas, monospace;
    font-size: 11px;
    line-height: 1.25;
    white-space: pre;
    margin: 0;
  }
  @media screen { body { background: #f1f5f9; padding: 8px; } }
</style></head>
<body><pre>${escaparHtml(texto)}</pre></body></html>`);
  janela.document.close();
  janela.focus();
  janela.print();
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function baixarComoTexto(texto: string, vendaId: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `comprovante-${vendaId.slice(0, 8)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
