import { formatarBRL, centavos, type FormaPagamento } from '@pdv/shared';

/**
 * Comprovante de venda, em texto puro (largura de 42 colunas — cabe numa
 * térmica de 80mm com fonte padrão). `window.print()` sobre isto funciona
 * com qualquer impressora que tenha driver no Windows, e também em A4
 * enquanto a térmica não está definida — mesmo caminho já validado no PDV
 * anterior deste projeto, sem trazer biblioteca nova só para imprimir.
 *
 * PENDENTE (Fase 9 — Configurações): nome e endereço da loja hoje são fixos
 * aqui; a tela de configurações vai trazer isso do backend.
 */
const LOJA = { nome: 'LOJA — MODA ÍNTIMA', telefone: '(00) 0000-0000' };
const LARGURA = 42;

const NOME_DA_FORMA: Record<FormaPagamento, string> = {
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Cartão de débito',
  CREDITO: 'Cartão de crédito',
  PIX: 'PIX',
  CREDIARIO: 'Crediário',
};

export interface ItemComprovante {
  readonly nome: string;
  readonly tamanho: string | null;
  readonly cor: string | null;
  readonly quantidade: number;
  readonly precoUnitarioCentavos: number;
  readonly totalCentavos: number;
}

export interface PagamentoComprovante {
  readonly forma: FormaPagamento;
  readonly valorCentavos: number;
  readonly trocoCentavos: number;
}

export interface DadosComprovante {
  readonly numero: number | null;
  readonly vendaId: string;
  readonly momento: Date;
  readonly operador: string;
  readonly itens: readonly ItemComprovante[];
  readonly totalCentavos: number;
  readonly pagamentos: readonly PagamentoComprovante[];
}

function linha(char = '-'): string {
  return char.repeat(LARGURA);
}

function duasColunas(esquerda: string, direita: string): string {
  const espaco = Math.max(1, LARGURA - esquerda.length - direita.length);
  return esquerda + ' '.repeat(espaco) + direita;
}

export function montarComprovante(dados: DadosComprovante): string {
  const linhas: string[] = [];
  linhas.push(LOJA.nome);
  linhas.push(LOJA.telefone);
  linhas.push(linha());
  linhas.push(dados.momento.toLocaleString('pt-BR'));
  linhas.push(`Operador: ${dados.operador}`);
  linhas.push(
    dados.numero !== null ? `Venda #${dados.numero}` : `Venda pendente · ${dados.vendaId.slice(0, 8)}`,
  );
  linhas.push(linha());

  for (const item of dados.itens) {
    const variacao = [item.tamanho, item.cor].filter(Boolean).join(' · ');
    linhas.push(item.nome + (variacao ? ` (${variacao})` : ''));
    linhas.push(
      duasColunas(
        `  ${item.quantidade}x ${formatarBRL(centavos(item.precoUnitarioCentavos), { simbolo: false })}`,
        formatarBRL(centavos(item.totalCentavos)),
      ),
    );
  }

  linhas.push(linha());
  linhas.push(duasColunas('TOTAL', formatarBRL(centavos(dados.totalCentavos))));
  linhas.push(linha());

  for (const pagamento of dados.pagamentos) {
    linhas.push(duasColunas(NOME_DA_FORMA[pagamento.forma], formatarBRL(centavos(pagamento.valorCentavos))));
    if (pagamento.trocoCentavos > 0) {
      linhas.push(duasColunas('  Troco', formatarBRL(centavos(pagamento.trocoCentavos))));
    }
  }

  linhas.push('');
  linhas.push('Obrigado pela preferência!');

  return linhas.join('\n');
}

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function imprimirComprovante(dados: DadosComprovante): void {
  const texto = montarComprovante(dados);
  const janela = window.open('', '_blank', 'width=380,height=700');

  if (!janela) {
    // Bloqueio de pop-up não pode travar a venda — ela já foi registrada e
    // concluída; a impressão é a única coisa que falhou.
    window.alert('Permita pop-ups para imprimir. A venda já foi registrada normalmente.');
    return;
  }

  janela.document.write(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { margin: 0; background: #f1f5f9; }
  pre { font-family: "Courier New", Consolas, monospace; font-size: 12px; line-height: 1.3; white-space: pre; margin: 8px; }
</style></head>
<body><pre>${escaparHtml(texto)}</pre></body></html>`);
  janela.document.close();
  janela.focus();
  janela.print();
}
