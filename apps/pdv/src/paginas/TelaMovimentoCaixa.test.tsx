import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteApi, type Operador } from '../api/cliente.js';
import { useCaixa } from '../estado/caixaStore.js';
import { TelaMovimentoCaixa } from './TelaMovimentoCaixa.js';

const SESSAO = {
  id: 'sessao-1',
  terminalId: 't1',
  fundoTrocoCentavos: 20_000,
  abertaEm: '2026-09-01T09:00:00.000Z',
  saldoEsperadoCentavos: 50_000,
};

const GERENTE: Operador = {
  id: 'ger-1',
  nome: 'Bia Martins',
  papel: 'GERENTE',
  limiteDescontoBps: 3_000,
};

const OPERADORA: Operador = {
  id: 'op-1',
  nome: 'Ana Souza',
  papel: 'OPERADOR',
  limiteDescontoBps: 500,
};

function montar() {
  return render(
    <MemoryRouter initialEntries={['/caixa/movimento']}>
      <Routes>
        <Route path="/caixa/movimento" element={<TelaMovimentoCaixa />} />
        <Route path="/caixa" element={<p>tela do caixa</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function autorizarComo(operador: Operador) {
  vi.spyOn(clienteApi, 'entrarSemTrocarSessao').mockResolvedValue({ operador });
  await userEvent.type(screen.getByLabelText('Gerente'), 'bia');
  await userEvent.type(screen.getByLabelText('Senha'), 'gerente123');
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar' }));
}

async function digitarValor(digitos: string) {
  await userEvent.click(screen.getByLabelText(/Valor (retirado|colocado)/));
  await userEvent.keyboard(digitos);
}

beforeEach(() => {
  useCaixa.setState({ sessao: SESSAO, jaConsultou: true, erro: null, carregando: false });
  vi.spyOn(useCaixa.getState(), 'sincronizar').mockResolvedValue(SESSAO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TelaMovimentoCaixa — autorização', () => {
  it('sem gerente, nada é registrado — nem valor pequeno', async () => {
    /*
     * Sangria e suprimento não têm alçada de operador, ao contrário do
     * desconto. Uma exceção "só para valor baixo" seria a brecha exata que a
     * auditoria existe para cobrir.
     */
    montar();
    await digitarValor('100');
    await userEvent.type(screen.getByLabelText(/Para onde foi/), 'Cofre da loja');

    expect(screen.getByRole('button', { name: 'Registrar sangria' })).toBeDisabled();
    expect(screen.getByText(/exigem gerente identificada, sem exceção de valor/)).toBeVisible();
  });

  it('operadora com senha certa não autoriza, e a tela diz por quê', async () => {
    // Mais útil que "credenciais inválidas", e não vaza nada que ela não saiba.
    montar();
    await autorizarComo(OPERADORA);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem perfil de gerente/),
    );
    expect(screen.queryByText('Autorizado')).not.toBeInTheDocument();
  });

  it('autentica a gerente SEM derrubar a sessão da operadora', async () => {
    const semTrocar = vi
      .spyOn(clienteApi, 'entrarSemTrocarSessao')
      .mockResolvedValue({ operador: GERENTE });
    const entrar = vi.spyOn(clienteApi, 'entrar');
    montar();

    await userEvent.type(screen.getByLabelText('Gerente'), 'bia');
    await userEvent.type(screen.getByLabelText('Senha'), 'gerente123');
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar' }));

    await waitFor(() => expect(screen.getByText('Autorizado')).toBeVisible());
    expect(semTrocar).toHaveBeenCalledWith('bia', 'gerente123');
    // `entrar` trocaria o token e deslogaria a operadora no meio do expediente.
    expect(entrar).not.toHaveBeenCalled();
  });

  it('credencial errada aparece no formulário, não numa tela em branco', async () => {
    vi.spyOn(clienteApi, 'entrarSemTrocarSessao').mockRejectedValue(
      new Error('Login ou senha incorretos.'),
    );
    montar();

    await userEvent.type(screen.getByLabelText('Gerente'), 'bia');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Autorizar' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Login ou senha incorretos.'),
    );
  });
});

