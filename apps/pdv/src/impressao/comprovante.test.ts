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

  it('descreve o item com tamanho e cor', () => {
    expect(texto).toContain('Conjunto Renda Delicada M/Preto');
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
        itens: [
          {
            descricao: 'Conjunto de lingerie em renda francesa com detalhes bordados a mao e acabamento premium',
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
