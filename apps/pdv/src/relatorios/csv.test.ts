import { describe, expect, it } from 'vitest';
import {
  BOM,
  SEPARADOR,
  centavosParaCsv,
  dataParaCsv,
  escaparCampo,
  montarCsv,
  nomeDoArquivo,
} from './csv.js';

describe('centavosParaCsv()', () => {
  it('usa vírgula decimal, que é o que o Excel pt-BR lê como número', () => {
    /*
     * "1234.56" no Excel em português não é número: vira texto e a soma da
     * coluna dá zero. Pior que dar erro, porque parece certo.
     */
    expect(centavosParaCsv(123_456)).toBe('1234,56');
    expect(centavosParaCsv(8_990)).toBe('89,90');
  });

  it('não põe separador de milhar', () => {
    // "1.234,56" faria o Excel ler o ponto como decimal em algumas
    // configurações, e o valor viraria 1,234.
    expect(centavosParaCsv(123_456)).not.toContain('.');
  });

  it('sempre duas casas', () => {
    expect(centavosParaCsv(100)).toBe('1,00');
    expect(centavosParaCsv(105)).toBe('1,05');
    expect(centavosParaCsv(0)).toBe('0,00');
  });

  it('negativo mantém o sinal antes do número', () => {
    expect(centavosParaCsv(-1_050)).toBe('-10,50');
  });

  it('valor grande continua exato', () => {
    expect(centavosParaCsv(999_999_99)).toBe('999999,99');
  });
});

describe('escaparCampo()', () => {
  it('deixa em paz o que não precisa', () => {
    expect(escaparCampo('Conjunto Renda')).toBe('Conjunto Renda');
  });

  it('protege campo com ponto e vírgula', () => {
    // A observação de uma sangria pode ter `;` — sem escapar, ela partiria a
    // linha em duas colunas e desalinharia o resto do arquivo.
    expect(escaparCampo('cofre; conferido')).toBe('"cofre; conferido"');
  });

  it('duplica aspas dentro do campo, como manda o RFC', () => {
    expect(escaparCampo('peça "premium"')).toBe('"peça ""premium"""');
  });

  it('protege quebra de linha', () => {
    expect(escaparCampo('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });
});

describe('montarCsv()', () => {
  const colunas = [
    { titulo: 'Produto', valor: (l: { nome: string; total: number }) => l.nome },
    { titulo: 'Total', valor: (l: { nome: string; total: number }) => centavosParaCsv(l.total) },
  ];

  it('começa com BOM — sem ele o Excel estraga o acento', () => {
    const csv = montarCsv(colunas, [{ nome: 'Calcinha Algodão', total: 1_000 }]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain('Calcinha Algodão');
  });

  it('separa por ponto e vírgula, não por vírgula', () => {
    // Com vírgula, o Excel pt-BR abre tudo numa coluna só.
    const csv = montarCsv(colunas, [{ nome: 'X', total: 100 }]);
    expect(csv).toContain(`Produto${SEPARADOR}Total`);
    expect(csv).toContain(`X${SEPARADOR}1,00`);
  });

  it('termina as linhas com CRLF', () => {
    const csv = montarCsv(colunas, [{ nome: 'X', total: 100 }]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('lista vazia gera só o cabeçalho, não arquivo vazio', () => {
    // Um arquivo de zero byte parece download quebrado; o cabeçalho sozinho
    // diz "não houve venda no período".
    const csv = montarCsv(colunas, []);
    expect(csv).toBe(`${BOM}Produto${SEPARADOR}Total\r\n`);
  });

  it('escapa o conteúdo das células', () => {
    const csv = montarCsv(colunas, [{ nome: 'A; B', total: 100 }]);
    expect(csv).toContain('"A; B"');
  });
});

describe('dataParaCsv()', () => {
  it('usa o formato brasileiro', () => {
    expect(dataParaCsv(new Date(2026, 8, 1))).toBe('01/09/2026');
    expect(dataParaCsv(new Date(2026, 11, 25))).toBe('25/12/2026');
  });
});

describe('nomeDoArquivo()', () => {
  it('carrega o período no nome — a pasta Downloads acumula exportações', () => {
    expect(nomeDoArquivo('vendas', '2026-09-01', '2026-09-30')).toBe(
      'vendas-2026-09-01-a-2026-09-30.csv',
    );
  });
});
