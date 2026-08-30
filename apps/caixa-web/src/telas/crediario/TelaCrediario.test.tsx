import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { TelaCrediario } from './TelaCrediario.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <TelaCrediario />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSessao.setState({
    token: 'token-operador',
    operador: { id: 'op-1', nome: 'Ana', papel: 'OPERADOR', limiteDescontoBps: 500 },
    terminalId: 'terminal-1',
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockRotas(config: { sessaoAberta?: boolean; crediario?: unknown } = {}) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/sessoes-caixa/aberta')) {
      return config.sessaoAberta === false
        ? ({ ok: false, status: 404, json: async () => ({ codigo: 'SESSAO_INEXISTENTE' }) } as Response)
        : ({
            ok: true,
            json: async () => ({
              id: 'sessao-1',
              terminalId: 'terminal-1',
              fundoTrocoCentavos: 10000,
              abertaEm: '2026-08-30T12:00:00Z',
              saldoEsperadoCentavos: 10000,
            }),
          } as Response);
    }
    if (url.includes('/clientes?busca=')) {
      return {
        ok: true,
        json: async () => ({ itens: [{ id: 'cli-1', nome: 'Maria Compradora', cpf: null, telefone: null, ativo: true, limiteCrediarioCentavos: 30000 }] }),
      } as Response;
    }
    if (url.includes('/crediario')) {
      return { ok: true, json: async () => config.crediario } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe('TelaCrediario', () => {
  it('busca cliente, mostra parcelas em aberto e limite disponível', async () => {
    const usuario = userEvent.setup();
    mockRotas({
      crediario: {
        clienteId: 'cli-1',
        limiteCrediarioCentavos: 30000,
        emAbertoCentavos: 20000,
        limiteDisponivelCentavos: 10000,
        parcelas: [
          { id: 'parcela-1', tituloId: 't-1', vendaId: 'v-1', numero: 1, valorCentavos: 10000, vencimento: '2026-09-30T00:00:00Z', status: 'ABERTA' },
        ],
      },
    });
    renderizar();

    await usuario.type(screen.getByPlaceholderText('Nome ou CPF do cliente…'), 'Maria');
    await usuario.click(await screen.findByText('Maria Compradora'));

    // "R$ 100,00" aparece duas vezes: limite disponível e valor da parcela.
    expect(await screen.findAllByText('R$ 100,00')).toHaveLength(2);
    expect(screen.getByText('Parcela 1')).toBeInTheDocument();
  });

  it('desabilita "Receber" quando não há caixa aberto', async () => {
    const usuario = userEvent.setup();
    mockRotas({
      sessaoAberta: false,
      crediario: {
        clienteId: 'cli-1',
        limiteCrediarioCentavos: 30000,
        emAbertoCentavos: 10000,
        limiteDisponivelCentavos: 20000,
        parcelas: [
          { id: 'parcela-1', tituloId: 't-1', vendaId: 'v-1', numero: 1, valorCentavos: 10000, vencimento: '2026-09-30T00:00:00Z', status: 'ABERTA' },
        ],
      },
    });
    renderizar();

    await usuario.type(screen.getByPlaceholderText('Nome ou CPF do cliente…'), 'Maria');
    await usuario.click(await screen.findByText('Maria Compradora'));

    expect(await screen.findByRole('button', { name: 'Receber' })).toBeDisabled();
  });
});
