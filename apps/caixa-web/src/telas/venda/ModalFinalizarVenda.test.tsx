import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemCarrinho } from '@/estado/useCarrinho.js';
import { ModalFinalizarVenda } from './ModalFinalizarVenda.js';

const itensDeTeste: ItemCarrinho[] = [
  {
    varianteId: 'v1',
    codigoBarras: '789',
    sku: 'CJ-REN',
    nome: 'Conjunto Renda',
    tamanho: 'P',
    cor: 'Preto',
    precoCentavos: 8990,
    quantidade: 1,
  },
];

function renderizar(itens: ItemCarrinho[] = itensDeTeste) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoConcluir = vi.fn();
  const aoFechar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <ModalFinalizarVenda
        itens={itens}
        sessaoCaixaId="sessao-1"
        cliente={null}
        aoConcluir={aoConcluir}
        aoFechar={aoFechar}
      />
    </QueryClientProvider>,
  );
  return { aoConcluir, aoFechar };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModalFinalizarVenda', () => {
  it('mostra o total da venda e "falta" o valor inteiro sem pagamento nenhum', () => {
    renderizar();
    expect(screen.getByText('R$ 89,90')).toBeInTheDocument();
    expect(screen.getByText('Falta R$ 89,90')).toBeInTheDocument();
  });

  it('desabilita finalizar enquanto o pagamento não completa o total', async () => {
    renderizar();
    expect(screen.getByRole('button', { name: /Finalizar/ })).toBeDisabled();
  });

  it('pagamento exato em PIX completa a venda sem troco', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'PIX' }));
    // O valor já vem pré-preenchido com o saldo restante (89,90).
    await usuario.keyboard('{Enter}');

    expect(await screen.findByText('Pagamento completo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finalizar/ })).toBeEnabled();
  });

  /**
   * O caso central desta fase: dinheiro que passa do total gera troco em
   * tempo real, e o pagamento fecha exatamente no total da venda (nunca no
   * valor bruto recebido).
   */
  it('dinheiro acima do total calcula troco e completa o pagamento', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Dinheiro' }));
    const campoValor = screen.getByPlaceholderText('0,00');
    await usuario.clear(campoValor);
    await usuario.type(campoValor, '100,00');

    // Troco em tempo real, antes mesmo de confirmar a linha.
    expect(await screen.findByText('Troco: R$ 10,10')).toBeInTheDocument();

    await usuario.keyboard('{Enter}');

    expect(await screen.findByText(/Pagamento completo.*troco R\$ 10,10/)).toBeInTheDocument();
  });

  it('pagamento dividido em duas formas soma até completar o total', async () => {
    const usuario = userEvent.setup();
    renderizar([{ ...itensDeTeste[0]!, precoCentavos: 15000, sku: 'X' }]);

    await usuario.click(screen.getByRole('button', { name: 'Dinheiro' }));
    const campo1 = screen.getByPlaceholderText('0,00');
    await usuario.clear(campo1);
    await usuario.type(campo1, '100,00{Enter}');

    expect(await screen.findByText('Falta R$ 50,00')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'PIX' }));
    // Pré-preenchido com o saldo restante (50,00).
    await usuario.keyboard('{Enter}');

    expect(await screen.findByText('Pagamento completo')).toBeInTheDocument();
  });

  it('remover um pagamento já lançado volta a mostrar o que falta', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'PIX' }));
    await usuario.keyboard('{Enter}');
    expect(await screen.findByText('Pagamento completo')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: /Remover pagamento/ }));
    expect(await screen.findByText('Falta R$ 89,90')).toBeInTheDocument();
  });

  it('cartão de crédito não pode receber mais do que falta (sem troco em cartão)', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Crédito' }));
    const campoValor = screen.getByPlaceholderText('0,00');
    await usuario.clear(campoValor);
    await usuario.type(campoValor, '200,00{Enter}');

    // Limitado ao saldo (89,90), não aos 200 digitados — cartão não devolve troco.
    expect(await screen.findByText('Pagamento completo')).toBeInTheDocument();
    expect(screen.queryByText(/troco/i)).not.toBeInTheDocument();
  });
});
