import { describe, expect, it } from 'vitest';
import {
  CENTRO_ESPIRAL,
  CONTORNO,
  MEIA_LARGURA,
  caminhoDaEspiral,
  caminhoDoContorno,
  pontoDaEspiral,
  pontosDaEspiral,
  type Ponto,
} from './formaDaMarca.js';

/** Avalia uma cúbica de Bézier em `t`. */
function cubica(
  de: Ponto,
  c1: Ponto,
  c2: Ponto,
  para: Ponto,
  t: number,
): Ponto {
  const u = 1 - t;
  const eixo = (a: number, b: number, c: number, d: number) =>
    u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d;
  return {
    x: eixo(de.x, c1.x, c2.x, para.x),
    y: eixo(de.y, c1.y, c2.y, para.y),
  };
}

function pontosDoContorno(porSegmento = 60): Ponto[] {
  const pontos: Ponto[] = [];
  for (const s of CONTORNO) {
    for (let i = 0; i < porSegmento; i += 1) {
      pontos.push(cubica(s.de, s.controle1, s.controle2, s.para, i / porSegmento));
    }
  }
  return pontos;
}

describe('contorno da folha', () => {
  it('fecha o laço: cada trecho começa onde o anterior terminou', () => {
    // Um contorno com buraco viraria um tubo partido na cena 3D.
    for (let i = 0; i < CONTORNO.length; i += 1) {
      const atual = CONTORNO[i]!;
      const proximo = CONTORNO[(i + 1) % CONTORNO.length]!;
      expect(atual.para.x).toBeCloseTo(proximo.de.x, 10);
      expect(atual.para.y).toBeCloseTo(proximo.de.y, 10);
    }
  });

  it('tem ponta em cima e embaixo, no eixo', () => {
    const pontos = pontosDoContorno();
    const topo = pontos.reduce((a, b) => (b.y > a.y ? b : a));
    const base = pontos.reduce((a, b) => (b.y < a.y ? b : a));

    expect(topo.y).toBeCloseTo(1, 6);
    expect(topo.x).toBeCloseTo(0, 6);
    expect(base.y).toBeCloseTo(-1, 6);
    expect(base.x).toBeCloseTo(0, 6);
  });

  it('é simétrico em relação ao eixo vertical', () => {
    // A marca é simétrica; uma lateral mais gorda que a outra saltaria à
    // vista muito antes de alguém abrir o código.
    const pontos = pontosDoContorno();
    const maiorX = Math.max(...pontos.map((p) => p.x));
    const menorX = Math.min(...pontos.map((p) => p.x));
    expect(maiorX).toBeCloseTo(-menorX, 6);
  });

  it('respeita a largura declarada, sem estourar nem sobrar', () => {
    const maiorX = Math.max(...pontosDoContorno().map((p) => p.x));
    expect(maiorX).toBeGreaterThan(MEIA_LARGURA * 0.99);
    expect(maiorX).toBeLessThan(MEIA_LARGURA * 1.02);
  });

  it('a ponta de baixo é mais aberta que a de cima', () => {
    // Não é detalhe: invertidas, a folha aponta para o lado errado.
    const anguloDaPonta = (s: (typeof CONTORNO)[number], naOrigem: boolean) => {
      const p = naOrigem ? s.de : s.para;
      const c = naOrigem ? s.controle1 : s.controle2;
      return Math.atan2(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
    };
    const cima = anguloDaPonta(CONTORNO[0]!, true);
    const baixo = anguloDaPonta(CONTORNO[1]!, false);
    expect(baixo).toBeGreaterThan(cima);
  });

  it('a emenda no meio da lateral não cria bico', () => {
    // As tangentes que chegam e que saem do ponto mais largo têm que ser
    // colineares — senão aparece um vinco visível na silhueta.
    const chega = CONTORNO[0]!;
    const sai = CONTORNO[1]!;
    const entrada = { x: chega.para.x - chega.controle2.x, y: chega.para.y - chega.controle2.y };
    const saida = { x: sai.controle1.x - sai.de.x, y: sai.controle1.y - sai.de.y };

    const cruzado = entrada.x * saida.y - entrada.y * saida.x;
    expect(Math.abs(cruzado)).toBeLessThan(1e-9);
  });

  it('não fica mais largo do que alto', () => {
    const pontos = pontosDoContorno();
    const largura = Math.max(...pontos.map((p) => p.x)) * 2;
    expect(largura).toBeLessThan(2);
  });
});

describe('espiral', () => {
  it('abre do miolo para fora, sem voltar', () => {
    // Distância medida a partir do MIOLO da espiral, não do primeiro ponto
    // dela: o primeiro ponto já está a um raio de distância do centro, e daí
    // as distâncias não crescem de forma monótona.
    const centro = CENTRO_ESPIRAL;
    let raioAnterior = -1;
    for (let i = 0; i <= 40; i += 1) {
      const p = pontoDaEspiral(i / 40);
      const raio = Math.hypot(p.x - centro.x, p.y - centro.y);
      if (i > 0) expect(raio).toBeGreaterThan(raioAnterior);
      raioAnterior = raio;
    }
  });

  it('termina embaixo à esquerda, como na marca', () => {
    const fim = pontoDaEspiral(1);
    expect(fim.x).toBeLessThan(0);
    expect(fim.y).toBeLessThan(0);
  });

  it('cabe dentro da folha', () => {
    // Espiral encostando no contorno viraria um borrão nos dois desenhos.
    for (const p of pontosDaEspiral(200)) {
      expect(Math.abs(p.x)).toBeLessThan(MEIA_LARGURA * 0.85);
      expect(Math.abs(p.y)).toBeLessThan(0.8);
    }
  });

  it('entrega a quantidade de pontos pedida', () => {
    expect(pontosDaEspiral(10)).toHaveLength(11);
  });
});

describe('caminhos em SVG', () => {
  const centro = { x: 130, y: 130 };

  it('o contorno sai fechado e com as quatro cúbicas', () => {
    const d = caminhoDoContorno(100, centro);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(d.match(/C /g)).toHaveLength(4);
  });

  it('inverte o y, porque no SVG o eixo cresce para baixo', () => {
    // O topo da folha (y = 1) tem que virar o MENOR y do SVG.
    const d = caminhoDoContorno(100, centro);
    const primeiro = d.slice(2, d.indexOf(' C'));
    expect(primeiro).toBe('130.00 30.00');
  });

  it('a espiral sai como polilinha, do miolo para fora', () => {
    const d = caminhoDaEspiral(100, centro, 8);
    expect(d.match(/L /g)).toHaveLength(8);
    expect(d.match(/M /g)).toHaveLength(1);
  });
});
