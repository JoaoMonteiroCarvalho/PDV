/**
 * Identificação da loja no comprovante.
 *
 * Provisório e assumido como tal: estes dados pertencem ao cadastro da loja,
 * que é a tela de Configurações (Fase 11). Até lá ficam aqui, num lugar só, em
 * vez de espalhados por literais nas telas — quando a tela existir, é este
 * módulo que passa a ler do banco e nenhuma chamada muda.
 *
 * O CNPJ fica de fora de propósito: imprimir um número inventado num papel que
 * a cliente leva embora é pior do que não imprimir nada.
 */

import type { DadosLoja } from './comprovante.js';

export const LOJA: DadosLoja = {
  nome: 'Loja',
  endereco: undefined,
  telefone: undefined,
  cnpj: undefined,
};
