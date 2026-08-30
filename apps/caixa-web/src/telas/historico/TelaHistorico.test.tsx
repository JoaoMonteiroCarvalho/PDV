import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { TelaHistorico } from './TelaHistorico.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <TelaHistorico />
    </QueryClientProvider>,
  );
}

function linha(numero: number, id = `venda-${numero}`) {
  return {
    id,
    numero,
    registradaEm: '2026-08-30T12:00:00Z',
    criadaEmCliente: '2026-08-30T12:00:00Z',
    operador: { id: 'op-1', nome: 'Ana' },
    totalCentavos: 8990,
    quantidadeItens: 1,
    formasPagamento: ['DINHEIRO'],
    totalDevolvidoCentavos: 0,
  };
}

/** Roteia por URL em vez de depender da ordem das chamadas — a tela dispara
 * `/vendas` e `/operadores` em paralelo, e a ordem não é garantida. */
function mockRotas(paginas: unknown[]) {
  let indicePagina = 0;
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/operadores')) {
      return { ok: true, json: async () => ({ operadores: [{ id: 'op-1', nome: 'Ana' }] }) } as Response;
    }
    if (url.startsWith('/api/vendas/')) {
      return { ok: true, json: async () => paginas[paginas.length - 1] } as Response;
    }
    const pagina = paginas[indicePagina];
    indicePagina += 1;
    return { ok: true, json: async () => pagina } as Response;
  });
}

beforeEach(() => {
  useSessao.setState({ token: 'token-operador', operador: { id: 'op-1', nome: 'Ana', papel: 'OPERADOR', limiteDescontoBps: 500 }, terminalId: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelaHistorico', () => {
  it('lista as vendas e sinaliza a que teve devolução', async () => {
    mockRotas([
      {
        itens: [{ ...linha(10), totalDevolvidoCentavos: 3000 }, linha(9)],
        proximoAntesDe: null,
        proximoUltimoId: null,
        temMais: false,
      },
    ]);
    renderizar();

    expect(await screen.findByText('Venda #10 · Ana')).toBeInTheDocument();
    expect(screen.getByText('Venda #9 · Ana')).toBeInTheDocument();
    expect(screen.getByText('devolução')).toBeInTheDocument();
  });

  it('"Carregar mais" acumula a página seguinte sem perder a anterior', async () => {
    const usuario = userEvent.setup();
    mockRotas([
      {
        itens: [linha(10)],
        proximoAntesDe: '2026-08-30T11:00:00Z',
        proximoUltimoId: 'venda-10',
        temMais: true,
      },
      { itens: [linha(9)], proximoAntesDe: null, proximoUltimoId: null, temMais: false },
    ]);
    renderizar();

    await screen.findByText('Venda #10 · Ana');
    await usuario.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Venda #9 · Ana')).toBeInTheDocument();
    expect(screen.getByText('Venda #10 · Ana')).toBeInTheDocument();

    const chamadaVendas = vi
      .mocked(fetch)
      .mock.calls.map((chamada) => String(chamada[0]))
      .filter((url) => url.includes('antesDe='));
    expect(chamadaVendas[0]).toContain('ultimoId=venda-10');
  });

  it('abre o detalhe da venda ao clicar na linha', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operadores')) {
        return { ok: true, json: async () => ({ operadores: [] }) } as Response;
      }
      if (url.startsWith('/api/vendas/venda-10')) {
        return {
          ok: true,
          json: async () => ({
            id: 'venda-10',
            numero: 10,
            registradaEm: '2026-08-30T12:00:00Z',
            operador: { id: 'op-1', nome: 'Ana' },
            cliente: null,
            subtotalCentavos: 8990,
            descontoCentavos: 0,
            totalCentavos: 8990,
            itens: [
              {
                id: 'item-1',
                descricao: 'Conjunto Renda Delicada',
                sku: 'CJ-REN-P-PRETO',
                tamanho: 'P',
                cor: 'Preto',
                quantidade: 1,
                precoUnitarioCentavos: 8990,
                descontoCentavos: 0,
                totalCentavos: 8990,
              },
            ],
            pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 8990, trocoCentavos: 0 }],
            devolucoes: [],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ itens: [linha(10)], proximoAntesDe: null, proximoUltimoId: null, temMais: false }),
      } as Response;
    });
    renderizar();

    await screen.findByText('Venda #10 · Ana');
    await usuario.click(screen.getByText('Venda #10 · Ana'));

    expect(await screen.findByText(/Conjunto Renda Delicada/, {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
