/**
 * Interpretação do que o operador digita/bipa no campo de código.
 *
 * Três formatos possíveis no mesmo campo:
 *   1. Multiplicador rápido: "3*7891234567895" -> 3 unidades do EAN.
 *   2. Código de balança (peso embutido): prefixo 2 + código do produto (5
 *      dígitos) + peso em gramas (5 dígitos) + dígito verificador.
 *   3. EAN-13 comum (ou qualquer outro texto — sobra pro caminho de busca
 *      por código exato).
 *
 * Retorna sempre uma interpretação estruturada; quem decide o que fazer com
 * ela (achar produto, mostrar erro) é a tela, não este módulo.
 */

export interface EntradaComMultiplicador {
  readonly tipo: 'codigo-simples' | 'codigo-com-multiplicador';
  readonly quantidade: number;
  readonly codigo: string;
}

export interface EntradaBalanca {
  readonly tipo: 'balanca';
  readonly quantidade: number;
  readonly codigoProduto: string;
  readonly pesoGramas: number;
}

export type EntradaInterpretada = EntradaComMultiplicador | EntradaBalanca;

/**
 * "3*7891234567895" -> 3 unidades do código "7891234567895".
 * Sem "*", é sempre quantidade 1 do código inteiro.
 */
function separarMultiplicador(entrada: string): { quantidade: number; codigo: string } {
  const partes = entrada.split('*');
  if (partes.length === 2 && /^\d+$/.test(partes[0]!.trim())) {
    const quantidade = Number(partes[0]!.trim());
    if (quantidade > 0) {
      return { quantidade, codigo: partes[1]!.trim() };
    }
  }
  return { quantidade: 1, codigo: entrada.trim() };
}

/**
 * Código de balança: 13 dígitos no total — prefixo "2" (1 dígito) + código
 * do produto (5 dígitos) + peso em gramas (6 dígitos) + dígito verificador
 * (1 dígito). 1+5+6+1 = 13, o mesmo tamanho de um EAN-13 comum, que é
 * exatamente o ponto: o scanner não sabe a diferença, o parser é quem
 * decide olhando o primeiro dígito.
 *
 * DV não é recalculado aqui (módulo 10, mesmo algoritmo do EAN-13) — a
 * leitura confia no scanner; validação de DV fica para quando houver
 * produto vendido por peso de verdade no catálogo.
 */
const PADRAO_BALANCA = /^2(\d{5})(\d{6})\d$/;

export function interpretarEntradaCodigo(entradaBruta: string): EntradaInterpretada {
  const { quantidade, codigo } = separarMultiplicador(entradaBruta);

  const casamentoBalanca = PADRAO_BALANCA.exec(codigo);
  if (casamentoBalanca) {
    return {
      tipo: 'balanca',
      quantidade,
      codigoProduto: casamentoBalanca[1]!,
      pesoGramas: Number(casamentoBalanca[2]!),
    };
  }

  return {
    tipo: quantidade === 1 ? 'codigo-simples' : 'codigo-com-multiplicador',
    quantidade,
    codigo,
  };
}