describe('TelaMovimentoCaixa — o saldo só aparece para a gerente', () => {
  it('a operadora sozinha não vê o dinheiro da gaveta', () => {
    /*
     * Contrapartida da conferência às cegas do fechamento: o número existe e é
     * útil, mas não pode ficar na tela da operadora, a um clique do botão de
     * fechar o caixa.
     */
    montar();

    expect(screen.queryByTestId('efeito-no-caixa')).not.toBeInTheDocument();
    expect(screen.queryByText('R$ 500,00')).not.toBeInTheDocument();
  });

  it('depois da autorização, mostra o que entra, o que sai e o que fica', async () => {
    montar();
    await autorizarComo(GERENTE);
    await waitFor(() => expect(screen.getByText('Autorizado')).toBeVisible());

    await digitarValor('15000');

    const efeito = screen.getByTestId('efeito-no-caixa');
    expect(efeito).toHaveTextContent('R$ 500,00'); // na gaveta agora
    expect(efeito).toHaveTextContent('R$ 150,00'); // sai
    expect(efeito).toHaveTextContent('R$ 350,00'); // fica com
  });

  it('suprimento soma em vez de subtrair', async () => {
    montar();
    await autorizarComo(GERENTE);
    await waitFor(() => expect(screen.getByText('Autorizado')).toBeVisible());

    await userEvent.click(screen.getByRole('button', { name: /Suprimento/ }));
    await digitarValor('10000');

    expect(screen.getByTestId('efeito-no-caixa')).toHaveTextContent('R$ 600,00');
  });
});

describe('TelaMovimentoCaixa — regras do movimento', () => {
  it('sangria sem justificativa não passa', async () => {
    montar();
    await autorizarComo(GERENTE);
    await waitFor(() => expect(screen.getByText('Autorizado')).toBeVisible());
    await digitarValor('10000');

    expect(screen.getByText(/para onde o dinheiro foi/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Registrar sangria' })).toBeDisabled();
  });

  it('suprimento não exige justificativa', async () => {
    // Dinheiro entrando não tem o risco de desvio que a saída tem.
    montar();
    await autorizarComo(GERENTE);
    await waitFor(() => expect(screen.getByText('Autorizado')).toBeVisible());

    await userEvent.click(screen.getByRole('button', { name: /Suprimento/ }));
    await digitarValor('10000');

    expect(screen.getByRole('button', { name: 'Registrar suprimento' })).toBeEnabled();
  });

  it('não deixa tirar mais do que a gaveta tem', async () => {
    montar();
    await autorizarComo(GERENTE);
    await waitFor(() => expect(screen.getByText('Autorizado')).toBeVisible());

    await digitarValor('60000'); // R$ 600 numa gaveta de R$ 500
    await userEvent.type(screen.getByLabelText(/Para onde foi/), 'Cofre da loja');

    expect(screen.getByText(/maior do que o dinheiro que a gaveta tem/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Registrar sangria' })).toBeDisabled();
  });
});

describe('TelaMovimentoCaixa — registro', () => {
  async function preencherSangriaValida() {
    montar();
    await autorizarComo(GERENTE);
    await waitFor(() => expect(screen.getByText('Autorizado')).toBeVisible());
    await digitarValor('10000');
    await userEvent.type(screen.getByLabelText(/Para onde foi/), 'Cofre da loja');
  }

  it('envia tipo, valor, justificativa e quem autorizou', async () => {
    const registrar = vi
      .spyOn(clienteApi, 'registrarMovimentoCaixa')
      .mockResolvedValue({ id: 'mov-1' });
    await preencherSangriaValida();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar sangria' }));

    await waitFor(() => expect(registrar).toHaveBeenCalledTimes(1));
    expect(registrar).toHaveBeenCalledWith('sessao-1', {
      tipo: 'SANGRIA',
      valorCentavos: 10_000,
      observacao: 'Cofre da loja',
      autorizadoPorId: 'ger-1',
    });
  });

  it('resincroniza o caixa: o saldo mudou', async () => {
    vi.spyOn(clienteApi, 'registrarMovimentoCaixa').mockResolvedValue({ id: 'mov-1' });
    const sincronizar = vi.spyOn(useCaixa.getState(), 'sincronizar').mockResolvedValue(SESSAO);
    await preencherSangriaValida();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar sangria' }));

    // Sem isto, um segundo movimento seria validado contra um número velho.
    await waitFor(() => expect(sincronizar).toHaveBeenCalled());
  });

  it('confirma o registro e oferece fazer outro', async () => {
    vi.spyOn(clienteApi, 'registrarMovimentoCaixa').mockResolvedValue({ id: 'mov-1' });
    await preencherSangriaValida();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar sangria' }));

    await waitFor(() => expect(screen.getByText('Sangria registrada')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Outro movimento' })).toBeVisible();
  });

  it('recusa do servidor aparece na tela e não finge sucesso', async () => {
    vi.spyOn(clienteApi, 'registrarMovimentoCaixa').mockRejectedValue(
      new Error('Quem autorizou não tem perfil de gerente.'),
    );
    await preencherSangriaValida();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar sangria' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem perfil de gerente/),
    );
    expect(screen.queryByText('Sangria registrada')).not.toBeInTheDocument();
  });
});

describe('TelaMovimentoCaixa — sem caixa aberto', () => {
  it('explica em vez de mostrar formulário vazio', () => {
    useCaixa.setState({ sessao: null, jaConsultou: true });
    montar();

    expect(screen.getByText('Não há caixa aberto')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Registrar sangria' })).not.toBeInTheDocument();
  });
});
