import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteApi } from '../api/cliente.js';
import { useCaixa } from '../estado/caixaStore.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';
import type { EstadoSincronizacao } from '../sincronizacao/motor.js';
import { TelaFecharCaixa } from './TelaFecharCaixa.js';

const SESSAO = {
  id: 'sessao-1',
  terminalId: 't1',
  fundoTrocoCentavos: 20_000,
  abertaEm: '2026-09-01T09:00:00.000Z',
  saldoEsperadoCentavos: 45_000,
};

const FILA_LIMPA: EstadoSincronizacao = {
  online: true,
  pendentes: 0,
  bloqueadas: 0,
  sincronizando: false,
  ultimaSincronizacao: null,
  produtosLocais: 10,
};

function comFila(parcial: Partial<EstadoSincronizacao> = {}) {
  vi.spyOn(motorSincronizacao, 'aoMudar').mockImplementation((ouvinte) => {
    ouvinte({ ...FILA_LIMPA, ...parcial });
    return () => {};
  });
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/caixa/fechar']}>
      <Routes>
        <Route path="/caixa/fechar" element={<TelaFecharCaixa />} />
        <Route path="/caixa" element={<p>tela do caixa</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Preenche a contagem por cédula: `quantidade` notas de `rotulo`. */
async function contarCedula(rotulo: string, quantidade: number) {
  await userEvent.type(screen.getByLabelText(`Quantidade de ${rotulo}`), String(quantidade));
}

beforeEach(() => {
  useCaixa.setState({ sessao: SESSAO, jaConsultou: true, erro: null, carregando: false });
  comFila();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TelaFecharCaixa — conferência às cegas', () => {
  it('NÃO mostra o valor esperado antes de a operadora contar', () => {
    /*
     * A regra inteira da tela. Com o esperado visível, conferir vira copiar: a
     * operadora digita o número que está na tela e a divergência some, junto
     * com a única chance de a loja achar um erro de troco ou um desvio.
     */
    montar();

    expect(screen.queryByText('R$ 450,00')).not.toBeInTheDocument();
    expect(screen.queryByText(/esperado pelo sistema/i)).not.toBeInTheDocument();
    expect(screen.getByText(/só mostra o esperado depois que você confirmar/i)).toBeVisible();
  });

  it('soma a contagem por cédula ao vivo', async () => {
    montar();

    await contarCedula('R$ 50', 3);
    await contarCedula('R$ 10', 2);

    expect(screen.getByTestId('total-contado')).toHaveTextContent('R$ 170,00');
  });

  it('aceita digitar o total direto, para quem já contou', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Total direto' }));
    await userEvent.click(screen.getByLabelText('Total contado na gaveta'));
    await userEvent.keyboard('45000');

    expect(screen.getByTestId('total-contado')).toHaveTextContent('R$ 450,00');
  });

  it('não deixa fechar sem informar contagem nenhuma', () => {
    montar();
    expect(screen.getByRole('button', { name: 'Conferir e fechar' })).toBeDisabled();
    expect(screen.getByText(/Informe o valor contado/)).toBeVisible();
  });

  it('a confirmação diz que a sessão não pode ser reaberta', async () => {
    montar();
    await contarCedula('R$ 50', 9);
    await userEvent.click(screen.getByRole('button', { name: 'Conferir e fechar' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(/não pode ser reaberta/i);
    // Mostra exatamente o que vai ser enviado, e nada além.
    expect(screen.getByRole('dialog')).toHaveTextContent('R$ 450,00');
  });

  it('só revela esperado e diferença depois de fechar', async () => {
    const fechar = vi.spyOn(clienteApi, 'fecharSessao').mockResolvedValue({
      valorEsperadoCentavos: 45_000,
      valorContadoCentavos: 44_000,
      diferencaCentavos: -1_000,
    });
    montar();

    await contarCedula('R$ 50', 8);
    await contarCedula('R$ 20', 2);
    await userEvent.click(screen.getByRole('button', { name: 'Conferir e fechar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar caixa' }));

    await waitFor(() => expect(screen.getByText('Esperado pelo sistema')).toBeVisible());
    expect(fechar).toHaveBeenCalledWith('sessao-1', 44_000);
  });

  it('falta aparece como "Faltou", com valor positivo', async () => {
    // No balcão ninguém pensa em "diferença de -1000", pensa em "faltou dez".
    vi.spyOn(clienteApi, 'fecharSessao').mockResolvedValue({
      valorEsperadoCentavos: 45_000,
      valorContadoCentavos: 44_000,
      diferencaCentavos: -1_000,
    });
    montar();

    await contarCedula('R$ 50', 8);
    await userEvent.click(screen.getByRole('button', { name: 'Conferir e fechar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar caixa' }));

    await waitFor(() => expect(screen.getByText('Faltou')).toBeVisible());
    expect(screen.getByTestId('diferenca')).toHaveTextContent('R$ 10,00');
  });

  it('sobra aparece como "Sobrou"', async () => {
    vi.spyOn(clienteApi, 'fecharSessao').mockResolvedValue({
      valorEsperadoCentavos: 45_000,
      valorContadoCentavos: 46_000,
      diferencaCentavos: 1_000,
    });
    montar();

    await contarCedula('R$ 50', 8);
    await userEvent.click(screen.getByRole('button', { name: 'Conferir e fechar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar caixa' }));

    await waitFor(() => expect(screen.getByText('Sobrou')).toBeVisible());
  });

  it('bater certo é dito sem alarde', async () => {
    vi.spyOn(clienteApi, 'fecharSessao').mockResolvedValue({
      valorEsperadoCentavos: 45_000,
      valorContadoCentavos: 45_000,
      diferencaCentavos: 0,
    });
    montar();

    await contarCedula('R$ 50', 9);
    await userEvent.click(screen.getByRole('button', { name: 'Conferir e fechar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar caixa' }));

    await waitFor(() => expect(screen.getByText('Sem divergência')).toBeVisible());
  });

  it('fechar encerra a sessão local, senão dá para vender sem caixa', async () => {
    vi.spyOn(clienteApi, 'fecharSessao').mockResolvedValue({
      valorEsperadoCentavos: 45_000,
      valorContadoCentavos: 45_000,
      diferencaCentavos: 0,
    });
    montar();

    await contarCedula('R$ 50', 9);
    await userEvent.click(screen.getByRole('button', { name: 'Conferir e fechar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar caixa' }));

    await waitFor(() => expect(useCaixa.getState().sessao).toBeNull());
  });

  it('falha ao fechar aparece na tela e não encerra a sessão', async () => {
    vi.spyOn(clienteApi, 'fecharSessao').mockRejectedValue(new Error('Servidor fora do ar.'));
    montar();

    await contarCedula('R$ 50', 9);
    await userEvent.click(screen.getByRole('button', { name: 'Conferir e fechar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar caixa' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Servidor fora do ar.'));
    // A sessão continua aberta: nada foi encerrado no servidor.
    expect(useCaixa.getState().sessao).not.toBeNull();
  });
});

describe('TelaFecharCaixa — fila de sincronização', () => {
  it('venda pendente BLOQUEIA o fechamento e explica por quê', async () => {
    /*
     * O esperado vem do servidor. Se há venda que não subiu, ele sai menor que
     * a gaveta e a conferência acusa uma sobra que não existe — e esse número
     * falso fica gravado, sem como desfazer.
     */
    comFila({ pendentes: 2 });
    montar();

    await contarCedula('R$ 50', 9);

    expect(screen.getByRole('button', { name: 'Conferir e fechar' })).toBeDisabled();
    expect(screen.getByText(/vendas ainda não subiram/i)).toBeVisible();
  });

  it('oferece enviar a fila na hora, em vez de só reclamar', async () => {
    const enviar = vi.spyOn(motorSincronizacao, 'enviarPendentes').mockResolvedValue();
    comFila({ pendentes: 1 });
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar agora' }));

    expect(enviar).toHaveBeenCalled();
  });

  it('venda bloqueada avisa mas não trava — a loja precisa fechar o dia', async () => {
    // Retentar não resolve um 4xx: esperar não adiantaria nada.
    comFila({ bloqueadas: 1 });
    montar();

    await contarCedula('R$ 50', 9);

    expect(screen.getByText(/foi recusada pelo servidor/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Conferir e fechar' })).toBeEnabled();
  });
});

describe('TelaFecharCaixa — sem caixa aberto', () => {
  it('explica em vez de mostrar formulário vazio', () => {
    useCaixa.setState({ sessao: null, jaConsultou: true });
    montar();

    expect(screen.getByText('Não há caixa aberto')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Conferir e fechar' })).not.toBeInTheDocument();
  });
});
