import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ItemCatalogo } from '../banco/local.js';
import { agruparPorProduto } from '../catalogo/grade.js';
import { CardProduto } from './CardProduto.js';

function variante(parcial: Partial<ItemCatalogo> & { id: string }): ItemCatalogo {
  return {
    produtoId: 'p1',
    sku: `SKU-${parcial.id}`,
    codigoBarras: null,
    nome: 'Conjunto Renda',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: null,
    cor: null,
    precoCentavos: 8990,
    ativo: true,
    saldoEstoque: 4,
    atualizadoEm: '2026-08-01T10:00:00.000Z',
    termos: [],
    ...parcial,
  };
}

/**
 * O card tem um link para a consulta do produto, e `<Link>` exige contexto de
 * rota. Renderizar sem router lançaria — e o erro apontaria para o teste, não
 * para a causa.
 */
function montar(elemento: ReactElement) {
  return render(<MemoryRouter>{elemento}</MemoryRouter>);
}

const COM_GRADE = agruparPorProduto([
  variante({ id: 'a', cor: 'Preto', tamanho: 'P', saldoEstoque: 3 }),
  variante({ id: 'b', cor: 'Preto', tamanho: 'GG', saldoEstoque: 0 }),
  variante({ id: 'c', cor: 'Vinho', tamanho: 'P', saldoEstoque: 7 }),
])[0]!;

describe('CardProduto', () => {
  it('mostra a grade inteira no resultado da busca, sem abrir outra tela', () => {
    montar(<CardProduto produto={COM_GRADE} aoAdicionar={vi.fn()} />);

    // Ambas as cores e ambos os tamanhos visíveis de uma vez: é o que permite
    // responder "tem no GG vinho?" sem navegar.
    expect(screen.getByRole('columnheader', { name: 'P' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'GG' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Preto/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Vinho/ })).toBeInTheDocument();
  });

  it('distingue esgotado de combinação não vendida', () => {
    montar(<CardProduto produto={COM_GRADE} aoAdicionar={vi.fn()} />);

    // Preto/GG existe e zerou: continua sendo botão, com saldo zero.
    expect(screen.getByRole('button', { name: /Preto GG, sem saldo registrado/ })).toBeInTheDocument();

    // Vinho/GG nunca foi cadastrado: não é botão, e diz o motivo.
    expect(screen.queryByRole('button', { name: /Vinho GG/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Vinho GG: não vendido')).toBeInTheDocument();
  });

  it('clicar numa célula adiciona exatamente aquela variante', async () => {
    const aoAdicionar = vi.fn();
    montar(<CardProduto produto={COM_GRADE} aoAdicionar={aoAdicionar} />);

    await userEvent.click(screen.getByRole('button', { name: /Vinho P, 7 em estoque/ }));

    expect(aoAdicionar).toHaveBeenCalledTimes(1);
    expect(aoAdicionar.mock.calls[0]![0]).toMatchObject({ id: 'c', cor: 'Vinho', tamanho: 'P' });
  });

  it('célula esgotada continua clicável', async () => {
    // O saldo local vem da última sincronização. A peça pode estar na arara
    // agora — bloquear por número defasado é pior que vender o que existe.
    const aoAdicionar = vi.fn();
    montar(<CardProduto produto={COM_GRADE} aoAdicionar={aoAdicionar} />);

    await userEvent.click(screen.getByRole('button', { name: /Preto GG, sem saldo/ }));

    expect(aoAdicionar.mock.calls[0]![0]).toMatchObject({ id: 'b' });
  });

  it('mostra faixa de preço quando as variações custam diferente', () => {
    const produto = agruparPorProduto([
      variante({ id: 'a', cor: 'Preto', tamanho: 'P', precoCentavos: 8990 }),
      variante({ id: 'b', cor: 'Preto', tamanho: 'GG', precoCentavos: 10990 }),
    ])[0]!;
    montar(<CardProduto produto={produto} aoAdicionar={vi.fn()} />);

    expect(screen.getByText('R$ 89,90 – R$ 109,90')).toBeInTheDocument();
  });

  it('produto sem variação vira um botão só, não uma grade de uma célula', () => {
    const perfume = agruparPorProduto([
      variante({ id: 'x', produtoId: 'p9', nome: 'Perfume', cor: null, tamanho: null }),
    ])[0]!;
    montar(<CardProduto produto={perfume} aoAdicionar={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Adicionar' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('cor não catalogada não impede a venda, só sinaliza', () => {
    const produto = agruparPorProduto([
      variante({ id: 'a', cor: 'Tie-dye', tamanho: 'M', saldoEstoque: 2 }),
    ])[0]!;
    montar(<CardProduto produto={produto} aoAdicionar={vi.fn()} />);

    expect(screen.getByLabelText('Tie-dye, cor não catalogada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tie-dye M, 2 em estoque/ })).toBeEnabled();
  });
});
