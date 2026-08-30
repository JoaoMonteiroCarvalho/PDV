import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelaEquipe } from './TelaEquipe.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <TelaEquipe />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockLista(operadores: unknown[]) {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ operadores }) } as Response);
}

describe('TelaEquipe', () => {
  it('lista operadores com papel e sinaliza inativo', async () => {
    mockLista([
      { id: 'op-1', nome: 'Ana', login: 'ana', papel: 'OPERADOR', limiteDescontoBps: 500, ativo: true },
      { id: 'op-2', nome: 'Bia', login: 'bia', papel: 'GERENTE', limiteDescontoBps: 3000, ativo: false },
    ]);
    renderizar();

    expect(await screen.findByText(/Ana/)).toBeInTheDocument();
    expect(screen.getByText(/· ana/)).toBeInTheDocument();
    expect(screen.getByText('Operador')).toBeInTheDocument();
    expect(screen.getByText('Gerente')).toBeInTheDocument();
    expect(screen.getByText('inativo')).toBeInTheDocument();
  });

  it('cadastra um novo operador', async () => {
    const usuario = userEvent.setup();
    mockLista([]);
    renderizar();

    await screen.findByRole('checkbox', { name: 'Mostrar inativos' });
    await usuario.click(screen.getByRole('button', { name: 'Novo operador' }));

    await usuario.type(screen.getByLabelText('Nome'), 'Carla Nova');
    await usuario.type(screen.getByLabelText('Login'), 'carla');
    await usuario.type(screen.getByLabelText('Senha'), 'senha123');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'op-3' }) } as Response);
    await usuario.click(screen.getByRole('button', { name: 'Criar' }));

    await vi.waitFor(() => {
      const chamada = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/operadores');
      expect(chamada).toBeDefined();
    });
    const chamadaCriar = vi.mocked(fetch).mock.calls.find(
      ([url, opcoes]) => String(url) === '/api/operadores' && (opcoes as RequestInit)?.method === 'POST',
    );
    const corpo = JSON.parse((chamadaCriar![1] as RequestInit).body as string);
    expect(corpo).toMatchObject({ nome: 'Carla Nova', login: 'carla', senha: 'senha123', papel: 'OPERADOR' });
  });

  it('desativa um operador existente', async () => {
    const usuario = userEvent.setup();
    mockLista([{ id: 'op-1', nome: 'Ana', login: 'ana', papel: 'OPERADOR', limiteDescontoBps: 0, ativo: true }]);
    renderizar();

    await usuario.click(await screen.findByRole('button', { name: 'Editar' }));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'op-1' }) } as Response);
    await usuario.click(screen.getByRole('button', { name: 'Desativar' }));

    await vi.waitFor(() => {
      const chamada = vi.mocked(fetch).mock.calls.find(
        ([url, opcoes]) => String(url) === '/api/operadores/op-1' && (opcoes as RequestInit)?.method === 'PATCH',
      );
      expect(chamada).toBeDefined();
    });
    const chamadaPatch = vi.mocked(fetch).mock.calls.find(
      ([url, opcoes]) => String(url) === '/api/operadores/op-1' && (opcoes as RequestInit)?.method === 'PATCH',
    );
    const corpo = JSON.parse((chamadaPatch![1] as RequestInit).body as string);
    expect(corpo).toEqual({ ativo: false });
  });
});
