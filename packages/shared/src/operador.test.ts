import { describe, expect, it } from 'vitest';
import { ErroOperador, validarCadastroOperador, validarPermissaoGestaoOperadores } from './operador.js';

function esperaCodigo(acao: () => unknown, codigo: string): void {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroOperador);
    expect((erro as ErroOperador).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Esperava ErroOperador com código ${codigo}, mas nada foi lançado.`);
}

describe('validarPermissaoGestaoOperadores()', () => {
  it('aceita gerente e admin', () => {
    expect(() => validarPermissaoGestaoOperadores('GERENTE')).not.toThrow();
    expect(() => validarPermissaoGestaoOperadores('ADMIN')).not.toThrow();
  });

  it('recusa operador comum', () => {
    esperaCodigo(() => validarPermissaoGestaoOperadores('OPERADOR'), 'SEM_PERMISSAO');
  });
});

describe('validarCadastroOperador()', () => {
  it('aceita dados válidos', () => {
    expect(() => validarCadastroOperador('Ana Souza', 'ana', 'senha123')).not.toThrow();
  });

  it('recusa nome vazio', () => {
    esperaCodigo(() => validarCadastroOperador('  ', 'ana', 'senha123'), 'NOME_OBRIGATORIO');
  });

  it('recusa login curto', () => {
    esperaCodigo(() => validarCadastroOperador('Ana', 'an', 'senha123'), 'LOGIN_INVALIDO');
  });

  it('recusa senha fraca', () => {
    esperaCodigo(() => validarCadastroOperador('Ana', 'ana', '123'), 'SENHA_FRACA');
  });
});
