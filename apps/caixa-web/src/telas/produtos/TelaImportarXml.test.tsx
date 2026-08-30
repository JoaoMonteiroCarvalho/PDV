import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessao } from '@/estado/useSessao.js';
import { TelaImportarXml } from './TelaImportarXml.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoVoltar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <TelaImportarXml aoVoltar={aoVoltar} />
    </QueryClientProvider>,
  );
  return { aoVoltar };
}

function previa(itens: unknown[]) {
  return { ok: true, json: async () => ({ numeroNota: '123', itens }) } as Response;
}

beforeEach(() => {
  useSessao.setState({ token: 'token-operador', operador: { id: 'op-1', nome: 'Ana', papel: 'OPERADOR', limiteDescontoBps: 500 }, terminalId: null });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelaImportarXml', () => {
  it('nada é gravado ao analisar — só a prévia é buscada', async () => {
    const usuario = userEvent.setup();
    renderizar();

    vi.mocked(fetch).mockResolvedValueOnce(
      previa([
        {
          codigoBarras: '789',
          descricao: 'Pijama Longo Floral M',
          ncm: null,
          quantidade: 10,
          custoUnitarioCentavos: 4000,
          varianteExistenteId: 'variante-1',
          skuExistente: 'PJL-FLR-M',
          nomeExistente: 'Pijama Longo Floral',
        },
      ]),
    );

    await usuario.type(screen.getByPlaceholderText('Cole o XML aqui…'), '<nfeProc/>');
    await usuario.click(screen.getByRole('button', { name: 'Analisar' }));

    expect(await screen.findByText('Revisar importação')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Casado com/)).toBeInTheDocument();
  });

  it('item novo exige nome e preço antes de confirmar, item existente não pede nada', async () => {
    const usuario = userEvent.setup();
    renderizar();

    vi.mocked(fetch).mockResolvedValueOnce(
      previa([
        {
          codigoBarras: '999',
          descricao: 'Camisola Nova',
          ncm: null,
          quantidade: 5,
          custoUnitarioCentavos: 2550,
          varianteExistenteId: null,
          skuExistente: null,
          nomeExistente: null,
        },
      ]),
    );

    await usuario.type(screen.getByPlaceholderText('Cole o XML aqui…'), '<nfeProc/>');
    await usuario.click(screen.getByRole('button', { name: 'Analisar' }));

    expect(await screen.findByText('Revisar importação')).toBeInTheDocument();
    // Campos vêm pré-preenchidos com sugestão (nome = descrição da nota).
    expect(screen.getByLabelText('Nome do produto novo')).toHaveValue('Camisola Nova');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ movimentosCriados: 1 }),
    } as Response);

    await usuario.type(screen.getByLabelText('Preço de venda (R$)'), '59,90');
    await usuario.click(screen.getByRole('button', { name: 'Confirmar importação' }));

    await screen.findByText('Importação concluída');

    const [, opcoes] = vi.mocked(fetch).mock.calls[1]!;
    const corpo = JSON.parse(opcoes!.body as string);
    expect(corpo.itens[0]).toMatchObject({
      codigoBarras: '999',
      produtoNovo: { nome: 'Camisola Nova', precoCentavos: 5990 },
      quantidade: 5,
      custoUnitarioCentavos: 2550,
    });
  });

  it('mostra o total de movimentos criados ao concluir', async () => {
    const usuario = userEvent.setup();
    renderizar();

    vi.mocked(fetch).mockResolvedValueOnce(
      previa([
        {
          codigoBarras: '789',
          descricao: 'Pijama Longo Floral M',
          ncm: null,
          quantidade: 10,
          custoUnitarioCentavos: 4000,
          varianteExistenteId: 'variante-1',
          skuExistente: 'PJL-FLR-M',
          nomeExistente: 'Pijama Longo Floral',
        },
      ]),
    );
    await usuario.type(screen.getByPlaceholderText('Cole o XML aqui…'), '<nfeProc/>');
    await usuario.click(screen.getByRole('button', { name: 'Analisar' }));
    await screen.findByText('Revisar importação');

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ movimentosCriados: 1 }),
    } as Response);
    await usuario.click(screen.getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByText('1 movimentos de estoque criados.')).toBeInTheDocument();
  });
});
