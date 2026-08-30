import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { ModalMovimentoCaixa } from './ModalMovimentoCaixa.js';

function renderizar(tipo: 'SANGRIA' | 'SUPRIMENTO' = 'SANGRIA') {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoConcluir = vi.fn();
  const aoFechar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <ModalMovimentoCaixa sessaoCaixaId="sessao-1" tipo={tipo} aoConcluir={aoConcluir} aoFechar={aoFechar} />
    </QueryClientProvider>,
  );
  return { aoConcluir, aoFechar };
}

function mockLoginGerente() {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      token: 'token-gerente',
      operador: { id: 'gerente-1', nome: 'Bia Martins', papel: 'GERENTE', limiteDescontoBps: 3000 },
    }),
  } as Response);
}

beforeEach(() => {
  useSessao.setState({ token: 'token-operador', operador: { id: 'op-1', nome: 'Ana', papel: 'OPERADOR', limiteDescontoBps: 500 }, terminalId: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModalMovimentoCaixa', () => {
  it('exige valor e motivo antes de deixar continuar', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Informe o valor')).toBeInTheDocument();
    expect(screen.getByText('Descreva o motivo (mínimo 3 caracteres)')).toBeInTheDocument();
  });

  it('rejeita valor zero — sangria de R$ 0,00 não faz sentido', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/Valor \(R\$\)/), '0,00');
    await usuario.type(screen.getByLabelText('Motivo'), 'Depósito no banco');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('O valor precisa ser maior que zero')).toBeInTheDocument();
  });

  it('não existe piso de isenção — mesmo valor pequeno pede autorização de gerente', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/Valor \(R\$\)/), '1,00');
    await usuario.type(screen.getByLabelText('Motivo'), 'Troco pra cliente');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Autorizar sangria')).toBeInTheDocument();
    expect(screen.getByText(/Sangria de R\$ 1,00 — Troco pra cliente/)).toBeInTheDocument();
  });

  it('a tela de autorização mostra o valor e o motivo exatos, não um "tem certeza?" genérico', async () => {
    const usuario = userEvent.setup();
    renderizar('SUPRIMENTO');

    await usuario.type(screen.getByLabelText(/Valor \(R\$\)/), '200,00');
    await usuario.type(screen.getByLabelText('Motivo'), 'Reforço de troco da manhã');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Autorizar suprimento')).toBeInTheDocument();
    expect(screen.getByText(/Suprimento de R\$ 200,00 — Reforço de troco da manhã/)).toBeInTheDocument();
  });

  it('autorização de gerente NÃO troca a sessão do operador que está atendendo', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/Valor \(R\$\)/), '50,00');
    await usuario.type(screen.getByLabelText('Motivo'), 'Depósito no banco');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    mockLoginGerente();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'mov-1' }) } as Response);

    await usuario.type(screen.getByLabelText('Código do gerente'), 'bia');
    await usuario.type(screen.getByLabelText('Senha'), 'gerente123');
    await usuario.click(screen.getByRole('button', { name: 'Autorizar' }));

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2); // login do gerente + POST do movimento
    });
    // A sessão continua sendo a da operadora — o gerente só autorizou.
    expect(useSessao.getState().operador?.nome).toBe('Ana');
  });

  it('login sem papel de gerente é recusado antes mesmo de tentar gravar o movimento', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/Valor \(R\$\)/), '50,00');
    await usuario.type(screen.getByLabelText('Motivo'), 'Depósito no banco');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: 'token-outro-operador',
        operador: { id: 'op-2', nome: 'Carla', papel: 'OPERADOR', limiteDescontoBps: 500 },
      }),
    } as Response);

    await usuario.type(screen.getByLabelText('Código do gerente'), 'carla');
    await usuario.type(screen.getByLabelText('Senha'), 'caixa123');
    await usuario.click(screen.getByRole('button', { name: 'Autorizar' }));

    expect(await screen.findByText('Este login não tem permissão de gerente.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1); // só o login — o movimento nunca foi enviado
  });

  it('envia o movimento concluído com o id de quem autorizou, e chama aoConcluir', async () => {
    const usuario = userEvent.setup();
    const { aoConcluir } = renderizar();

    await usuario.type(screen.getByLabelText(/Valor \(R\$\)/), '50,00');
    await usuario.type(screen.getByLabelText('Motivo'), 'Depósito no banco');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    mockLoginGerente();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'mov-1' }) } as Response);

    await usuario.type(screen.getByLabelText('Código do gerente'), 'bia');
    await usuario.type(screen.getByLabelText('Senha'), 'gerente123');
    await usuario.click(screen.getByRole('button', { name: 'Autorizar' }));

    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalled());

    const [, opcoesMovimento] = vi.mocked(fetch).mock.calls[1]!;
    const corpo = JSON.parse(opcoesMovimento!.body as string);
    expect(corpo).toMatchObject({
      tipo: 'SANGRIA',
      valorCentavos: 5000,
      observacao: 'Depósito no banco',
      autorizadoPorId: 'gerente-1',
    });
  });
});
