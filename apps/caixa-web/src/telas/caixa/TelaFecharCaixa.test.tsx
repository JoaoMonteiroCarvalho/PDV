import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelaFecharCaixa } from './TelaFecharCaixa.js';

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const aoConcluir = vi.fn();
  const aoVoltar = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <TelaFecharCaixa sessaoCaixaId="sessao-1" aoConcluir={aoConcluir} aoVoltar={aoVoltar} />
    </QueryClientProvider>,
  );
  return { aoConcluir, aoVoltar };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelaFecharCaixa — conferência cega', () => {
  it('nunca mostra o rótulo "Esperado" (nem qualquer valor associado a ele) antes do operador confirmar', () => {
    renderizar();
    // Regex ancorada no INÍCIO do texto do nó: casa o rótulo "Esperado:
    // R$ 130,00", não a explicação em prosa que também usa a palavra.
    expect(screen.queryByText(/^Esperado/)).not.toBeInTheDocument();
  });

  it('pede confirmação mostrando o valor exato antes de enviar — não um "tem certeza?" genérico', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/Valor contado/i), '350,00');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('R$ 350,00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar fechamento/ })).toBeInTheDocument();
    // Continua sem revelar o rótulo "Esperado", mesmo na tela de confirmação.
    expect(screen.queryByText(/^Esperado/)).not.toBeInTheDocument();
  });

  it('bateu certinho aparece em destaque verde, sem diferença', async () => {
    const usuario = userEvent.setup();
    renderizar();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valorEsperadoCentavos: 35000, valorContadoCentavos: 35000, diferencaCentavos: 0 }),
    } as Response);

    await usuario.type(screen.getByLabelText(/Valor contado/i), '350,00');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));
    await usuario.click(screen.getByRole('button', { name: /Confirmar fechamento/ }));

    expect(await screen.findByText('Bateu certinho ✓')).toBeInTheDocument();
    // Só agora, DEPOIS da confirmação, o esperado pode aparecer — contado e
    // esperado batem exato neste caso, então o valor legitimamente repete.
    expect(screen.getAllByText('R$ 350,00')).toHaveLength(2);
  });

  it('diferença negativa (faltou) aparece em destaque com o valor exato', async () => {
    const usuario = userEvent.setup();
    renderizar();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valorEsperadoCentavos: 35500, valorContadoCentavos: 35000, diferencaCentavos: -500 }),
    } as Response);

    await usuario.type(screen.getByLabelText(/Valor contado/i), '350,00');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));
    await usuario.click(screen.getByRole('button', { name: /Confirmar fechamento/ }));

    expect(await screen.findByText(/Diferença: -R\$ 5,00 \(faltou\)/)).toBeInTheDocument();
  });

  it('diferença positiva (sobrou) aparece distinta de faltou', async () => {
    const usuario = userEvent.setup();
    renderizar();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valorEsperadoCentavos: 34500, valorContadoCentavos: 35000, diferencaCentavos: 500 }),
    } as Response);

    await usuario.type(screen.getByLabelText(/Valor contado/i), '350,00');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));
    await usuario.click(screen.getByRole('button', { name: /Confirmar fechamento/ }));

    expect(await screen.findByText(/Diferença: \+R\$ 5,00 \(sobrou\)/)).toBeInTheDocument();
  });

  it('fechamento nunca é bloqueado por divergência — o botão de confirmar continua disponível mesmo com diferença', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText(/Valor contado/i), '0,00');
    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.getByRole('button', { name: /Confirmar fechamento/ })).toBeEnabled();
  });

  it('rejeita valor contado vazio antes mesmo de tentar continuar', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('Informe o valor contado')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
