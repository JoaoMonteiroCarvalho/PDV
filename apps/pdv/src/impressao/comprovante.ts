/**
 * Comprovante de venda em 80mm.
 *
 * ATENÇÃO: este NÃO é documento fiscal. O sistema não emite NFC-e nesta
 * versão, e o comprovante diz isso de forma inequívoca — omitir seria induzir
 * a cliente a erro e expor a loja. Quando o módulo fiscal for ligado, este
 * layout ganha um segundo bloco; o aviso sai só nesse dia.
 *
 * O texto é montado em colunas fixas (48 caracteres = 80mm em fonte 12x24,
 * padrão ESC/POS). Isso serve para os dois caminhos de impressão:
 *   - hoje: `window.print()` com CSS de 80mm e fonte monoespaçada;
 *   - depois: envio direto em ESC/POS, quando a impressora chegar.
 */

import { type VendaCalculada, formatarBRL } from '@pdv/shared';

export const COLUNAS = 48;

export interface DadosLoja {
  readonly nome: string;
  readonly endereco?: string | undefined;
  readonly telefone?: string | undefined;
  readonly cnpj?: string | undefined;
}

export interface DadosComprovante {
  readonly numero: number | null;
  readonly vendaId: string;
  readonly momento: Date;
  readonly operador: string;
  readonly itens: readonly {
    readonly descricao: string;
    readonly tamanho: string | null;
    readonly cor: string | null;
    readonly quantidade: number;
    readonly precoUnitarioCentavos: number;
    readonly totalCentavos: number;
  }[];
  readonly pagamentos: readonly {
    readonly forma: string;
    readonly valorCentavos: number;
    readonly trocoCentavos: number;
  }[];
  readonly parcelas?:
    | readonly { readonly numero: number; readonly valorCentavos: number; readonly vencimento: Date }[]
    | undefined;
  readonly cliente?: string | undefined;
}

const NOME_DA_FORMA: Readonly<Record<string, string>> = {
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Cartao debito',
  CREDITO: 'Cartao credito',
  PIX: 'PIX',
  CREDIARIO: 'Crediario',
};

function centralizar(texto: string): string {
  const corte = texto.slice(0, COLUNAS);
  const espacos = Math.max(0, Math.floor((COLUNAS - corte.length) / 2));
  return ' '.repeat(espacos) + corte;
}

/** Rótulo à esquerda, valor à direita, preenchendo o meio. */
function duasColunas(esquerda: string, direita: string): string {
  const espaco = COLUNAS - direita.length;
  const rotulo = esquerda.slice(0, Math.max(0, espaco - 1));
  return rotulo.padEnd(espaco, ' ') + direita;
}

function linha(caractere = '-'): string {
  return caractere.repeat(COLUNAS);
}

function formatarDataHora(momento: Date): string {
  const doisDigitos = (valor: number) => String(valor).padStart(2, '0');
  return (
    `${doisDigitos(momento.getDate())}/${doisDigitos(momento.getMonth() + 1)}/${momento.getFullYear()} ` +
    `${doisDigitos(momento.getHours())}:${doisDigitos(momento.getMinutes())}`
  );
}

/** Quebra a descrição para não estourar a largura do papel. */
function descricaoDoItem(item: DadosComprovante['itens'][number]): string {
  const variacao = [item.tamanho, item.cor].filter(Boolean).join('/');
  const completa = variacao ? `${item.descricao} ${variacao}` : item.descricao;
  return completa.slice(0, COLUNAS);
}

export function montarComprovante(
  venda: VendaCalculada,
  dados: DadosComprovante,
  loja: DadosLoja,
): string[] {
  const linhas: string[] = [];

  linhas.push(centralizar(loja.nome));
  if (loja.endereco) linhas.push(centralizar(loja.endereco));
  if (loja.telefone) linhas.push(centralizar(`Tel: ${loja.telefone}`));
  if (loja.cnpj) linhas.push(centralizar(`CNPJ: ${loja.cnpj}`));
  linhas.push('');

  // O aviso vem ANTES dos valores, não escondido no rodapé.
  linhas.push(centralizar('*** NAO E DOCUMENTO FISCAL ***'));
  linhas.push(centralizar('COMPROVANTE DE VENDA'));
  linhas.push(linha('='));

  linhas.push(duasColunas(`Venda: ${dados.numero ?? 'pendente'}`, formatarDataHora(dados.momento)));
  linhas.push(`Operador: ${dados.operador}`.slice(0, COLUNAS));
  if (dados.cliente) linhas.push(`Cliente: ${dados.cliente}`.slice(0, COLUNAS));
  linhas.push(linha());

  linhas.push('ITEM                     QTD   UNIT     TOTAL');
  linhas.push(linha());

  for (const item of dados.itens) {
    linhas.push(descricaoDoItem(item));
    const quantidade = String(item.quantidade).padStart(3, ' ');
    const unitario = formatarBRL(item.precoUnitarioCentavos as never, { simbolo: false }).padStart(9);
    const total = formatarBRL(item.totalCentavos as never, { simbolo: false }).padStart(10);
    linhas.push(`  ${quantidade} x ${unitario} ${total}`.slice(0, COLUNAS));
  }

  linhas.push(linha());
  linhas.push(duasColunas('SUBTOTAL', formatarBRL(venda.subtotalCentavos)));
  if (venda.descontoCentavos > 0) {
    linhas.push(duasColunas('DESCONTO', `-${formatarBRL(venda.descontoCentavos)}`));
  }
  linhas.push(duasColunas('TOTAL', formatarBRL(venda.totalCentavos)));
  linhas.push('');

  for (const pagamento of dados.pagamentos) {
    const nome = NOME_DA_FORMA[pagamento.forma] ?? pagamento.forma;
    linhas.push(duasColunas(nome, formatarBRL(pagamento.valorCentavos as never)));
    if (pagamento.trocoCentavos > 0) {
      linhas.push(duasColunas('TROCO', formatarBRL(pagamento.trocoCentavos as never)));
    }
  }

  if (dados.parcelas && dados.parcelas.length > 0) {
    linhas.push('');
    linhas.push(linha());
    linhas.push('CREDIARIO - PARCELAS');
    for (const parcela of dados.parcelas) {
      const rotulo = `${String(parcela.numero).padStart(2, '0')}/${String(dados.parcelas.length).padStart(2, '0')}  venc ${formatarDataHora(parcela.vencimento).slice(0, 10)}`;
      linhas.push(duasColunas(rotulo, formatarBRL(parcela.valorCentavos as never)));
    }
  }

  linhas.push('');
  linhas.push(linha('='));
  linhas.push(centralizar('NAO E DOCUMENTO FISCAL'));
  linhas.push(centralizar('Nao vale como comprovante fiscal'));
  linhas.push('');
  // Guarda o UUID: é como o suporte liga o papel na mão da cliente ao registro
  // do sistema, inclusive se a venda ainda estiver na fila de sincronizacao.
  linhas.push(centralizar(dados.vendaId.slice(0, 8).toUpperCase()));
  linhas.push('');
  linhas.push(centralizar('Obrigado pela preferencia!'));
  linhas.push('');
  linhas.push('');

  return linhas;
}

/** Converte para o texto que vai ao `<pre>` da janela de impressão. */
export function comprovanteEmTexto(linhas: readonly string[]): string {
  return linhas.join('\n');
}
