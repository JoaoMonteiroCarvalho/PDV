import { describe, expect, it } from 'vitest';
import { descreverForma, formaDaPeca } from './formaDaPeca.js';

describe('formaDaPeca()', () => {
  it('peça com grade de tamanho aparece dobrada, nunca vestida', () => {
    expect(formaDaPeca('Lingerie', true)).toBe('dobrada');
    expect(formaDaPeca('Pijamas', true)).toBe('dobrada');
    expect(formaDaPeca('Moda Praia', true)).toBe('dobrada');
  });

  it('perfumaria vira frasco mesmo sem grade', () => {
    expect(formaDaPeca('Perfumaria', false)).toBe('frasco');
  });

  it('categoria de frasco ganha do sinal de grade', () => {
    // Cadastro esquisito acontece: perfume com "tamanho" 100ml na grade.
    expect(formaDaPeca('Perfumaria', true)).toBe('frasco');
  });

  it('aceita a categoria como o cadastro escreve — caixa e acento variados', () => {
    expect(formaDaPeca('PERFUMARIA', false)).toBe('frasco');
    expect(formaDaPeca(' Cosméticos ', false)).toBe('frasco');
  });

  it('o que não é roupa nem frasco vira embalagem neutra', () => {
    // Melhor uma caixa genérica do que fingir que sabe o formato.
    expect(formaDaPeca('Acessórios', false)).toBe('bloco');
    expect(formaDaPeca(null, false)).toBe('bloco');
    expect(formaDaPeca(undefined, false)).toBe('bloco');
  });

  it('categoria desconhecida com grade ainda lê como peça de vestir', () => {
    expect(formaDaPeca('Categoria Nova', true)).toBe('dobrada');
  });
});

describe('descreverForma()', () => {
  it('diz que a prévia indica a cor, não o modelo', () => {
    // A operadora não pode confiar na prévia como se fosse foto do produto.
    const texto = descreverForma('dobrada', 'Conjunto Renda');
    expect(texto).toContain('Conjunto Renda');
    expect(texto).toContain('peça dobrada');
    expect(texto).toMatch(/cor, não o modelo/);
  });

  it('descreve cada forma de um jeito diferente', () => {
    const textos = new Set([
      descreverForma('dobrada', 'X'),
      descreverForma('frasco', 'X'),
      descreverForma('bloco', 'X'),
    ]);
    expect(textos.size).toBe(3);
  });
});
