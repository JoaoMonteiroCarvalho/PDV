import { describe, expect, it } from 'vitest';
import { centavos } from './dinheiro.js';
import {
  ErroCliente,
  calcularLimiteDisponivel,
  validarCadastroCliente,
  validarRecebimentoParcela,
} from './cliente.js';

function esperaCodigo(acao: () => unknown, codigo: string): void {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroCliente);
    expect((erro as ErroCliente).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Esperava ErroCliente com código ${codigo}, mas nada foi lançado.`);
}

describe('validarCadastroCliente()', () => {
  it('aceita nome e limite válidos', () => {
    expect(() => validarCadastroCliente('Maria Silva', centavos(50000))).not.toThrow();
  });

  it('recusa nome vazio', () => {
    esperaCodigo(() => validarCadastroCliente('   ', centavos(0)), 'NOME_OBRIGATORIO');
  });

  it('recusa limite negativo', () => {
    esperaCodigo(() => validarCadastroCliente('Maria', centavos(-100)), 'LIMITE_NEGATIVO');
  });
});

describe('calcularLimiteDisponivel()', () => {
  it('subtrai o que está em aberto do limite', () => {
    expect(calcularLimiteDisponivel(centavos(50000), centavos(20000))).toBe(30000);
  });

  it('nunca fica negativo, mesmo se o em-aberto superar o limite atual', () => {
    expect(calcularLimiteDisponivel(centavos(30000), centavos(50000))).toBe(0);
  });
});

describe('validarRecebimentoParcela()', () => {
  it('aceita parcela aberta com valor exato', () => {
    expect(() => validarRecebimentoParcela('ABERTA', centavos(10000), centavos(10000))).not.toThrow();
  });

  it('recusa parcela já paga', () => {
    esperaCodigo(
      () => validarRecebimentoParcela('PAGA', centavos(10000), centavos(10000)),
      'PARCELA_JA_QUITADA',
    );
  });

  it('recusa parcela cancelada', () => {
    esperaCodigo(
      () => validarRecebimentoParcela('CANCELADA', centavos(10000), centavos(10000)),
      'PARCELA_JA_QUITADA',
    );
  });

  it('recusa valor diferente do valor da parcela, maior ou menor', () => {
    esperaCodigo(
      () => validarRecebimentoParcela('ABERTA', centavos(10000), centavos(9000)),
      'VALOR_DIVERGENTE',
    );
    esperaCodigo(
      () => validarRecebimentoParcela('ABERTA', centavos(10000), centavos(11000)),
      'VALOR_DIVERGENTE',
    );
  });
});
