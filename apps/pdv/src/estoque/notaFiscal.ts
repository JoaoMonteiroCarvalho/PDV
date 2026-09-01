/**
 * Leitura do XML da NF-e de entrada.
 *
 * Quando a mercadoria chega, vem com uma nota. Digitar 40 itens à mão é onde
 * a loja perde uma tarde e ganha erros de cadastro — e onde o custo digitado
 * errado estraga a margem de um produto pelo resto do ano.
 *
 * Este módulo lê o XML e devolve os itens. Ele NÃO tenta ser um leitor
 * completo de NF-e: ignora imposto, transporte, cobrança e todo o resto, e
 * lê só o que interessa para dar entrada em estoque. Assumir menos e falhar
 * claro é melhor que fingir que entende a nota inteira.
 *
 * Usa o `DOMParser` do próprio navegador. Uma biblioteca de XML resolveria o
 * mesmo problema custando alguns megabytes num app que precisa abrir rápido
 * num mini-PC.
 *
 * DINHEIRO: `vUnCom` vem como decimal de até 10 casas ("25.5000000000"). A
 * conversão para centavos é feita na STRING, nunca com `parseFloat` seguido de
 * `* 100` — esse caminho transforma 25,55 em 2554,9999... e o custo entra
 * errado no sistema.
 */

export class ErroNota extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroNota';
  }
}

export interface ItemNota {
  /** `nItem` — a ordem na nota, usada para a operadora achar a linha no papel. */
  readonly numeroItem: number;
  /** `cProd` — o código do FORNECEDOR, que raramente é o SKU da loja. */
  readonly codigoFornecedor: string;
  /** `cEAN`. `null` quando a nota diz "SEM GTIN", o que é comum. */
  readonly codigoBarras: string | null;
  readonly descricao: string;
  readonly unidade: string;
  readonly quantidade: number;
  readonly custoUnitarioCentavos: number;
  readonly totalCentavos: number;
}

export interface NotaFiscal {
  readonly numero: string;
  readonly emitidaEm: Date | null;
  readonly fornecedor: string;
  readonly cnpjFornecedor: string | null;
  /** Chave de 44 dígitos — identifica a nota sem ambiguidade. */
  readonly chave: string | null;
  readonly itens: readonly ItemNota[];
}

/**
 * Converte decimal em centavos operando na string.
 *
 * Arredonda a partir da terceira casa, que é o que a Receita faz e o que o
 * fornecedor imprimiu no papel. "25.555" vira 2556, não 2555.
 */
export function decimalParaCentavos(texto: string): number {
  const limpo = texto.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) {
    throw new ErroNota(`Valor não numérico na nota: "${texto}"`);
  }

  const negativo = limpo.startsWith('-');
  const semSinal = negativo ? limpo.slice(1) : limpo;
  const [inteiro = '0', decimais = ''] = semSinal.split('.');

  const centavosTexto = decimais.padEnd(3, '0').slice(0, 2);
  const terceira = Number(decimais.padEnd(3, '0')[2]);

  let total = Number(inteiro) * 100 + Number(centavosTexto);
  if (terceira >= 5) total += 1;

  return negativo ? -total : total;
}

/** Quantidade da nota. Aceita fracionário, mas o varejo de peça usa inteiro. */
export function lerQuantidade(texto: string): number {
  const limpo = texto.trim().replace(',', '.');
  const valor = Number(limpo);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new ErroNota(`Quantidade inválida na nota: "${texto}"`);
  }
  return valor;
}

function texto(pai: Element, nome: string): string | null {
  /*
   * `getElementsByTagName` em vez de seletor com namespace: o XML da NF-e
   * declara `xmlns="http://www.portalfiscal.inf.br/nfe"`, e alguns emissores
   * mandam com prefixo. Buscar pelo nome local funciona nos dois casos.
   */
  const encontrados = pai.getElementsByTagName(nome);
  const valor = encontrados.item(0)?.textContent?.trim();
  return valor && valor.length > 0 ? valor : null;
}

