import { describe, expect, it } from 'vitest';
import type { ItemDisponivelParaDevolucao } from '../api/cliente.js';
import {
  ajustarQuantidade,
  itensParaEnviar,
  podeConfirmarDevolucao,
  quantidadeDisponivel,
  totalADevolverCentavos,
} from './devolucao.js';

function item(parcial: Partial<ItemDisponivelParaDevolucao> = {}): ItemDisponivelParaDevolucao {
  return {
    itemVendaId: 'item-1',
    varianteId: 'variante-1',
    descricao: 'Conjunto Renda P Preto',
    sku: 'CJ-P-PRETO',
    quantidadeVendida: 2,
    quantidadeJaDevolvida: 0,
    precoUnitarioLiquidoCentavos: 5000,
    ...parcial,
  };
}

describe('quantidadeDisponivel', () => {
  it('é o vendido menos o já devolvido', () => {
    expect(quantidadeDisponivel(item({ quantidadeVendida: 3, quantidadeJaDevolvida: 1 }))).toBe(2);
  });

  it('nunca fica negativa, mesmo com dado inconsistente', () => {
    // Não deveria acontecer (o servidor garante), mas a tela não pode
    // exibir "-1 disponível" se algo chegar torto.
    expect(quantidadeDisponivel(item({ quantidadeVendida: 1, quantidadeJaDevolvida: 5 }))).toBe(0);
  });
});

describe('ajustarQuantidade', () => {
  it('incrementa até o disponível', () => {
    const i = item({ quantidadeVendida: 2, quantidadeJaDevolvida: 0 });
    expect(ajustarQuantidade(i, 0, 1)).toBe(1);
    expect(ajustarQuantidade(i, 1, 1)).toBe(2);
    // Terceiro clique não passa de 2 — é tudo que a venda tem.
    expect(ajustarQuantidade(i, 2, 1)).toBe(2);
  });

  it('decrementa até zero, nunca fica negativo', () => {
    const i = item();
    expect(ajustarQuantidade(i, 1, -1)).toBe(0);
    expect(ajustarQuantidade(i, 0, -1)).toBe(0);
  });

  it('respeita o que já foi devolvido antes', () => {
    // Vendeu 3, já devolveu 2: só resta 1 para devolver agora.
    const i = item({ quantidadeVendida: 3, quantidadeJaDevolvida: 2 });
    expect(ajustarQuantidade(i, 0, 5)).toBe(1);
  });
});

describe('totalADevolverCentavos', () => {
  it('soma quantidade marcada vezes preço líquido de cada item', () => {
    const itens = [
      item({ itemVendaId: 'a', precoUnitarioLiquidoCentavos: 5000 }),
      item({ itemVendaId: 'b', precoUnitarioLiquidoCentavos: 3000 }),
    ];
    const marcados = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    // 1×5000 + 2×3000 = 11000
    expect(totalADevolverCentavos(itens, marcados)).toBe(11000);
  });

  it('item não marcado não entra na soma', () => {
    const itens = [item({ itemVendaId: 'a', precoUnitarioLiquidoCentavos: 5000 })];
    expect(totalADevolverCentavos(itens, new Map())).toBe(0);
  });
});

describe('podeConfirmarDevolucao', () => {
  const base = { totalCentavos: 5000, motivo: 'Cliente trocou de ideia', gerenteId: 'g-1' };

  it('libera com total positivo, motivo e gerente', () => {
    expect(podeConfirmarDevolucao(base)).toBe(true);
  });

  it('bloqueia sem nenhuma peça marcada', () => {
    expect(podeConfirmarDevolucao({ ...base, totalCentavos: 0 })).toBe(false);
  });

  it('bloqueia sem motivo, inclusive só espaços', () => {
    expect(podeConfirmarDevolucao({ ...base, motivo: '' })).toBe(false);
    expect(podeConfirmarDevolucao({ ...base, motivo: '   ' })).toBe(false);
  });

  it('bloqueia sem gerente identificada', () => {
    expect(podeConfirmarDevolucao({ ...base, gerenteId: null })).toBe(false);
  });
});

describe('itensParaEnviar', () => {
  it('descarta itens com quantidade zero', () => {
    const marcados = new Map([
      ['a', 2],
      ['b', 0],
      ['c', 1],
    ]);
    expect(itensParaEnviar(marcados)).toEqual([
      { itemVendaId: 'a', quantidade: 2 },
      { itemVendaId: 'c', quantidade: 1 },
    ]);
  });

  it('nenhum item marcado dá lista vazia', () => {
    expect(itensParaEnviar(new Map())).toEqual([]);
  });
});
