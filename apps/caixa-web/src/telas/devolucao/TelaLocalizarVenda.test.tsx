import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { TelaLocalizarVenda } from './TelaLocalizarVenda.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoEncontrar = vi.fn();
  const aoVoltar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <TelaLocalizarVenda aoEncontrar={aoEncontrar} aoVoltar={aoVoltar} />
    </QueryClientProvider>,
  );
  return { aoEncontrar, aoVoltar };
}

beforeEach(() => {
  useSessao.setState({ token: 'token-operador', operador: { id: 'op-1', nome: 'Ana', papel: 'OPERADOR', limiteDescontoBps: 500 }, terminalId: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelaLocalizarVenda', () => {
  it('busca por número quando o valor é só dígitos', async () => {
    const usuario = userEvent.setup();
    const { aoEncontrar } = renderizar();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'venda-1', numero: 42, totalCentavos: 15000, registradaEm: '2026-08-30T12:00:00Z' }),
    } as Response);

    await usuario.type(screen.getByLabelText('Número ou código'), '42');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));

    await vi.waitFor(() => expect(aoEncontrar).toHaveBeenCalledWith({ id: 'venda-1', numero: 42, totalCentavos: 15000, registradaEm: '2026-08-30T12:00:00Z' }));
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/vendas/por-numero/42');
  });

  it('busca por código quando o valor não é só dígitos', async () => {
    const usuario = userEvent.setup();
    renderizar();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'venda-1', numero: 42, totalCentavos: 15000, registradaEm: '2026-08-30T12:00:00Z' }),
    } as Response);

    await usuario.type(screen.getByLabelText('Número ou código'), 'ABC12345');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/vendas/por-codigo/abc12345');
  });

  it('mostra o erro exato que veio da API quando a venda não existe', async () => {
    const usuario = userEvent.setup();
    renderizar();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ codigo: 'VENDA_INEXISTENTE', mensagem: 'Venda não encontrada.' }),
    } as Response);

    await usuario.type(screen.getByLabelText('Número ou código'), '999');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Venda não encontrada.')).toBeInTheDocument();
  });
});
