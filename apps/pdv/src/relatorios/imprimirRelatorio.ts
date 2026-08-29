/**
 * Impressão / "Salvar como PDF" do relatório.
 *
 * Mesmo caminho do comprovante (`impressao/imprimir.ts`): `window.print()`
 * sobre um layout A4 — a caixa de diálogo de impressão do navegador tem
 * "Salvar como PDF" nativamente, então não é preciso trazer uma biblioteca de
 * geração de PDF só para isso.
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

function reais(valorCentavos: number): string {
  return formatarBRL(centavos(valorCentavos));
}

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function imprimirRelatorio(dados: RelatorioResumo, nomeDaLoja: string): void {
  const html = montarHtml(dados, nomeDaLoja);

  const janela = window.open('', '_blank', 'width=900,height=1000');
  if (!janela) {
    // Bloqueio de pop-up não pode impedir a consulta ao relatório — quem
    // chamou já tem os dados na tela, só a impressão não acontece.
    window.alert('Permita pop-ups para imprimir o relatório, ou use "Exportar CSV".');
    return;
  }

  janela.document.write(html);
  janela.document.close();
  janela.focus();
  janela.print();
}

function montarHtml(dados: RelatorioResumo, nomeDaLoja: string): string {
  const periodo = `${new Date(dados.periodo.desde).toLocaleDateString('pt-BR')} a ${new Date(dados.periodo.ate).toLocaleDateString('pt-BR')}`;
  const maiorDia = Math.max(1, ...dados.porDia.map((d) => d.totalCentavos));

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de vendas</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  /* Sem isto, o Chrome some com fundos coloridos ao imprimir — a barrinha do
     gráfico de "vendas por dia" sairia vazia, só o contorno cinza-claro. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .subtitulo { color: #555; font-size: 13px; margin: 0 0 18px; }
  .cartoes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
  .cartao { border: 1px solid #ccc; border-radius: 6px; padding: 10px; }
  .cartao .rotulo { font-size: 11px; color: #666; }
  .cartao .valor { font-size: 17px; font-weight: 700; margin-top: 2px; }
  h2 { font-size: 14px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 4px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #eee; }
  th { color: #555; font-weight: 600; }
  td.num, th.num { text-align: right; }
  .barra-fundo { background: #eee; border-radius: 3px; height: 10px; width: 140px; display: inline-block; vertical-align: middle; overflow: hidden; }
  /* "display: block" é o que importa aqui: um <span> é inline por padrão, e
     elemento inline IGNORA "width" -- sem isso a barra fica sempre invisível,
     preenchida ou não, com qualquer largura que a gente calcule. */
  .barra-cheia { display: block; background: #334155; height: 10px; border-radius: 3px; }
  .rodape { margin-top: 24px; font-size: 10px; color: #888; }
  @media print { .sem-impressao { display: none; } }
</style></head>
<body>
  <h1>${escaparHtml(nomeDaLoja)} — Relatório de vendas</h1>
  <p class="subtitulo">Período: ${periodo} — emitido em ${new Date().toLocaleString('pt-BR')}</p>

  <div class="cartoes">
    <div class="cartao"><div class="rotulo">Total vendido</div><div class="valor">${reais(dados.totalVendidoCentavos)}</div></div>
    <div class="cartao"><div class="rotulo">Total devolvido</div><div class="valor">${reais(dados.totalDevolvidoCentavos)}</div></div>
    <div class="cartao"><div class="rotulo">Total líquido</div><div class="valor">${reais(dados.totalLiquidoCentavos)}</div></div>
    <div class="cartao"><div class="rotulo">Ticket médio</div><div class="valor">${reais(dados.ticketMedioCentavos)}</div></div>
  </div>
  <p class="subtitulo">${dados.quantidadeVendas} venda(s) · ${dados.totalItensVendidos} peça(s) vendida(s) · ${dados.quantidadeDevolucoes} devolução(ões)</p>

  <h2>Vendas por dia</h2>
  <table>
    <thead><tr><th>Data</th><th class="num">Vendas</th><th class="num">Total</th><th></th></tr></thead>
    <tbody>
      ${dados.porDia
        .map(
          (dia) => `<tr>
            <td>${new Date(dia.data).toLocaleDateString('pt-BR')}</td>
            <td class="num">${dia.quantidadeVendas}</td>
            <td class="num">${reais(dia.totalCentavos)}</td>
            <td><span class="barra-fundo"><span class="barra-cheia" style="width:${Math.round((dia.totalCentavos / maiorDia) * 100)}%"></span></span></td>
          </tr>`,
        )
        .join('')}
      ${dados.porDia.length === 0 ? '<tr><td colspan="4">Nenhuma venda no período.</td></tr>' : ''}
    </tbody>
  </table>

  <h2>Por forma de pagamento</h2>
  <table>
    <thead><tr><th>Forma</th><th class="num">Qtd.</th><th class="num">Total</th></tr></thead>
    <tbody>
      ${dados.porFormaPagamento
        .map((f) => `<tr><td>${NOME_DA_FORMA[f.forma] ?? f.forma}</td><td class="num">${f.quantidade}</td><td class="num">${reais(f.totalCentavos)}</td></tr>`)
        .join('')}
    </tbody>
  </table>

  <h2>Por operador</h2>
  <table>
    <thead><tr><th>Operador</th><th class="num">Vendas</th><th class="num">Total</th><th class="num">Ticket médio</th></tr></thead>
    <tbody>
      ${dados.porOperador
        .map(
          (op) => `<tr><td>${escaparHtml(op.nome)}</td><td class="num">${op.quantidadeVendas}</td><td class="num">${reais(op.totalCentavos)}</td><td class="num">${reais(op.ticketMedioCentavos)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <h2>Produtos mais vendidos</h2>
  <table>
    <thead><tr><th>SKU</th><th>Descrição</th><th class="num">Qtd.</th><th class="num">Total</th></tr></thead>
    <tbody>
      ${dados.produtosMaisVendidos
        .map(
          (p) => `<tr><td>${escaparHtml(p.sku)}</td><td>${escaparHtml(p.descricao)}</td><td class="num">${p.quantidadeVendida}</td><td class="num">${reais(p.totalCentavos)}</td></tr>`,
        )
        .join('')}
      ${dados.produtosMaisVendidos.length === 0 ? '<tr><td colspan="4">Nenhum produto vendido no período.</td></tr>' : ''}
    </tbody>
  </table>

  ${
    dados.devolucoesPorFormaEstorno.length > 0
      ? `<h2>Devoluções por forma de estorno</h2>
  <table>
    <thead><tr><th>Forma</th><th class="num">Qtd.</th><th class="num">Valor</th></tr></thead>
    <tbody>
      ${dados.devolucoesPorFormaEstorno
        .map((d) => `<tr><td>${NOME_DA_FORMA[d.formaEstorno] ?? d.formaEstorno}</td><td class="num">${d.quantidade}</td><td class="num">${reais(d.valorCentavos)}</td></tr>`)
        .join('')}
    </tbody>
  </table>`
      : ''
  }

  <p class="rodape">Documento interno de gestão — não é comprovante fiscal.</p>
</body></html>`;
}
