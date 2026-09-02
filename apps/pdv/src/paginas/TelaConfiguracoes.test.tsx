import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clienteApi,
  type ConfiguracaoLoja,
  type Operador,
  type UsuarioAdmin,
} from '../api/cliente.js';
import { useSessao } from '../estado/sessaoStore.js';
import { limparCacheWebgl } from '../tres/capacidade.js';
import { TelaConfiguracoes } from './TelaConfiguracoes.js';

const GERENTE: Operador = {
  id: 'u-gerente',
  nome: 'Marta Gerente',
  papel: 'GERENTE',
  limiteDescontoBps: 2000,
};

const OPERADORA: Operador = {
  id: 'u-operadora',
  nome: 'Ana Operadora',
  papel: 'OPERADOR',
  limiteDescontoBps: 500,
};

const LOJA: ConfiguracaoLoja = {
  id: 'loja',
  nome: 'Boutique Íris',
  endereco: 'Rua das Flores, 120',
  telefone: '(11) 4002-8922',
  cnpj: '12.345.678/0001-90',
  politicaTrocaExtra: null,
};

function usuario(parcial: Partial<UsuarioAdmin> = {}): UsuarioAdmin {
  return {
    id: 'u-1',
    nome: 'Ana Souza',
    login: 'ana',
    papel: 'OPERADOR',
    limiteDescontoBps: 500,
    ativo: true,
    criadoEm: '2026-01-10T12:00:00.000Z',
    ...parcial,
  };
}

const EQUIPE = [
  usuario({
    id: 'u-gerente',
    nome: 'Marta Gerente',
    login: 'marta',
    papel: 'GERENTE',
  }),
  usuario(),
  usuario({ id: 'u-2', nome: 'Bia Antiga', login: 'bia', ativo: false }),
];

function entrarComo(operadora: Operador) {
  useSessao.setState({ operadora });
}

beforeEach(() => {
  entrarComo(GERENTE);
  localStorage.clear();
  /*
   * jsdom não tem WebGL, e sem isto o interruptor 3D nasceria desabilitado —
   * o teste passaria por não haver o que clicar, que é o pior tipo de verde.
   */
  limparCacheWebgl();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as unknown as RenderingContext,
  );
  document.documentElement.dataset.theme = 'light';
  vi.spyOn(clienteApi, 'obterConfiguracaoLoja').mockResolvedValue(LOJA);
  vi.spyOn(clienteApi, 'salvarConfiguracaoLoja').mockImplementation(async (dados) => ({
    ...LOJA,
    ...dados,
    endereco: dados.endereco ?? null,
    telefone: dados.telefone ?? null,
    cnpj: dados.cnpj ?? null,
    politicaTrocaExtra: dados.politicaTrocaExtra ?? null,
  }));
  vi.spyOn(clienteApi, 'listarUsuarios').mockResolvedValue(EQUIPE);
});

afterEach(() => {
  vi.restoreAllMocks();
  limparCacheWebgl();
  useSessao.setState({ operadora: null });
});

describe('quem vê o quê', () => {
  it('gerente vê os usuários', async () => {
    render(<TelaConfiguracoes />);
    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeVisible();
  });

  it('operadora NÃO vê a lista de usuários', async () => {
    entrarComo(OPERADORA);
    render(<TelaConfiguracoes />);

    // Espera a tela terminar de carregar antes de afirmar ausência, senão o
    // teste passaria só por chegar cedo demais.
    expect(await screen.findByDisplayValue('Boutique Íris')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Usuários' })).not.toBeInTheDocument();
    expect(clienteApi.listarUsuarios).not.toHaveBeenCalled();
  });

  it('operadora vê os dados da loja, mas em somente leitura', async () => {
    entrarComo(OPERADORA);
    render(<TelaConfiguracoes />);

    expect(await screen.findByDisplayValue('Boutique Íris')).toBeDisabled();
    expect(screen.getByText('Somente leitura')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Salvar dados da loja/ })).not.toBeInTheDocument();
  });
});