function exigir(pai: Element, nome: string, contexto: string): string {
  const valor = texto(pai, nome);
  if (valor === null) {
    throw new ErroNota(`A nota não traz <${nome}> em ${contexto}.`);
  }
  return valor;
}

/** "SEM GTIN" é o que a NF-e usa quando o produto não tem código de barras. */
function lerCodigoBarras(prod: Element): string | null {
  const bruto = texto(prod, 'cEAN');
  if (!bruto) return null;
  const normalizado = bruto.replace(/\s+/g, '').toUpperCase();
  if (normalizado === 'SEMGTIN' || normalizado === 'SEM GTIN') return null;
  return /^\d{8,14}$/.test(normalizado) ? normalizado : null;
}

export function lerNotaFiscal(xml: string): NotaFiscal {
  const documento = new DOMParser().parseFromString(xml, 'application/xml');

  // `parsererror` é como o DOMParser reporta XML malformado — ele não lança.
  if (documento.getElementsByTagName('parsererror').length > 0) {
    throw new ErroNota('O arquivo não é um XML válido.');
  }

  const infNFe = documento.getElementsByTagName('infNFe').item(0);
  if (!infNFe) {
    throw new ErroNota(
      'Este XML não parece uma NF-e. Envie o arquivo da nota que veio com a mercadoria.',
    );
  }

  const ide = infNFe.getElementsByTagName('ide').item(0);
  const emit = infNFe.getElementsByTagName('emit').item(0);

  const detalhes = Array.from(infNFe.getElementsByTagName('det'));
  if (detalhes.length === 0) {
    throw new ErroNota('A nota não tem itens.');
  }

  const itens = detalhes.map((det, indice) => lerItem(det, indice));

  return {
    numero: (ide && texto(ide, 'nNF')) ?? 'sem número',
    emitidaEm: lerData(ide && texto(ide, 'dhEmi')),
    fornecedor: (emit && texto(emit, 'xNome')) ?? 'Fornecedor não identificado',
    cnpjFornecedor: emit ? texto(emit, 'CNPJ') : null,
    chave: lerChave(infNFe.getAttribute('Id')),
    itens,
  };
}

function lerItem(det: Element, indice: number): ItemNota {
  const prod = det.getElementsByTagName('prod').item(0);
  const posicao = det.getAttribute('nItem') ?? String(indice + 1);
  if (!prod) {
    throw new ErroNota(`O item ${posicao} da nota não tem <prod>.`);
  }

  const contexto = `item ${posicao}`;
  const quantidade = lerQuantidade(exigir(prod, 'qCom', contexto));
  const custoUnitarioCentavos = decimalParaCentavos(exigir(prod, 'vUnCom', contexto));

  /*
   * `vProd` é o total da linha calculado pelo emissor. Preferimos ele ao
   * produto quantidade × unitário: com preço de 10 casas, o arredondamento
   * do fornecedor é o que consta na nota e o que o contador vai conferir.
   */
  const totalDaNota = texto(prod, 'vProd');

  return {
    numeroItem: Number(posicao),
    codigoFornecedor: exigir(prod, 'cProd', contexto),
    codigoBarras: lerCodigoBarras(prod),
    descricao: exigir(prod, 'xProd', contexto),
    unidade: texto(prod, 'uCom') ?? 'UN',
    quantidade,
    custoUnitarioCentavos,
    totalCentavos:
      totalDaNota !== null
        ? decimalParaCentavos(totalDaNota)
        : Math.round(custoUnitarioCentavos * quantidade),
  };
}

function lerData(bruto: string | null): Date | null {
  if (!bruto) return null;
  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** O `Id` vem como "NFe" + 44 dígitos. */
function lerChave(id: string | null): string | null {
  if (!id) return null;
  const digitos = id.replace(/\D/g, '');
  return digitos.length === 44 ? digitos : null;
}
