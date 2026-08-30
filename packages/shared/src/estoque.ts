/**
 * Regras de negócio de estoque — funções puras, sem banco.
 *
 * Estoque não é uma coluna: é a soma assinada de `MovimentoEstoque` por
 * variante ("negativo tira, positivo põe, nunca zero" — ver schema.prisma).
 * Venda e devolução já escrevem nesse livro (`movimentosDaVenda`,
 * `movimentosDoCancelamento` em venda.ts). Este arquivo cobre os movimentos
 * MANUAIS — os que não nascem de uma venda:
 *
 *   ENTRADA_COMPRA — mercadoria chegando (nota fiscal ou avulso). Sempre
 *                    positivo. Documentado pela própria nota, não exige
 *                    gerente.
 *   PERDA          — quebra, furto, vencido. Sempre negativo, some do
 *                    estoque sem contrapartida em dinheiro nem documento
 *                    fiscal — exige gerente, mesma lógica de sangria.
 *   AJUSTE_INVENTARIO — corrige a contagem depois de um inventário físico.
 *                       Pode ir pra qualquer lado (sobrou ou faltou), mas é
 *                       sempre uma reescrita do que o sistema achava que
 *                       tinha — exige gerente, sem exceção de valor pequeno.
 */

export class ErroEstoque extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroEstoque';
  }
}

export type TipoMovimentoManualEstoque = 'ENTRADA_COMPRA' | 'PERDA' | 'AJUSTE_INVENTARIO';

export interface ContextoMovimentoManualEstoque {
  readonly autorizadoPorId?: string | undefined;
  readonly autorizadorEhGerente: boolean;
}

const NOME_DO_TIPO: Readonly<Record<TipoMovimentoManualEstoque, string>> = {
  ENTRADA_COMPRA: 'Entrada de compra',
  PERDA: 'Perda',
  AJUSTE_INVENTARIO: 'Ajuste de inventário',
};

/**
 * Valida um movimento manual de estoque antes de gravar.
 *
 * PERDA e AJUSTE_INVENTARIO exigem gerente identificado, sem alçada de
 * quantidade — mesmo 1 unidade exige autorização, porque mexer no estoque
 * sem nota fiscal por trás é o ponto clássico de fraude/erro que a
 * auditoria precisa cobrir sempre.
 */
export function validarMovimentoManualEstoque(
  tipo: TipoMovimentoManualEstoque,
  quantidade: number,
  contexto: ContextoMovimentoManualEstoque,
): void {
  if (!Number.isInteger(quantidade) || quantidade === 0) {
    throw new ErroEstoque('QUANTIDADE_INVALIDA', 'A quantidade precisa ser um inteiro diferente de zero.');
  }
  if (tipo === 'ENTRADA_COMPRA' && quantidade < 0) {
    throw new ErroEstoque('QUANTIDADE_INVALIDA', 'Entrada de compra precisa ter quantidade positiva.');
  }
  if (tipo === 'PERDA' && quantidade > 0) {
    throw new ErroEstoque('QUANTIDADE_INVALIDA', 'Perda precisa ter quantidade negativa.');
  }

  if (tipo === 'PERDA' || tipo === 'AJUSTE_INVENTARIO') {
    if (!contexto.autorizadoPorId) {
      throw new ErroEstoque('AUTORIZACAO_OBRIGATORIA', `${NOME_DO_TIPO[tipo]} exige gerente identificado.`);
    }
    if (!contexto.autorizadorEhGerente) {
      throw new ErroEstoque('AUTORIZADOR_SEM_PERMISSAO', 'Quem autorizou não tem perfil de gerente.');
    }
  }
}
