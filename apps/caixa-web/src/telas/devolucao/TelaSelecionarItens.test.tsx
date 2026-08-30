import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { TelaSelecionarItens } from './TelaSelecionarItens.js';

const venda = { id: 'venda-1', numero: 42, totalCentavos: 15000, registradaEm: '2026-08-30T12:00:00Z' };

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoConcluir = vi.fn();
  const aoVoltar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <TelaSelecionarItens venda={venda} aoConcluir={aoConcluir} aoVoltar={aoVoltar} />
    </QueryClientProvider>,
  );
  return { aoConcluir, aoVoltar };
}

function mockDisponivel() {
  return {
    ok: true,
    json: async () => ({
      vendaId: 'venda-1',
      itens: [
        {
          itemVendaId: 'item-1',
          varianteId: 'variante-1',
          descricao: 'Pijama Longo Floral M',
          sku: 'PJL-FLR-M',
          quantidadeVendida: 3,
          quantidadeJaDevolvida: 0,
          precoUnitarioLiquidoCentavos: 5000,
        },
      ],
    }),
  } as Response;
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

describe('TelaSelecionarItens', () => {
  it('exige ao menos um item selecionado antes de continuar', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(mockDisponivel());
    renderizar();

    await screen.findByText('Pijama Longo Floral M');
    await usuario.type(screen.getByLabelText('Motivo'), 'Cliente desistiu');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Selecione ao menos um item para devolver.')).toBeInTheDocument();
  });

  it('exige motivo antes de continuar', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(mockDisponivel());
    renderizar();

    await screen.findByText('Pijama Longo Floral M');
    await usuario.type(screen.getByLabelText(/Quantidade a devolver/), '1');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Descreva o motivo da devolução (mínimo 3 caracteres).')).toBeInTheDocument();
  });

  it('recusa devolver mais do que o disponível', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(mockDisponivel());
    renderizar();

    await screen.findByText('Pijama Longo Floral M');
    await usuario.type(screen.getByLabelText(/Quantidade a devolver/), '5');
    await usuario.type(screen.getByLabelText('Motivo'), 'Cliente desistiu');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText(/maior que o disponível/)).toBeInTheDocument();
  });

  it('mostra o resumo exato na autorização de gerente e envia a quantidade certa', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(mockDisponivel());
    renderizar();

    await screen.findByText('Pijama Longo Floral M');
    await usuario.type(screen.getByLabelText(/Quantidade a devolver/), '2');
    await usuario.click(screen.getByLabelText('Pix'));
    await usuario.type(screen.getByLabelText('Motivo'), 'Peça com defeito');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Autorizar devolução')).toBeInTheDocument();
    expect(
      screen.getByText('Devolução de 2× Pijama Longo Floral M — R$ 100,00 estornado em Pix — Peça com defeito'),
    ).toBeInTheDocument();

    mockLoginGerente();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cancelamentoId: 'canc-1', totalCentavos: 10000 }),
    } as Response);

    await usuario.type(screen.getByLabelText('Código do gerente'), 'bia');
    await usuario.type(screen.getByLabelText('Senha'), 'gerente123');
    await usuario.click(screen.getByRole('button', { name: 'Autorizar' }));

    expect(await screen.findByText('Devolução registrada')).toBeInTheDocument();
    expect(screen.getByText('R$ 100,00 estornado')).toBeInTheDocument();

    const [, opcoesDevolucao] = vi.mocked(fetch).mock.calls[2]!;
    const corpo = JSON.parse(opcoesDevolucao!.body as string);
    expect(corpo).toMatchObject({
      itens: [{ itemVendaId: 'item-1', quantidade: 2 }],
      formaEstorno: 'PIX',
      motivo: 'Peça com defeito',
      autorizadoPorId: 'gerente-1',
    });
  });

  it('a tela de resultado permanece até o operador clicar em Concluir', async () => {
    const usuario = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(mockDisponivel());
    const { aoConcluir } = renderizar();

    await screen.findByText('Pijama Longo Floral M');
    await usuario.type(screen.getByLabelText(/Quantidade a devolver/), '1');
    await usuario.type(screen.getByLabelText('Motivo'), 'Troca de tamanho');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    mockLoginGerente();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cancelamentoId: 'canc-1', totalCentavos: 5000 }),
    } as Response);
    await usuario.type(screen.getByLabelText('Código do gerente'), 'bia');
    await usuario.type(screen.getByLabelText('Senha'), 'gerente123');
    await usuario.click(screen.getByRole('button', { name: 'Autorizar' }));

    await screen.findByText('Devolução registrada');
    expect(aoConcluir).not.toHaveBeenCalled();

    await usuario.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(aoConcluir).toHaveBeenCalled();
  });
});
