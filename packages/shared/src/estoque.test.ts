import { describe, expect, it } from 'vitest';
import { ErroEstoque, validarMovimentoManualEstoque } from './estoque.js';

function esperaCodigo(acao: () => unknown, codigo: string): void {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroEstoque);
    expect((erro as ErroEstoque).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Esperava ErroEstoque com código ${codigo}, mas nada foi lançado.`);
}

describe('validarMovimentoManualEstoque() — ENTRADA_COMPRA', () => {
  it('aceita quantidade positiva sem exigir gerente', () => {
    expect(() =>
      validarMovimentoManualEstoque('ENTRADA_COMPRA', 10, { autorizadorEhGerente: false }),
    ).not.toThrow();
  });

  it('recusa quantidade negativa', () => {
    esperaCodigo(
      () => validarMovimentoManualEstoque('ENTRADA_COMPRA', -10, { autorizadorEhGerente: false }),
      'QUANTIDADE_INVALIDA',
    );
  });
});

describe('validarMovimentoManualEstoque() — PERDA', () => {
  it('aceita quantidade negativa com gerente', () => {
    expect(() =>
      validarMovimentoManualEstoque('PERDA', -3, {
        autorizadoPorId: 'gerente-1',
        autorizadorEhGerente: true,
      }),
    ).not.toThrow();
  });

  it('recusa quantidade positiva', () => {
    esperaCodigo(
      () =>
        validarMovimentoManualEstoque('PERDA', 3, {
          autorizadoPorId: 'gerente-1',
          autorizadorEhGerente: true,
        }),
      'QUANTIDADE_INVALIDA',
    );
  });

  it('recusa sem gerente identificado, mesmo 1 unidade', () => {
    esperaCodigo(
      () => validarMovimentoManualEstoque('PERDA', -1, { autorizadorEhGerente: false }),
      'AUTORIZACAO_OBRIGATORIA',
    );
  });

  it('recusa quando quem autorizou não é gerente', () => {
    esperaCodigo(
      () =>
        validarMovimentoManualEstoque('PERDA', -1, {
          autorizadoPorId: 'op-1',
          autorizadorEhGerente: false,
        }),
      'AUTORIZADOR_SEM_PERMISSAO',
    );
  });
});

describe('validarMovimentoManualEstoque() — AJUSTE_INVENTARIO', () => {
  it('aceita positivo ou negativo, sempre com gerente', () => {
    expect(() =>
      validarMovimentoManualEstoque('AJUSTE_INVENTARIO', 5, {
        autorizadoPorId: 'gerente-1',
        autorizadorEhGerente: true,
      }),
    ).not.toThrow();
    expect(() =>
      validarMovimentoManualEstoque('AJUSTE_INVENTARIO', -5, {
        autorizadoPorId: 'gerente-1',
        autorizadorEhGerente: true,
      }),
    ).not.toThrow();
  });

  it('recusa sem gerente', () => {
    esperaCodigo(
      () => validarMovimentoManualEstoque('AJUSTE_INVENTARIO', 5, { autorizadorEhGerente: false }),
      'AUTORIZACAO_OBRIGATORIA',
    );
  });
});

describe('validarMovimentoManualEstoque() — regras comuns', () => {
  it('recusa quantidade zero', () => {
    esperaCodigo(
      () => validarMovimentoManualEstoque('ENTRADA_COMPRA', 0, { autorizadorEhGerente: false }),
      'QUANTIDADE_INVALIDA',
    );
  });

  it('recusa quantidade não inteira', () => {
    esperaCodigo(
      () => validarMovimentoManualEstoque('ENTRADA_COMPRA', 1.5, { autorizadorEhGerente: false }),
      'QUANTIDADE_INVALIDA',
    );
  });
});
