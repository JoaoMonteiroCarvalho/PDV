/**
 * O emissor desligado — a implementação desta versão.
 *
 * Não é um esboço nem um "TODO": é a implementação correta para uma loja que
 * **decidiu não emitir documento fiscal** e imprime comprovante não fiscal.
 * Ela não falha, não avisa e não pendura nada: emitir nada é o comportamento
 * esperado, não um erro tolerado.
 *
 * O valor de existir como objeto, em vez de um `if` espalhado pelo serviço de
 * venda, é que o caminho da emissão é exercitado pelos testes o tempo todo com
 * um emissor de mentira. No dia em que um emissor real chegar, o encaixe já
 * foi percorrido milhares de vezes.
 */

import type { Configuracao } from '../config.js';
import type { EmissorFiscal } from './porta.js';

export const emissorDesligado: EmissorFiscal = {
  habilitado: false,
  emitir: async () => ({ situacao: 'DESLIGADO' }),
};

/**
 * Escolhe o emissor a partir da configuração.
 *
 * Hoje só existe um caminho, e `carregarConfiguracao` recusa subir com
 * `FISCAL_HABILITADO=true` justamente porque não há emissor real para
 * devolver aqui. Prometer emissão sem emissor seria pior que não prometer: a
 * loja acharia estar emitindo.
 *
 * Quando o módulo fiscal chegar, é ESTA função que ganha o outro ramo — e só
 * ela. Nenhum outro arquivo precisa saber que passaram a existir dois
 * emissores.
 */
export function criarEmissorFiscal(configuracao: Configuracao): EmissorFiscal {
  if (!configuracao.FISCAL_HABILITADO) return emissorDesligado;

  throw new Error(
    'FISCAL_HABILITADO=true, mas nenhum emissor fiscal está implementado. ' +
      'Implemente a porta em `fiscal/porta.ts` e devolva-o aqui antes de ligar a flag.',
  );
}
