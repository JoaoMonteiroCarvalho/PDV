import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTORNO,
  ESPIRAL,
  MEIA_LARGURA,
  PONTA_DE_DENTRO,
  PONTA_DE_FORA,
  amostrar,
  caminhoDaEspiral,
  caminhoDoContorno,
} from './formaDaMarca.js';

/**
 * O teste que mais vale aqui não é sobre estética — é sobre FIDELIDADE.
 *
 * O manual da marca diz para não distorcer o símbolo. Antes desta versão, a
 * forma era uma curva ajustada a olho contra uma imagem, e ela não batia com
 * o desenho oficial. Agora o módulo copia o `d` do arquivo da identidade, e é
 * essa cópia que os testes protegem: se alguém "melhorar" a curva à mão, ou
 * se o arquivo da marca mudar sem o código acompanhar, aqui fica vermelho.
 */
const ARQUIVO_DA_MARCA = resolve(
  import.meta.dirname,
  '../../public/marca/rm-icone-cor.svg',
);

function caminhosDoArquivoOficial(): string[] {
  const svg = readFileSync(ARQUIVO_DA_MARCA, 'utf-8');
  return [...svg.matchAll(/<path d="([^"]+)"/g)].map((achado) => achado[1]!);
}

/** Conta quantas cúbicas um `d` tem, sem depender de espaçamento. */
function quantidadeDeCubicas(d: string): number {
  return (d.match(/C/gi) ?? []).length;
}

describe('fidelidade ao arquivo da identidade', () => {
  it('o arquivo oficial existe e traz os dois traços', () => {
    // Se a pasta da marca sumir num deploy, é melhor saber por um teste
    // vermelho do que por uma tela de login sem logo.
    expect(caminhosDoArquivoOficial()).toHaveLength(2);
  });

  it('o contorno tem as mesmas curvas do arquivo', () => {
    const [contornoOficial] = caminhosDoArquivoOficial();
    expect(CONTORNO).toHaveLength(quantidadeDeCubicas(contornoOficial!));
  });

  it('a espiral tem as mesmas curvas do arquivo', () => {
    const [, espiralOficial] = caminhosDoArquivoOficial();
    expect(ESPIRAL).toHaveLength(quantidadeDeCubicas(espiralOficial!));
  });

  it('as proporções batem com o desenho oficial', () => {
    /*
     * No arquivo o contorno vai de y=22 a y=73 (altura 51) e de x≈32 a x≈68.
     * Normalizado, a meia-altura é 1 e a meia-largura fica em ~0,70. Se
     * alguém mexer no eixo ou na escala da conversão, esta razão muda e o
     * símbolo sai esticado — que é exatamente o que o manual proíbe.
     */
    expect(MEIA_LARGURA).toBeGreaterThan(0.66);
    expect(MEIA_LARGURA).toBeLessThan(0.74);
  });
});

describe('contorno', () => {
  it('fecha o laço: cada trecho começa onde o anterior terminou', () => {
    // Um contorno com buraco viraria um tubo partido na cena 3D.
    for (let i = 0; i < CONTORNO.length; i += 1) {
      const atual = CONTORNO[i]!;
      const proximo = CONTORNO[(i + 1) % CONTORNO.length]!;
      expect(atual.para.x).toBeCloseTo(proximo.de.x, 6);
      expect(atual.para.y).toBeCloseTo(proximo.de.y, 6);
    }
  });

  it('tem ponta em cima e embaixo, no eixo', () => {
    const pontos = amostrar(CONTORNO, 64);
    const topo = pontos.reduce((a, b) => (b.y > a.y ? b : a));
    const base = pontos.reduce((a, b) => (b.y < a.y ? b : a));

    expect(topo.y).toBeCloseTo(1, 6);
    expect(topo.x).toBeCloseTo(0, 6);
    expect(base.y).toBeCloseTo(-1, 6);
    expect(base.x).toBeCloseTo(0, 6);
  });

  it('é simétrico em relação ao eixo vertical', () => {
    // Uma lateral mais gorda que a outra saltaria à vista muito antes de
    // alguém abrir o código — mas o eixo da conversão é fácil de errar.
    const xs = amostrar(CONTORNO, 64).map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 6);
  });

  it('é mais alto que largo', () => {
    expect(MEIA_LARGURA).toBeLessThan(1);
  });
});

describe('espiral', () => {
  it('cabe dentro do botão, sem encostar no contorno', () => {
    // Espiral tocando a borda viraria um borrão nos dois desenhos.
    for (const p of amostrar(ESPIRAL, 64)) {
      expect(Math.abs(p.x)).toBeLessThan(MEIA_LARGURA);
      expect(Math.abs(p.y)).toBeLessThan(1);
    }
  });

  it('é aberta: as duas pontas ficam soltas', () => {
    // Se ela fechasse, deixaria de ser espiral e viraria um anel.
    const distancia = Math.hypot(
      PONTA_DE_DENTRO.x - PONTA_DE_FORA.x,
      PONTA_DE_DENTRO.y - PONTA_DE_FORA.y,
    );
    expect(distancia).toBeGreaterThan(0.1);
  });

  it('enrola para dentro: a ponta final está mais perto do centro', () => {
    const doCentro = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    expect(doCentro(PONTA_DE_DENTRO)).toBeLessThan(doCentro(PONTA_DE_FORA));
  });
});

describe('caminhos em SVG', () => {
  const centro = { x: 130, y: 130 };

  it('o contorno sai fechado, com todas as cúbicas', () => {
    const d = caminhoDoContorno(100, centro);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(d.match(/C /g)).toHaveLength(CONTORNO.length);
  });

  it('a espiral sai ABERTA — sem Z', () => {
    // Um `Z` aqui fecharia a espiral com uma reta atravessando o miolo.
    const d = caminhoDaEspiral(100, centro);
    expect(d.endsWith('Z')).toBe(false);
    expect(d.match(/C /g)).toHaveLength(ESPIRAL.length);
  });

  it('inverte o y, porque no SVG o eixo cresce para baixo', () => {
    // O topo do símbolo (y = 1) tem que virar o MENOR y do SVG.
    const d = caminhoDoContorno(100, centro);
    expect(d.slice(2, d.indexOf(' C'))).toBe('130.00 30.00');
  });
});
