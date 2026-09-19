import { describe, expect, it } from 'vitest';
import { montarGrade, separarLista, sugerirSku } from './gradeNova.js';

describe('separarLista', () => {
  it('quebra por vírgula e limpa espaço', () => {
    expect(separarLista('P, M, G')).toEqual(['P', 'M', 'G']);
  });

  it('ignora vazios de vírgula sobrando', () => {
    expect(separarLista('P,, M, ')).toEqual(['P', 'M']);
  });

  it('trata a mesma cor em caixas diferentes como uma só', () => {
    // Senão "Preto" e "preto" virariam duas variações da mesma peça, com dois
    // saldos de estoque separados.
    expect(separarLista('preto, Preto, PRETO')).toEqual(['preto']);
  });

  it('devolve vazio para texto em branco', () => {
    expect(separarLista('   ')).toEqual([]);
  });
});

describe('montarGrade', () => {
  it('faz o produto cartesiano de tamanhos por cores', () => {
    const grade = montarGrade('P, M', 'preto, nude');
    expect(grade).toHaveLength(4);
    expect(grade).toContainEqual({ tamanho: 'P', cor: 'preto' });
    expect(grade).toContainEqual({ tamanho: 'M', cor: 'nude' });
  });

  it('sem cor, gera uma variação por tamanho', () => {
    expect(montarGrade('P, M, G', '')).toEqual([
      { tamanho: 'P', cor: null },
      { tamanho: 'M', cor: null },
      { tamanho: 'G', cor: null },
    ]);
  });

  it('sem tamanho, gera uma variação por cor — perfume não tem tamanho', () => {
    expect(montarGrade('', 'preto, branco')).toEqual([
      { tamanho: null, cor: 'preto' },
      { tamanho: null, cor: 'branco' },
    ]);
  });

  it('sem nada, devolve vazio em vez de uma variação vazia', () => {
    // Quem não informou grade precisa saber disso, e não receber em silêncio
    // uma variação sem tamanho nem cor.
    expect(montarGrade('', '')).toEqual([]);
  });
});

describe('sugerirSku', () => {
  it('monta a partir do nome, da cor e do tamanho', () => {
    expect(sugerirSku('Conjunto Renda', 'M', 'preto')).toBe('CONJUNTO-RENDA-PRETO-M');
  });

  it('remove acento — o balcão digita sem, e o leitor não emite', () => {
    expect(sugerirSku('Camisola Cetim', 'G', 'champanhe')).toBe('CAMISOLA-CETIM-CHAMPANHE-G');
    expect(sugerirSku('Calcinha Básica', 'P', 'nude')).toBe('CALCINHA-BASICA-NUDE-P');
  });

  it('omite a parte que não existe', () => {
    expect(sugerirSku('Perfume Floral', null, null)).toBe('PERFUME-FLORAL');
    expect(sugerirSku('Perfume Floral', null, 'único')).toBe('PERFUME-FLORAL-UNICO');
  });

  it('corta o nome em três palavras para o código continuar legível', () => {
    expect(sugerirSku('Conjunto Renda Flor de Liz Premium', 'M', 'preto')).toBe(
      'CONJUNTO-RENDA-FLOR-PRETO-M',
    );
  });

  it('não deixa separador sobrando nas pontas', () => {
    expect(sugerirSku('  Body  ', 'M', '')).toBe('BODY-M');
  });

  it('gera códigos distintos para cada combinação da grade', () => {
    const grade = montarGrade('P, M', 'preto, nude');
    const skus = grade.map((combinacao) => sugerirSku('Body Tule', combinacao.tamanho, combinacao.cor));
    expect(new Set(skus).size).toBe(grade.length);
  });
});
