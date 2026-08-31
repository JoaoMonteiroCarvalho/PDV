import { describe, expect, it } from 'vitest';
import { descricaoParaComprovante, listarGenericos, normalizarCategoria } from './discricao.js';
import {
  linhasDaPoliticaTroca,
  temRestricaoDeHigiene,
  vendaExigeAvisoDeHigiene,
} from './politicaTroca.js';

describe('descricaoParaComprovante()', () => {
  it('troca o nome da peça íntima por um termo genérico', () => {
    // O papel vai para a bolsa, a mesa da cozinha, a prestação de contas de um
    // casal. O nome do produto é a parte que expõe a cliente.
    expect(descricaoParaComprovante('Calcinha Fio Duplo Algodão', 'Lingerie')).toBe('Peca intima');
  });

  it('é mais vago ainda nas categorias sensíveis', () => {
    expect(descricaoParaComprovante('Óleo de Massagem Beijável', 'Sensual')).toBe('Produto');
  });

  it('não esconde o que não constrange', () => {
    // Perfume não expõe ninguém, e a categoria ajuda a bater a conta.
    expect(descricaoParaComprovante('Perfume Sedução 100ml', 'Perfumaria')).toBe('Perfumaria');
  });

  it('devolve o nome real quando a cliente pede a via detalhada', () => {
    expect(descricaoParaComprovante('Calcinha Fio Duplo', 'Lingerie', 'completo')).toBe(
      'Calcinha Fio Duplo',
    );
  });

  it('categoria não cadastrada cai no genérico mais neutro, nunca no nome', () => {
    // Errar para o lado de esconder é o certo aqui: uma categoria nova não
    // pode vazar o nome do produto só porque ninguém mapeou ainda.
    expect(descricaoParaComprovante('Peça Misteriosa', 'Categoria Nova')).toBe('Produto');
    expect(descricaoParaComprovante('Peça Misteriosa', null)).toBe('Produto');
  });

  it('aceita a categoria como o cadastro escreve', () => {
    expect(descricaoParaComprovante('X', 'LINGERIE')).toBe('Peca intima');
    expect(descricaoParaComprovante('X', ' Cosméticos ')).toBe('Perfumaria');
  });

  it('nenhum genérico tem acento — a térmica troca acento por lixo', () => {
    for (const { generico } of listarGenericos()) {
      expect(generico).toMatch(/^[A-Za-z ]+$/);
    }
  });
});

describe('normalizarCategoria()', () => {
  it('tira acento e caixa', () => {
    expect(normalizarCategoria(' Moda Praia ')).toBe('moda praia');
    expect(normalizarCategoria('Cosméticos')).toBe('cosmeticos');
  });

  it('ausência vira string vazia, não quebra', () => {
    expect(normalizarCategoria(null)).toBe('');
    expect(normalizarCategoria(undefined)).toBe('');
  });
});

describe('temRestricaoDeHigiene()', () => {
  it('lingerie e moda praia são restritas — a peça é provada no corpo', () => {
    expect(temRestricaoDeHigiene('Lingerie')).toBe(true);
    expect(temRestricaoDeHigiene('Moda Praia')).toBe(true);
    expect(temRestricaoDeHigiene('Sensual')).toBe(true);
  });

  it('perfume e pijama não são', () => {
    expect(temRestricaoDeHigiene('Perfumaria')).toBe(false);
    expect(temRestricaoDeHigiene('Pijamas')).toBe(false);
    expect(temRestricaoDeHigiene(null)).toBe(false);
  });
});

describe('vendaExigeAvisoDeHigiene()', () => {
  it('exige aviso quando qualquer item é restrito', () => {
    expect(
      vendaExigeAvisoDeHigiene([{ categoria: 'Perfumaria' }, { categoria: 'Lingerie' }]),
    ).toBe(true);
  });

  it('não exige aviso em venda sem peça íntima', () => {
    // Pedir confirmação em toda venda treinaria a mão a clicar sem ler, que é
    // o mesmo que não pedir.
    expect(vendaExigeAvisoDeHigiene([{ categoria: 'Perfumaria' }])).toBe(false);
    expect(vendaExigeAvisoDeHigiene([])).toBe(false);
  });
});

describe('linhasDaPoliticaTroca()', () => {
  it('sempre garante a troca por defeito, que a loja não pode recusar', () => {
    // CDC art. 18: nenhuma política de loja derruba esse direito. Um
    // comprovante que dissesse só "peça íntima não troca" induziria a erro.
    for (const comRestricao of [true, false]) {
      const texto = linhasDaPoliticaTroca(comRestricao).join('\n');
      expect(texto).toMatch(/[Dd]efeito de fabricacao/);
    }
  });

  it('só menciona a restrição de higiene quando há peça restrita', () => {
    expect(linhasDaPoliticaTroca(true).join('\n')).toMatch(/higiene/);
    expect(linhasDaPoliticaTroca(false).join('\n')).not.toMatch(/higiene/);
  });

  it('a restrição vem acompanhada da ressalva, nunca sozinha', () => {
    const texto = linhasDaPoliticaTroca(true).join('\n');
    const posRestricao = texto.indexOf('sem troca');
    const posRessalva = texto.indexOf('EXCETO defeito');
    expect(posRestricao).toBeGreaterThanOrEqual(0);
    expect(posRessalva).toBeGreaterThan(posRestricao);
  });

  it('não promete os 7 dias de arrependimento para peça restrita', () => {
    // Art. 49 vale para compra FORA do estabelecimento. Prometer no balcão
    // criaria obrigação que a loja não tem.
    const linhas = linhasDaPoliticaTroca(true);
    const linhaDaRestricao = linhas.find((l) => l.includes('sem troca'))!;
    expect(linhaDaRestricao).not.toMatch(/7 dias/);
  });

  it('cabe na largura do papel', () => {
    for (const linha of linhasDaPoliticaTroca(true)) {
      expect(linha.length).toBeLessThanOrEqual(48);
    }
  });
});
