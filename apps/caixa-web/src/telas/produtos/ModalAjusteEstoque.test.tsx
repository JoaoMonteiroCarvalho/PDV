import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { ModalAjusteEstoque } from './ModalAjusteEstoque.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoConcluir = vi.fn();
  const aoFechar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <ModalAjusteEstoque
        varianteId="variante-1"
        descricaoVariante="Pijama Longo Floral — M"
        aoConcluir={aoConcluir}
        aoFechar={aoFechar}
      />
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

describe('ModalAjusteEstoque', () => {
  it('entrada de compra grava direto, sem pedir gerente', async () => {
    const usuario = userEvent.setup();
    const { aoConcluir } = renderizar();

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'mov-1' }) } as Response);

    await usuario.type(screen.getByLabelText('Quantidade (unidades)'), '10');
    await usuario.type(screen.getByLabelText('Motivo'), 'Compra avulsa no atacado');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1); // só o movimento, nenhum login de gerente

    const [, opcoes] = vi.mocked(fetch).mock.calls[0]!;
    const corpo = JSON.parse(opcoes!.body as string);
    expect(corpo).toMatchObject({ tipo: 'ENTRADA_COMPRA', quantidade: 10 });
  });

  it('perda exige autorização de gerente antes de gravar, com quantidade negativa', async () => {
    const usuario = userEvent.setup();
    const { aoConcluir } = renderizar();

    await usuario.click(screen.getByRole('radio', { name: /Perda/ }));
    await usuario.type(screen.getByLabelText('Quantidade (unidades)'), '2');
    await usuario.type(screen.getByLabelText('Motivo'), 'Peça rasgada');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Autorizar perda')).toBeInTheDocument();
    expect(screen.getByText(/Perda de 2 un\. em Pijama Longo Floral — M — Peça rasgada/)).toBeInTheDocument();

    mockLoginGerente();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'mov-1' }) } as Response);

    await usuario.type(screen.getByLabelText('Código do gerente'), 'bia');
    await usuario.type(screen.getByLabelText('Senha'), 'gerente123');
    await usuario.click(screen.getByRole('button', { name: 'Autorizar' }));

    await vi.waitFor(() => expect(aoConcluir).toHaveBeenCalled());

    const [, opcoes] = vi.mocked(fetch).mock.calls[1]!;
    const corpo = JSON.parse(opcoes!.body as string);
    expect(corpo).toMatchObject({ tipo: 'PERDA', quantidade: -2, autorizadoPorId: 'gerente-1' });
  });

  it('ajuste de inventário também exige gerente, sem alçada de quantidade', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('radio', { name: /Ajuste de inventário/ }));
    await usuario.type(screen.getByLabelText('Quantidade (unidades)'), '1');
    await usuario.type(screen.getByLabelText('Motivo'), 'Contagem física');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Autorizar ajuste de inventário')).toBeInTheDocument();
  });

  it('exige quantidade e motivo antes de continuar', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Informe a quantidade')).toBeInTheDocument();
    expect(screen.getByText('Descreva o motivo (mínimo 3 caracteres)')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
