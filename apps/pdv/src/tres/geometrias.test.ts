/**
 * Estes testes existem para a otimização não ser desfeita sem alguém perceber.
 *
 * O ganho não é teórico — foi medido antes de mexer no código:
 *
 *   RoundedBox smoothness=3 -> 588 triângulos, 51,5 ms para construir 60
 *   RoundedBox smoothness=1 -> 108 triângulos,  8,7 ms para construir 60
 *
 * O catálogo desenha 20 cards. Sem compartilhar, eram 60 geometrias e 51 ms de
 * CPU toda vez que cards entravam na tela ao rolar — três frames perdidos numa
 * máquina rápida, e bem pior num mini-PC de balcão.
 */

import { describe, expect, it } from 'vitest';
import { GEOMETRIAS, materiaisEmCache, materialDaPeca, triangulosDe } from './geometrias.js';

describe('geometrias compartilhadas', () => {
  it('devolve SEMPRE o mesmo objeto — é isso que evita 60 construções', () => {
    // Se alguém trocar por uma função que constrói na hora, este teste cai.
    expect(GEOMETRIAS.baixo.laminas.base).toBe(GEOMETRIAS.baixo.laminas.base);
    expect(GEOMETRIAS.alto.frasco.corpo).toBe(GEOMETRIAS.alto.frasco.corpo);
    expect(GEOMETRIAS.baixo.bloco).toBe(GEOMETRIAS.baixo.bloco);
  });

  it('alto e baixo são objetos diferentes, não o mesmo com outro nome', () => {
    expect(GEOMETRIAS.alto.laminas.base).not.toBe(GEOMETRIAS.baixo.laminas.base);
  });

  it('o nível baixo tem MUITO menos triângulo que o alto', () => {
    const alto = triangulosDe(GEOMETRIAS.alto.laminas.base);
    const baixo = triangulosDe(GEOMETRIAS.baixo.laminas.base);

    expect(alto).toBe(588);
    expect(baixo).toBe(108);
    // Cinco vezes menos. Numa grade de 20 cards: 35.280 contra 6.480.
    expect(alto / baixo).toBeGreaterThan(5);
  });

  it('o frasco do card tem menos segmentos que o da consulta', () => {
    expect(triangulosDe(GEOMETRIAS.baixo.frasco.corpo)).toBeLessThan(
      triangulosDe(GEOMETRIAS.alto.frasco.corpo),
    );
  });

  it('uma grade de 20 cards cabe em orçamento de peça única', () => {
    /*
     * 20 cards × 3 lâminas no nível baixo. O teto de 10 mil é folgado para GPU
     * integrada e serve de alarme: se alguém subir o detalhe do card sem
     * pensar, isto avisa.
     */
    const porPeca = triangulosDe(GEOMETRIAS.baixo.laminas.base) * 3;
    expect(porPeca * 20).toBeLessThan(10_000);
  });
});

describe('materiais em cache', () => {
  it('a mesma cor devolve o mesmo material', () => {
    // O catálogo tem uma dúzia de cores; sem cache seriam 60 materiais.
    const primeiro = materialDaPeca('#7A3129', 'baixo');
    const segundo = materialDaPeca('#7A3129', 'baixo');
    expect(primeiro).toBe(segundo);
  });

  it('cores diferentes têm materiais diferentes', () => {
    expect(materialDaPeca('#7A3129', 'baixo')).not.toBe(materialDaPeca('#1A1A1C', 'baixo'));
  });

  it('o cache cresce com a paleta, não com o número de cards', () => {
    const antes = materiaisEmCache();
    // Cem cards da mesma cor: nenhum material novo.
    for (let i = 0; i < 100; i += 1) materialDaPeca('#D8B49C', 'baixo');
    expect(materiaisEmCache()).toBe(antes + 1);
  });

  it('o card usa Lambert e a peça grande usa Standard', () => {
    /*
     * Lambert tem fragment shader bem mais barato que o Standard, que é PBR
     * completo. Em tecido fosco a 132 px a diferença não aparece; o custo
     * multiplicado por 20 viewports numa GPU integrada, sim.
     */
    expect(materialDaPeca('#7A3129', 'baixo').type).toBe('MeshLambertMaterial');
    expect(materialDaPeca('#7A3129', 'alto').type).toBe('MeshStandardMaterial');
  });
});
