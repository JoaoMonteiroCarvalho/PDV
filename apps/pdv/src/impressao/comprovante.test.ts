import { calcularVenda, deReais, type ItemEntrada } from '@pdv/shared';
import { describe, expect, it } from 'vitest';
import { COLUNAS, montarComprovante, type DadosComprovante } from './comprovante.js';

const LOJA = {
  nome: 'Loja Exemplo',
  endereco: 'Rua das Flores, 100',
  telefone: '(11) 99999-0000',
};

const itens: ItemEntrada[] = [
  {
    varianteId: 'a',
    quantidade: 2,
    precoUnitarioCentavos: deReais('89,90'),
    descontoCentavos: deReais('0'),
  },
];

const venda = calcularVenda(itens, deReais('10,00'));

const dados: DadosComprovante = {
  numero: 42,
  vendaId: 'abc12345-6789-4abc-8def-000000000000',
  momento: new Date(2026, 7, 28, 15, 30),
  operador: 'Ana Souza',
  itens: [
    {
      descricao: 'Conjunto Renda Delicada',
      categoria: 'Lingerie',
      tamanho: 'M',
      cor: 'Preto',
      quantidade: 2,
      precoUnitarioCentavos: 8990,
      totalCentavos: venda.itens[0]!.totalCentavos,
    },
  ],
  pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 20_000, trocoCentavos: 3020 }],
};

describe('montarComprovante()', () => {
  const linhas = montarComprovante(venda, dados, LOJA);
  const texto = linhas.join('\n');

  it('nenhuma linha excede a largura do papel de 80mm', () => {
    for (const linha of linhas) {
      expect(linha.length, `linha longa demais: "${linha}"`).toBeLessThanOrEqual(COLUNAS);
    }
  });

  it('avisa que NÃO é documento fiscal, e mais de uma vez', () => {
    const ocorrencias = linhas.filter((linha) => linha.includes('NAO E DOCUMENTO FISCAL'));
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
  });

  it('põe o aviso fiscal antes dos valores, não escondido no rodapé', () => {
    const posicaoAviso = linhas.findIndex((linha) => linha.includes('NAO E DOCUMENTO FISCAL'));
    const posicaoTotal = linhas.findIndex((linha) => linha.includes('TOTAL'));
    expect(posicaoAviso).toBeLessThan(posicaoTotal);
  });

  it('mostra identificação da loja e do operador', () => {
    expect(texto).toContain('Loja Exemplo');
    expect(texto).toContain('Ana Souza');
  });

  it('não imprime o nome do produto — o papel sai discreto por padrão', () => {
    /*
     * O comprovante vai para a bolsa, a mesa da cozinha, a prestação de contas
     * de um casal. O nome é a parte que expõe a cliente; tamanho e cor ficam,
     * porque são o que ela usa para conferir a conta no balcão.
     */
    expect(texto).not.toContain('Conjunto Renda Delicada');
    expect(texto).toContain('Peca intima M/Preto');
  });

  it('imprime o nome real na via detalhada, quando a cliente pede', () => {
    const detalhado = montarComprovante(venda, { ...dados, discricao: 'completo' }, LOJA).join('\n');
    expect(detalhado).toContain('Conjunto Renda Delicada M/Preto');
  });

  it('traz a política de troca impressa, não só combinada de boca', () => {
    // É o que a cliente tem na mão se voltar em duas semanas, e o que protege
    // a loja quando ninguém lembra o que foi dito no balcão.
    expect(texto).toContain('POLITICA DE TROCA');
    expect(texto).toMatch(/higiene/);
    expect(texto).toMatch(/defeito de fabricacao/i);
  });

  it('mostra subtotal, desconto e total', () => {
    expect(texto).toContain('SUBTOTAL');
    expect(texto).toContain('R$ 179,80');
    expect(texto).toContain('DESCONTO');
    expect(texto).toContain('-R$ 10,00');
    expect(texto).toContain('R$ 169,80');
  });

  it('mostra a forma de pagamento e o troco', () => {
    expect(texto).toContain('Dinheiro');
    expect(texto).toContain('TROCO');
    expect(texto).toContain('R$ 30,20');
  });

  it('imprime o identificador curto da venda para o suporte rastrear', () => {
    expect(texto).toContain('ABC12345');
  });

  it('omite a linha de desconto quando não houve desconto', () => {
    const semDesconto = calcularVenda(itens);
    const saida = montarComprovante(semDesconto, dados, LOJA).join('\n');
    expect(saida).not.toContain('DESCONTO');
  });

  it('imprime "pendente" quando a venda ainda não subiu ao servidor', () => {
    // Venda fechada offline: o número sequencial só existe depois de sincronizar.
    const saida = montarComprovante(venda, { ...dados, numero: null }, LOJA).join('\n');
    expect(saida).toContain('Venda: pendente');
  });

  it('lista as parcelas do crediário quando houver', () => {
    const saida = montarComprovante(
      venda,
      {
        ...dados,
        pagamentos: [{ forma: 'CREDIARIO', valorCentavos: 16_980, trocoCentavos: 0 }],
        cliente: 'Carla Fernandes',
        parcelas: [
          { numero: 1, valorCentavos: 5660, vencimento: new Date(2026, 8, 10) },
          { numero: 2, valorCentavos: 5660, vencimento: new Date(2026, 9, 10) },
          { numero: 3, valorCentavos: 5660, vencimento: new Date(2026, 10, 10) },
        ],
      },
      LOJA,
    );

    const texto = saida.join('\n');
    expect(texto).toContain('CREDIARIO - PARCELAS');
    expect(texto).toContain('Carla Fernandes');
    expect(texto).toContain('01/03');
    expect(texto).toContain('03/03');
    for (const linha of saida) {
      expect(linha.length).toBeLessThanOrEqual(COLUNAS);
    }
  });

  it('corta descrição longa em vez de estourar o papel', () => {
    const saida = montarComprovante(
      venda,
      {
        ...dados,
        // Só a via detalhada imprime o nome real; é nela que a truncagem importa.
        discricao: 'completo',
        itens: [
          {
            descricao: 'Conjunto de lingerie em renda francesa com detalhes bordados a mao e acabamento premium',
            categoria: 'Lingerie',
            tamanho: 'GG',
            cor: 'Vermelho Escuro',
            quantidade: 1,
            precoUnitarioCentavos: 8990,
            totalCentavos: 8990,
          },
        ],
      },
      LOJA,
    );
    for (const linha of saida) {
      expect(linha.length).toBeLessThanOrEqual(COLUNAS);
    }
  });
});

