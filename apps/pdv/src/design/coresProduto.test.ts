import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CORES_PRODUTO,
  corDoProduto,
  listarCoresProduto,
  precisaDeContorno,
} from './coresProduto.js';

describe('corDoProduto()', () => {
  it('traduz a chave do cadastro no tom exibido', () => {
    expect(corDoProduto('vinho').hex).toBe('#7A3129');
    expect(corDoProduto('nude').hex).toBe('#D8B49C');
    expect(corDoProduto('preto').hex).toBe('#1A1A1C');
  });

  it('aceita a chave como a operadora digitaria — caixa e acento variados', () => {
    expect(corDoProduto('VINHO').hex).toBe('#7A3129');
    expect(corDoProduto('  Vinho ').hex).toBe('#7A3129');
    expect(corDoProduto('marinho').rotulo).toBe('Azul marinho');
  });

  it('reconhece a grafia que o cadastro usa de verdade', () => {
    // A etiqueta do fornecedor diz "Azul Marinho", não "marinho". Sem apelido,
    // uma peça catalogada apareceria como cor desconhecida só pela grafia.
    expect(corDoProduto('Azul Marinho').desconhecida).toBe(false);
    expect(corDoProduto('Azul Marinho').hex).toBe(CORES_PRODUTO.marinho.hex);
    expect(corDoProduto('Off White').hex).toBe(CORES_PRODUTO.marfim.hex);
    expect(corDoProduto('bordô').hex).toBe(CORES_PRODUTO.vinho.hex);
  });

  it('cobre as cores que o catálogo da loja usa', () => {
    for (const cor of ['Preto', 'Branco', 'Nude', 'Vermelho', 'Rosa', 'Vinho', 'Verde', 'Estampado']) {
      expect(corDoProduto(cor).desconhecida, `"${cor}" deveria estar catalogada`).toBe(false);
    }
  });

  it('não derruba a venda quando a cor não está catalogada', () => {
    // Produto com cor nova, cadastrada depois que o front foi publicado:
    // precisa continuar vendável, só sinalizado.
    const desconhecida = corDoProduto('lilas-perolado');
    expect(desconhecida.desconhecida).toBe(true);
    expect(desconhecida.hex).toMatch(/^#[0-9A-F]{6}$/i);
    expect(desconhecida.chave).toBe('lilas-perolado');
  });

  it('trata ausência de cor sem estourar', () => {
    expect(corDoProduto(null).desconhecida).toBe(true);
    expect(corDoProduto(undefined).desconhecida).toBe(true);
    expect(corDoProduto('').desconhecida).toBe(true);
  });
});

describe('precisaDeContorno()', () => {
  it('marca contorno para tons claros que sumiriam no fundo branco', () => {
    expect(precisaDeContorno(CORES_PRODUTO.marfim.hex)).toBe(true);
  });

  it('não contorna tons escuros, que já se destacam sozinhos', () => {
    expect(precisaDeContorno(CORES_PRODUTO.preto.hex)).toBe(false);
    expect(precisaDeContorno(CORES_PRODUTO.vinho.hex)).toBe(false);
    expect(precisaDeContorno(CORES_PRODUTO.marinho.hex)).toBe(false);
  });
});

describe('listarCoresProduto()', () => {
  it('lista todas as cores catalogadas para o seletor do cadastro', () => {
    const lista = listarCoresProduto();
    expect(lista).toHaveLength(Object.keys(CORES_PRODUTO).length);
    expect(lista.every((cor) => !cor.desconhecida)).toBe(true);
    expect(lista.map((cor) => cor.chave)).toContain('vinho');
  });
});

describe('separação entre paleta de catálogo e paleta de interface', () => {
  /**
   * Esta é a regra que motivou separar os dois sistemas de cor. Um teste de
   * comentário não impede regressão — este lê o arquivo e falha se alguém
   * fizer a cor do produto derivar de um token de interface.
   */
  it('nenhuma cor de produto deriva de token de interface', () => {
    const fonte = readFileSync(resolve(import.meta.dirname, 'coresProduto.ts'), 'utf-8');

    expect(fonte).not.toMatch(/var\(\s*--accent/);
    expect(fonte).not.toMatch(/var\(\s*--ink/);
    expect(fonte).not.toMatch(/var\(\s*--surface/);
    expect(fonte).not.toMatch(/var\(\s*--bg/);
  });

  it('toda cor catalogada é um hex literal, não uma referência a CSS var', () => {
    for (const [chave, cor] of Object.entries(CORES_PRODUTO)) {
      expect(cor.hex, `cor "${chave}" deveria ser hex literal`).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