describe('preferências deste computador', () => {
  it('liga o tema escuro e aplica na hora', async () => {
    render(<TelaConfiguracoes />);
    const interruptor = screen.getByRole('switch', { name: 'Tema escuro' });
    expect(interruptor).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(interruptor);

    expect(interruptor).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('guarda a escolha do 3D', async () => {
    // `reload` não existe em jsdom; o que importa aqui é a preferência salva.
    const recarregar = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: recarregar },
      configurable: true,
    });

    render(<TelaConfiguracoes />);
    await userEvent.click(screen.getByRole('switch', { name: 'Efeitos 3D' }));

    expect(localStorage.getItem('pdv.efeitos3d')).toBe('off');
    expect(recarregar).toHaveBeenCalled();
  });
});

describe('dados da loja', () => {
  it('carrega o que está cadastrado', async () => {
    render(<TelaConfiguracoes />);

    expect(await screen.findByDisplayValue('Boutique Íris')).toBeVisible();
    expect(screen.getByDisplayValue('Rua das Flores, 120')).toBeVisible();
    expect(screen.getByDisplayValue('12.345.678/0001-90')).toBeVisible();
  });

  it('salva e já deixa o comprovante com o nome novo', async () => {
    render(<TelaConfiguracoes />);
    const nome = await screen.findByDisplayValue('Boutique Íris');

    await userEvent.clear(nome);
    await userEvent.type(nome, 'Íris Lingerie');
    await userEvent.click(screen.getByRole('button', { name: /Salvar dados da loja/ }));

    await waitFor(() => expect(screen.getByText('Salvo.')).toBeVisible());
    expect(clienteApi.salvarConfiguracaoLoja).toHaveBeenCalledWith(
      expect.objectContaining({ nome: 'Íris Lingerie' }),
    );
    // A cópia local é o que o comprovante lê offline: precisa estar atualizada
    // sem esperar a próxima abertura do sistema.
    expect(JSON.parse(localStorage.getItem('pdv.loja') ?? '{}').nome).toBe('Íris Lingerie');
  });

  it('recusa nome em branco, que viraria comprovante sem cabeçalho', async () => {
    render(<TelaConfiguracoes />);
    await userEvent.clear(await screen.findByDisplayValue('Boutique Íris'));
    await userEvent.click(screen.getByRole('button', { name: /Salvar dados da loja/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/não pode ficar em branco/);
    expect(clienteApi.salvarConfiguracaoLoja).not.toHaveBeenCalled();
  });

  it('avisa que a linha extra soma ao texto legal, não substitui', async () => {
    render(<TelaConfiguracoes />);
    expect(await screen.findByText(/garantida por lei/)).toBeVisible();
  });
});

describe('usuários', () => {
  it('lista ativos e inativos, com papel e alçada', async () => {
    render(<TelaConfiguracoes />);

    expect(await screen.findByTestId('resumo-ana')).toHaveTextContent(
      'ana · Operador · desconto 5%',
    );

    expect(within(screen.getByTestId('usuario-bia')).getByText('Inativo')).toBeVisible();
  });

  it('mostra "sem alçada" em vez de 0%', async () => {
    vi.spyOn(clienteApi, 'listarUsuarios').mockResolvedValue([
      usuario({ limiteDescontoBps: 0 }),
      EQUIPE[0]!,
    ]);
    render(<TelaConfiguracoes />);

    expect(await screen.findByText(/sem alçada/)).toBeVisible();
  });

  it('cria usuário normalizando o login', async () => {
    const criar = vi.spyOn(clienteApi, 'criarUsuario').mockResolvedValue(usuario({ id: 'novo' }));
    render(<TelaConfiguracoes />);

    await userEvent.click(await screen.findByRole('button', { name: 'Novo usuário' }));
    const formulario = within(screen.getByTestId('form-novo-usuario'));
    await userEvent.type(formulario.getByLabelText('Nome'), 'Conceição Souza');
    await userEvent.type(formulario.getByLabelText('Login'), '  Conceição ');
    await userEvent.type(formulario.getByLabelText('Senha'), 'segredo1');
    await userEvent.type(formulario.getByLabelText('Limite de desconto (%)'), '5');
    await userEvent.click(formulario.getByRole('button', { name: 'Criar usuário' }));

    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith({
        nome: 'Conceição Souza',
        login: 'conceicao',
        senha: 'segredo1',
        papel: 'OPERADOR',
        limiteDescontoBps: 500,
      }),
    );
  });

  it('não chama a API com formulário inválido', async () => {
    const criar = vi.spyOn(clienteApi, 'criarUsuario');
    render(<TelaConfiguracoes />);

    await userEvent.click(await screen.findByRole('button', { name: 'Novo usuário' }));
    const formulario = within(screen.getByTestId('form-novo-usuario'));
    await userEvent.type(formulario.getByLabelText('Nome'), 'Ana');
    await userEvent.type(formulario.getByLabelText('Login'), 'ana2');
    await userEvent.type(formulario.getByLabelText('Senha'), '123');
    await userEvent.click(formulario.getByRole('button', { name: 'Criar usuário' }));

    expect(await screen.findByText(/pelo menos 6 caracteres/)).toBeVisible();
    expect(criar).not.toHaveBeenCalled();
  });

  it('explica o que cada papel pode, antes de escolher', async () => {
    render(<TelaConfiguracoes />);
    await userEvent.click(await screen.findByRole('button', { name: 'Novo usuário' }));

    expect(screen.getByText(/autoriza sangria, devolução/)).toBeVisible();
  });

  it('desativa um usuário e recarrega a lista', async () => {
    const atualizar = vi
      .spyOn(clienteApi, 'atualizarUsuario')
      .mockResolvedValue(usuario({ ativo: false }));
    render(<TelaConfiguracoes />);

    const linha = await screen.findByTestId('usuario-ana');
    await userEvent.click(within(linha).getByRole('button', { name: 'Desativar' }));

    await waitFor(() => expect(atualizar).toHaveBeenCalledWith('u-1', { ativo: false }));
    expect(clienteApi.listarUsuarios).toHaveBeenCalledTimes(2);
  });

  it('não deixa o gerente se desativar nem mudar o próprio papel', async () => {
    render(<TelaConfiguracoes />);

    const minhaLinha = await screen.findByTestId('usuario-marta');
    expect(within(minhaLinha).getByRole('button', { name: 'Desativar' })).toBeDisabled();

    await userEvent.click(within(minhaLinha).getByRole('button', { name: 'Editar' }));
    expect(await screen.findByText(/não pode mudar o próprio papel/)).toBeVisible();
  });

  it('repassa a recusa do servidor em vez de engolir', async () => {
    vi.spyOn(clienteApi, 'atualizarUsuario').mockRejectedValue(
      new Error('Este é o último gerente ativo.'),
    );
    render(<TelaConfiguracoes />);

    const linha = await screen.findByTestId('usuario-ana');
    await userEvent.click(within(linha).getByRole('button', { name: 'Desativar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('último gerente ativo');
  });

  it('troca a senha numa chamada separada, só quando preenchida', async () => {
    vi.spyOn(clienteApi, 'atualizarUsuario').mockResolvedValue(usuario());
    const trocar = vi.spyOn(clienteApi, 'trocarSenhaDe').mockResolvedValue({ id: 'u-1' });
    render(<TelaConfiguracoes />);

    const linha = await screen.findByTestId('usuario-ana');
    await userEvent.click(within(linha).getByRole('button', { name: 'Editar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(clienteApi.atualizarUsuario).toHaveBeenCalled());
    expect(trocar).not.toHaveBeenCalled();
  });
});
