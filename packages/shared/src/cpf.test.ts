import { describe, expect, it } from 'vitest';
import {
  ErroCpf,
  cpfValido,
  formatarCpf,
  mascararCpf,
  normalizarCpf,
  somenteDigitos,
} from './cpf.js';

/*
 * CPFs válidos gerados pelo próprio algoritmo do dígito verificador. Não
 * pertencem a ninguém: os nove primeiros dígitos são sequências arbitrárias.
 */
const VALIDOS = ['52998224725', '11144477735', '12345678909'];

describe('cpfValido()', () => {
  it('aceita CPF com dígito verificador correto', () => {
    for (const cpf of VALIDOS) {
      expect(cpfValido(cpf), cpf).toBe(true);
    }
  });

  it('aceita formatado, porque é como a pessoa lê o documento', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido(' 529 982 247 25 ')).toBe(true);
  });

  it('recusa dígito verificador errado', () => {
    /*
     * A diferença entre este teste e "tem 11 números": um dígito trocado num
     * cadastro de crediário cria dívida no nome de ninguém, e é exatamente aí
     * que a loja não consegue cobrar.
     */
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('11144477730')).toBe(false);
  });

  it('recusa sequência de dígitos iguais', () => {
    // Passam no cálculo e são o que alguém digita para "pular" o campo.
    for (let d = 0; d <= 9; d += 1) {
      expect(cpfValido(String(d).repeat(11)), `${d}`.repeat(11)).toBe(false);
    }
  });

  it('recusa quantidade errada de dígitos', () => {
    expect(cpfValido('5299822472')).toBe(false);
    expect(cpfValido('529982247250')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });

  it('ausência é inválida, mas não quebra', () => {
    // O campo é opcional; quem decide se pode ficar vazio é a tela, não isto.
    expect(cpfValido(null)).toBe(false);
    expect(cpfValido(undefined)).toBe(false);
  });

  it('texto sem número nenhum não passa', () => {
    expect(cpfValido('não tenho')).toBe(false);
  });
});

describe('normalizarCpf()', () => {
  it('guarda só os dígitos', () => {
    /*
     * Guardar formatado criaria dois CPFs para a mesma pessoa
     * ("123.456.789-09" e "12345678909"), a busca por um não acharia o outro,
     * e o índice único do banco deixaria a duplicata passar.
     */
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizarCpf('52998224725')).toBe('52998224725');
  });

  it('recusa inválido com mensagem que diz o que fazer', () => {
    expect(() => normalizarCpf('52998224726')).toThrow(ErroCpf);
    expect(() => normalizarCpf('52998224726')).toThrow(/Confira os números com a cliente/);
  });
});

describe('formatarCpf()', () => {
  it('formata para leitura', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
  });

  it('devolve o que recebeu quando não dá para formatar', () => {
    // Melhor mostrar o dado como está do que esconder atrás de uma máscara
    // quebrada — quem for conferir precisa ver o que está gravado.
    expect(formatarCpf('123')).toBe('123');
  });
});

describe('mascararCpf()', () => {
  it('vai formatando enquanto se digita, sem reclamar do parcial', () => {
    expect(mascararCpf('529')).toBe('529');
    expect(mascararCpf('5299')).toBe('529.9');
    expect(mascararCpf('529982')).toBe('529.982');
    expect(mascararCpf('5299822')).toBe('529.982.2');
    expect(mascararCpf('529982247')).toBe('529.982.247');
    expect(mascararCpf('52998224725')).toBe('529.982.247-25');
  });

  it('ignora o que passa de 11 dígitos', () => {
    expect(mascararCpf('529982247259999')).toBe('529.982.247-25');
  });

  it('descarta letras que a pessoa digitar sem querer', () => {
    expect(mascararCpf('529a982')).toBe('529.982');
  });
});

describe('somenteDigitos()', () => {
  it('tira pontuação e espaço', () => {
    expect(somenteDigitos('529.982.247-25')).toBe('52998224725');
    expect(somenteDigitos('')).toBe('');
  });
});