describe('linha de política cadastrada pela loja', () => {
  function politica(extra: string | null) {
    return montarComprovante(venda, { ...dados, politicaDaLoja: extra }, LOJA).join('\n');
  }

  it('imprime a linha da loja junto do texto legal', () => {
    const texto = politica('Trocas de segunda a sexta, das 9h as 17h.');
    expect(texto).toContain('Trocas de segunda a sexta');
    expect(texto).toContain('Defeito de fabricacao: troca garantida.');
  });

  it('NÃO deixa a linha da loja substituir a garantia legal', () => {
    // Este é o teste que impede o campo de virar "não trocamos em hipótese
    // alguma": o direito continua impresso, esteja lá o que estiver.
    const texto = politica('Nao trocamos peca intima em nenhuma hipotese.');
    expect(texto).toContain('Defeito de fabricacao: troca garantida.');
  });

  it('sem linha cadastrada, o comprovante sai como antes', () => {
    expect(politica(null)).toBe(politica(''));
  });

  it('quebra a linha da loja em vez de estourar o papel', () => {
    const longa =
      'Trocas somente na loja da matriz, de segunda a sexta das nove as dezessete horas, mediante apresentacao deste comprovante';
    for (const linha of montarComprovante(venda, { ...dados, politicaDaLoja: longa }, LOJA)) {
      expect(linha.length).toBeLessThanOrEqual(COLUNAS);
    }
  });
});
