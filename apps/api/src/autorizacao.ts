/**
 * Autorização pontual de gerente.
 *
 * Devolução, sangria e suprimento exigem que um gerente libere a operação. O
 * desenho anterior confiava num campo `autorizadoPorId` vindo no corpo da
 * requisição: o caixa autenticava a gerente numa telinha, descartava o token
 * e mandava só o UUID dela. Isso não provava nada — qualquer operador
 * autenticado podia montar a requisição à mão (DevTools, curl) com o UUID de
 * uma gerente e registrar uma devolução "autorizada" sem que ela jamais
 * tivesse digitado a senha. O UUID vazava facilmente, inclusive por
 * `GET /usuarios`.
 *
 * Agora a autorização é um token JWT assinado pelo servidor, de vida curta,
 * emitido só em `POST /sessao/autorizar` contra login e senha da gerente. A
 * identidade de quem autorizou é LIDA DO TOKEN, nunca do corpo. Forjar exige
 * o segredo do JWT, não um UUID.
 *
 * O campo `tipo` separa os dois tokens que circulam. Sem ele, o token normal
 * de sessão de qualquer gerente (12h, guardado no localStorage do caixa)
 * serviria de autorização permanente, e um token de autorização serviria para
 * navegar o sistema inteiro.
 */

/** Sessão de trabalho (12h) vs. liberação de uma operação pontual (minutos). */
export type TipoToken = 'SESSAO' | 'AUTORIZACAO';

/** Vida curta de propósito: a gerente está do lado da máquina neste instante. */
export const VALIDADE_AUTORIZACAO = '15m';

export type Papel = 'OPERADOR' | 'GERENTE' | 'ADMIN';

/** Conteúdo do token. Fica pequeno de propósito: o resto se consulta no banco. */
export interface TokenOperador {
  readonly sub: string;
  readonly nome: string;
  readonly papel: Papel;
  readonly tipo: TipoToken;
}

export function ehPapelAutorizador(papel: string): boolean {
  return papel === 'GERENTE' || papel === 'ADMIN';
}

/**
 * Valida o formato do token já verificado criptograficamente.
 *
 * Token sem `tipo` é recusado: é token emitido pelo desenho antigo, anterior
 * à assinatura de autorização. Falhar fechado aqui força um novo login em vez
 * de aceitar uma credencial que não carrega a distinção.
 */
export function ehTokenDeSessao(token: TokenOperador): boolean {
  return token.tipo === 'SESSAO';
}

export function ehTokenDeAutorizacao(token: TokenOperador): boolean {
  return token.tipo === 'AUTORIZACAO' && ehPapelAutorizador(token.papel);
}
