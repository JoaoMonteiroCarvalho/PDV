import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { TelaLogin } from './TelaLogin.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <TelaLogin />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSessao.setState({ token: null, operador: null, terminalId: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('TelaLogin', () => {
  it('foca o campo de código automaticamente', () => {
    renderizar();
    expect(screen.getByLabelText('Código do operador')).toHaveFocus();
  });

  it('Enter no código move o foco para a senha, sem enviar o formulário', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText('Código do operador'), 'ana{Enter}');

    expect(screen.getByLabelText('Senha')).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('mostra erro de validação ao enviar vazio, sem chamar a API', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Informe o código do operador')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('login bem-sucedido guarda token e operador na sessão', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: 'token-de-teste',
        operador: { id: '1', nome: 'Ana Souza', papel: 'OPERADOR', limiteDescontoBps: 500 },
      }),
    } as Response);

    renderizar();
    await usuario.type(screen.getByLabelText('Código do operador'), 'ana');
    await usuario.type(screen.getByLabelText('Senha'), 'caixa123');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(useSessao.getState().token).toBe('token-de-teste');
      expect(useSessao.getState().operador?.nome).toBe('Ana Souza');
    });
  });

  it('credencial inválida mostra a mensagem que veio da API, não um erro genérico', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'Login ou senha incorretos.' }),
    } as Response);

    renderizar();
    await usuario.type(screen.getByLabelText('Código do operador'), 'ana');
    await usuario.type(screen.getByLabelText('Senha'), 'errada');
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Login ou senha incorretos.');
    // A sessão não deve ter sido tocada numa tentativa que falhou.
    expect(useSessao.getState().token).toBeNull();
  });
});
