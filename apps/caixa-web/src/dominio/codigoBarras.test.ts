import { describe, expect, it } from 'vitest';
import { interpretarEntradaCodigo } from './codigoBarras.js';

describe('interpretarEntradaCodigo', () => {
  it('EAN-13 comum vira código simples, quantidade 1', () => {
    expect(interpretarEntradaCodigo('7891234567895')).toEqual({
      tipo: 'codigo-simples',
      quantidade: 1,
      codigo: '7891234567895',
    });
  });

  it('multiplicador rápido "3*codigo" lança 3 unidades', () => {
    expect(interpretarEntradaCodigo('3*7891234567895')).toEqual({
      tipo: 'codigo-com-multiplicador',
      quantidade: 3,
      codigo: '7891234567895',
    });
  });

  it('multiplicador com espaços ao redor do "*" é tolerado', () => {
    expect(interpretarEntradaCodigo(' 5 * 7891234567895 ')).toEqual({
      tipo: 'codigo-com-multiplicador',
      quantidade: 5,
      codigo: '7891234567895',
    });
  });

  it('multiplicador zero ou negativo não é válido — cai como código simples do texto inteiro', () => {
    const resultado = interpretarEntradaCodigo('0*7891234567895');
    expect(resultado.quantidade).toBe(1);
    expect(resultado.tipo).not.toBe('balanca');
    if (resultado.tipo !== 'balanca') {
      expect(resultado.codigo).toBe('0*7891234567895');
    }
  });

  // 13 dígitos: "2" + produto "00042" (5) + peso "001250" (6, = 1250g) + DV "7".
  it('reconhece código de balança e extrai código do produto e peso em gramas', () => {
    expect(interpretarEntradaCodigo('2000420012507')).toEqual({
      tipo: 'balanca',
      quantidade: 1,
      codigoProduto: '00042',
      pesoGramas: 1250,
    });
  });

  it('código de balança funciona junto com o multiplicador', () => {
    const resultado = interpretarEntradaCodigo('2*2000420012507');
    expect(resultado).toEqual({
      tipo: 'balanca',
      quantidade: 2,
      codigoProduto: '00042',
      pesoGramas: 1250,
    });
  });

  it('13 dígitos que não começam com 2 não são confundidos com balança', () => {
    const resultado = interpretarEntradaCodigo('7891234567895');
    expect(resultado.tipo).not.toBe('balanca');
  });

  it('código com 12 ou 14 dígitos não casa o padrão de balança', () => {
    expect(interpretarEntradaCodigo('200042001250').tipo).not.toBe('balanca');
    expect(interpretarEntradaCodigo('20004200125071').tipo).not.toBe('balanca');
  });
});
