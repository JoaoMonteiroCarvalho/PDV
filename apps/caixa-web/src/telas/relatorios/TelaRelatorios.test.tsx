import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { TelaRelatorios } from './TelaRelatorios.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <TelaRelatorios />
    </QueryClientProvider>,
  );
}

const resumo = {
  periodo: { desde: '2026-08-01T00:00:00Z', ate: '2026-08-30T00:00:00Z' },
  quantidadeVendas: 2,
  totalVendidoCentavos: 20000,
  totalDevolvidoCentavos: 5000,
  totalLiquidoCentavos: 15000,
  ticketMedioCentavos: 10000,
  totalItensVendidos: 3,
  quantidadeDevolucoes: 1,
  porDia: [{ data: '2026-08-30', quantidadeVendas: 2, totalCentavos: 20000 }],
  porFormaPagamento: [{ forma: 'DINHEIRO', quantidade: 2, totalCentavos: 20000 }],
  porOperador: [{ operadorId: 'op-1', nome: 'Ana', quantidadeVendas: 2, totalCentavos: 20000, ticketMedioCentavos: 10000 }],
  produtosMaisVendidos: [
    { varianteId: 'v-1', descricao: 'Conjunto Renda Delicada', sku: 'CJ-REN-P-PRETO', quantidadeVendida: 2, totalCentavos: 17980 },
  ],
  devolucoesPorFormaEstorno: [{ formaEstorno: 'PIX', quantidade: 1, valorCentavos: 5000 }],
};

beforeEach(() => {
  useSessao.setState({ token: 'token-operador', operador: { id: 'op-1', nome: 'Ana', papel: 'OPERADOR', limiteDescontoBps: 500 }, terminalId: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelaRelatorios', () => {
  it('mostra os totais do resumo e as agregações por forma/operador/produto', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operadores')) {
        return { ok: true, json: async () => ({ operadores: [{ id: 'op-1', nome: 'Ana' }] }) } as Response;
      }
      return { ok: true, json: async () => resumo } as Response;
    });
    renderizar();

    expect(await screen.findAllByText('R$ 200,00')).toHaveLength(2); // card "Vendido" + linha "Por dia"
    expect(screen.getAllByText('R$ 50,00')).toHaveLength(2); // card "Devolvido" + linha "Pix"
    expect(screen.getByText('R$ 150,00')).toBeInTheDocument(); // líquido
    expect(screen.getByText(/Dinheiro \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ana \(2 vendas\)/)).toBeInTheDocument();
    expect(screen.getByText(/Conjunto Renda Delicada/)).toBeInTheDocument();
    expect(screen.getByText(/Pix \(1\)/)).toBeInTheDocument();
  });
});
