import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalCliente } from './ModalCliente.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoVincular = vi.fn();
  const aoFechar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <ModalCliente aoVincular={aoVincular} aoFechar={aoFechar} />
    </QueryClientProvider>,
  );
  return { aoVincular, aoFechar };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModalCliente', () => {
  it('vincula um cliente encontrado na busca', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        itens: [{ id: 'cli-1', nome: 'Maria Compradora', cpf: null, telefone: null, ativo: true, limiteCrediarioCentavos: 30000 }],
      }),
    } as Response);
    const { aoVincular } = renderizar();

    await usuario.type(screen.getByPlaceholderText('Nome ou CPF…'), 'Maria');
    await usuario.click(await screen.findByText('Maria Compradora'));

    expect(aoVincular).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cli-1', nome: 'Maria Compradora' }),
    );
  });

  it('cadastra um cliente novo e vincula na hora', async () => {
    const usuario = userEvent.setup();
    const { aoVincular } = renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Cadastrar novo' }));
    await usuario.type(screen.getByLabelText('Nome'), 'João Novo');
    await usuario.type(screen.getByLabelText('Limite de crediário (R$)'), '300,00');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cli-2' }) } as Response);
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar e vincular' }));

    await vi.waitFor(() =>
      expect(aoVincular).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cli-2', nome: 'João Novo', limiteCrediarioCentavos: 30000 }),
      ),
    );

    const [, opcoes] = vi.mocked(fetch).mock.calls[0]!;
    const corpo = JSON.parse(opcoes!.body as string);
    expect(corpo).toMatchObject({ nome: 'João Novo', limiteCrediarioCentavos: 30000 });
  });
});
