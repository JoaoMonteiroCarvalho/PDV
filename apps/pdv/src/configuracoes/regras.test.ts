import { describe, expect, it } from 'vitest';
import {
  bpsParaCampo,
  bpsParaTexto,
  normalizarLogin,
  validarLimiteDesconto,
  validarNovoUsuario,
} from './regras.js';

const VALIDO = {
  nome: 'Maria Silva',
  login: 'maria',
  senha: 'segredo1',
  limite: '5',
};

describe('normalizarLogin', () => {
  it('tira espaço, maiúscula e acento', () => {
    expect(normalizarLogin('  João  ')).toBe('joao');
    expect(normalizarLogin('MARIA')).toBe('maria');
    expect(normalizarLogin('Conceição')).toBe('conceicao');
  });

  it('preserva ponto, hífen e sublinhado', () => {
    expect(normalizarLogin('ana.paula_2-b')).toBe('ana.paula_2-b');
  });
});

describe('validarNovoUsuario', () => {
  it('aceita um cadastro completo', () => {
    expect(validarNovoUsuario(VALIDO)).toEqual({});
  });

  it('exige nome com pelo menos dois caracteres', () => {
    expect(validarNovoUsuario({ ...VALIDO, nome: 'M' }).nome).toBeDefined();
  });

  it('recusa login curto', () => {
    expect(validarNovoUsuario({ ...VALIDO, login: 'ab' }).login).toBeDefined();
  });

  it('recusa login com espaço ou caractere estranho', () => {
    expect(validarNovoUsuario({ ...VALIDO, login: 'maria silva' }).login).toBeDefined();
    expect(validarNovoUsuario({ ...VALIDO, login: 'maria@loja' }).login).toBeDefined();
  });

  it('aceita login que só precisava de normalização', () => {
    // Contraprova da regra acima: "recusa tudo" também passaria nela.
    expect(validarNovoUsuario({ ...VALIDO, login: '  Conceição ' })).toEqual({});
  });

  it('recusa senha com menos de 6 caracteres', () => {
    expect(validarNovoUsuario({ ...VALIDO, senha: '12345' }).senha).toBeDefined();
    expect(validarNovoUsuario({ ...VALIDO, senha: '123456' }).senha).toBeUndefined();
  });

  it('aponta o erro no campo certo, e só nele', () => {
    // Um formulário que marcasse tudo em vermelho ao errar um campo não diria
    // nada a quem está preenchendo.
    expect(Object.keys(validarNovoUsuario({ ...VALIDO, senha: '123' }))).toEqual(['senha']);
  });
});

describe('validarLimiteDesconto', () => {
  it('converte porcento digitado para pontos-base', () => {
    expect(validarLimiteDesconto('5').bps).toBe(500);
    expect(validarLimiteDesconto('12,5').bps).toBe(1250);
    expect(validarLimiteDesconto('100').bps).toBe(10_000);
  });

  it('trata campo vazio como sem alçada, não como erro', () => {
    expect(validarLimiteDesconto('')).toEqual({ bps: 0 });
    expect(validarLimiteDesconto('   ')).toEqual({ bps: 0 });
  });

  it('recusa texto, negativo e acima de 100%', () => {
    expect(validarLimiteDesconto('abc').erro).toBeDefined();
    expect(validarLimiteDesconto('-1').erro).toBeDefined();
    expect(validarLimiteDesconto('101').erro).toBeDefined();
  });

  it('não deixa 0,5% virar 50%', () => {
    // A escala é a parte perigosa: errar aqui daria cem vezes a alçada.
    expect(validarLimiteDesconto('0,5').bps).toBe(50);
  });
});

describe('exibição do limite', () => {
  it('volta de bps para o campo sem inventar zero', () => {
    expect(bpsParaCampo(500)).toBe('5');
    expect(bpsParaCampo(1250)).toBe('12,5');
    expect(bpsParaCampo(0)).toBe('');
  });

  it('descreve a ausência de alçada em palavras, não como 0%', () => {
    expect(bpsParaTexto(0)).toBe('sem alçada');
    expect(bpsParaTexto(500)).toBe('5%');
  });
});
