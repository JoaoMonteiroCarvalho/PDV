/**
 * Regras de negócio de cadastro de operador — funções puras, sem banco.
 *
 * Criar/editar operador é permissão PERMANENTE do cargo (gerente ou admin),
 * não uma liberação pontual como sangria ou desconto acima da alçada — um
 * gerente não precisa da autorização de outro gerente para dar acesso a um
 * novo funcionário. Por isso a checagem aqui é só sobre o papel de quem
 * está pedindo, sem `autorizadoPorId`.
 */

export class ErroOperador extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroOperador';
  }
}

export type Papel = 'OPERADOR' | 'GERENTE' | 'ADMIN';

export function validarPermissaoGestaoOperadores(papelDeQuemPede: Papel): void {
  if (papelDeQuemPede !== 'GERENTE' && papelDeQuemPede !== 'ADMIN') {
    throw new ErroOperador('SEM_PERMISSAO', 'Só gerente ou administrador pode gerenciar operadores.');
  }
}

export function validarCadastroOperador(nome: string, login: string, senha: string): void {
  if (nome.trim().length === 0) {
    throw new ErroOperador('NOME_OBRIGATORIO', 'Informe o nome do operador.');
  }
  if (login.trim().length < 3) {
    throw new ErroOperador('LOGIN_INVALIDO', 'O login precisa ter ao menos 3 caracteres.');
  }
  if (senha.length < 6) {
    throw new ErroOperador('SENHA_FRACA', 'A senha precisa ter ao menos 6 caracteres.');
  }
}
