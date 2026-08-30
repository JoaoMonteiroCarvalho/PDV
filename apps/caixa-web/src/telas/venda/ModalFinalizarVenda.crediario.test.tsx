import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
    precoCentavos: 10000,
    quantidade: 1,
  },
];

function renderizar(cliente: { id: string; nome: string } | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoConcluir = vi.fn();
  const aoFechar = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ModalFinalizarVenda
        itens={itensDeTeste}
        sessaoCaixaId="sessao-1"
        cliente={cliente}
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

describe('ModalFinalizarVenda — crediário', () => {
  it('crediário fica desabilitado sem cliente vinculado', async () => {
    renderizar(null);
    expect(screen.getByRole('button', { name: 'Crediário' })).toBeDisabled();
  });

  it('habilita crediário com cliente e limite disponível, e pede parcelas + vencimento', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clienteId: 'cli-1',
        limiteCrediarioCentavos: 50000,
        emAbertoCentavos: 0,
        limiteDisponivelCentavos: 50000,
        parcelas: [],
      }),
    } as Response);
    renderizar({ id: 'cli-1', nome: 'Maria' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Crediário' })).toBeEnabled());
    await usuario.click(screen.getByRole('button', { name: 'Crediário' }));

    expect(screen.getByLabelText('Parcelas')).toBeInTheDocument();
    expect(screen.getByLabelText('1º vencimento')).toBeInTheDocument();
    expect(screen.getByText(/Limite disponível: R\$ 500,00/)).toBeInTheDocument();
  });

  it('confirma o pagamento em crediário com parcelas e completa o total da venda', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clienteId: 'cli-1',
        limiteCrediarioCentavos: 50000,
        emAbertoCentavos: 0,
        limiteDisponivelCentavos: 50000,
        parcelas: [],
      }),
    } as Response);
    renderizar({ id: 'cli-1', nome: 'Maria' });

    await usuario.click(await screen.findByRole('button', { name: 'Crediário' }));
    await usuario.clear(screen.getByLabelText('Parcelas'));
    await usuario.type(screen.getByLabelText('Parcelas'), '2');
    await usuario.type(screen.getByDisplayValue('100,00'), '{Enter}');

    expect(await screen.findByText('Pagamento completo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finalizar/ })).toBeEnabled();
  });

  it('recusa crediário quando o valor digitado passa do limite disponível', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        clienteId: 'cli-1',
        limiteCrediarioCentavos: 5000,
        emAbertoCentavos: 0,
        limiteDisponivelCentavos: 5000,
        parcelas: [],
      }),
    } as Response);
    renderizar({ id: 'cli-1', nome: 'Maria' });

    await usuario.click(await screen.findByRole('button', { name: 'Crediário' }));
    // Valor padrão sugerido é o saldo restante (R$ 100,00), acima do limite de R$ 50,00.
    expect(await screen.findByText(/Valor acima do limite disponível/)).toBeInTheDocument();

    await usuario.type(screen.getByDisplayValue('100,00'), '{Enter}');
    // Pagamento não é aceito: continua faltando o total inteiro.
    expect(await screen.findByText(/Falta R\$ 100,00/)).toBeInTheDocument();
  });
});
