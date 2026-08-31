import { calcularVenda, deReais, type ItemEntrada } from '@pdv/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCarrinho, type VendaConcluida } from '../estado/carrinhoStore.js';
import { TelaVendaConcluida } from './TelaVendaConcluida.js';

const itens: ItemEntrada[] = [
  {
    varianteId: 'a',
    quantidade: 1,
    precoUnitarioCentavos: deReais('89,90'),
    descontoCentavos: deReais('0'),
  },
];
const calculo = calcularVenda(itens);

function vendaDe(categoria: string | null, nome = 'Calcinha Fio Duplo'): VendaConcluida {
  return {
    calculo,
    dados: {
      numero: null,
      vendaId: 'abc12345-6789-4abc-8def-000000000000',
      momento: new Date(2026, 7, 31, 14, 5),
      operador: 'Ana Souza',
      itens: [
        {
          descricao: nome,
          categoria,
          tamanho: 'M',
          cor: 'Preto',
          quantidade: 1,
          precoUnitarioCentavos: 8990,
          totalCentavos: 8990,
        },
      ],
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 10_000, trocoCentavos: 1010 }],
    },
  };
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/venda/concluida']}>
      <Routes>
        <Route path="/venda/concluida" element={<TelaVendaConcluida />} />
        <Route path="/venda" element={<p>tela de venda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useCarrinho.getState().limparVenda();
  useCarrinho.getState().descartarAviso();
});

describe('TelaVendaConcluida', () => {
  it('diz sem ambiguidade que a venda foi registrada, com o total', () => {
    // É isso que solta a operadora para atender a próxima cliente.
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    expect(screen.getByText('Venda registrada')).toBeVisible();
    expect(screen.getByText('R$ 89,90')).toBeVisible();
  });

  it('mostra o código curto, que é como o suporte acha a venda', () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    expect(screen.getByText('ABC12345')).toBeVisible();
  });

  it('o comprovante na tela sai discreto: sem o nome do produto', () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    const comprovante = screen.getByLabelText('Comprovante da venda');
    expect(comprovante).not.toHaveTextContent('Calcinha Fio Duplo');
    expect(comprovante).toHaveTextContent('Peca intima M/Preto');
  });

  it('a cliente pode pedir a via com o nome dos produtos', async () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    await userEvent.click(screen.getByRole('checkbox', { name: /nome dos produtos/ }));

    expect(screen.getByLabelText('Comprovante da venda')).toHaveTextContent('Calcinha Fio Duplo');
  });

  it('o comprovante traz a política de troca e a ressalva de defeito', () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    const comprovante = screen.getByLabelText('Comprovante da venda');
    expect(comprovante).toHaveTextContent('POLITICA DE TROCA');
    expect(comprovante).toHaveTextContent(/higiene/);
    expect(comprovante).toHaveTextContent(/defeito de fabricacao/i);
  });

  it('explica a política na tela quando a venda tem peça íntima', () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    expect(screen.getByText(/já está impressa no comprovante/i)).toBeVisible();
  });

  it('venda sem peça íntima não repete o aviso de higiene na tela', () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Perfumaria', 'Perfume Sedução'));
    montar();

    expect(screen.queryByText(/já está impressa no comprovante/i)).not.toBeInTheDocument();
  });

  it('o comprovante mostra o troco, que é o número que a operadora confere', () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    expect(screen.getByLabelText('Comprovante da venda')).toHaveTextContent('TROCO');
  });

  it('"Nova venda" limpa o comprovante e volta ao trabalho', async () => {
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Nova venda' }));

    expect(await screen.findByText('tela de venda')).toBeVisible();
    // Sem isso, recarregar a tela mostraria o comprovante de uma venda velha.
    expect(useCarrinho.getState().ultimaVenda).toBeNull();
  });

  it('sem venda na memória, volta para a venda em vez de tela vazia', async () => {
    // Acontece ao recarregar a página ou colar a URL.
    montar();
    expect(await screen.findByText('tela de venda')).toBeVisible();
  });

  it('sem WebGL, a confirmação cai no palco estático e não em erro', () => {
    // jsdom não tem WebGL — o mesmo caso do mini-PC com driver antigo.
    useCarrinho.getState().registrarSucesso(vendaDe('Lingerie'));
    montar();

    expect(screen.getByRole('img', { name: 'Embalagem da marca' })).toBeVisible();
  });
});
