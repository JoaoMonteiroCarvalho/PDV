import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteApi, type RelatorioVendas } from '../api/cliente.js';
import { TelaRelatorios } from './TelaRelatorios.js';

function relatorio(parcial: Partial<RelatorioVendas> = {}): RelatorioVendas {
  return {
    de: '2026-09-01',
    ate: '2026-09-07',
    resumo: {
      quantidadeVendas: 4,
      totalCentavos: 45_000,
      descontoCentavos: 2_000,
      ticketMedioCentavos: 11_250,
      pecasVendidas: 9,
    },
    porDia: [
      { dia: '2026-09-01', quantidade: 1, totalCentavos: 10_000 },
      { dia: '2026-09-03', quantidade: 3, totalCentavos: 35_000 },
    ],
    porForma: [
      { forma: 'DINHEIRO', quantidade: 3, totalCentavos: 30_000 },
      { forma: 'PIX', quantidade: 1, totalCentavos: 15_000 },
    ],
    maisVendidos: [
      { descricao: 'Conjunto Renda', sku: 'CJ-1', quantidade: 6, totalCentavos: 30_000 },
      { descricao: 'Perfume', sku: 'PF-1', quantidade: 3, totalCentavos: 15_000 },
    ],
    ...parcial,
  };
}

const vazio = relatorio({
  resumo: {
    quantidadeVendas: 0,
    totalCentavos: 0,
    descontoCentavos: 0,
    ticketMedioCentavos: 0,
    pecasVendidas: 0,
  },
  porDia: [],
  porForma: [],
  maisVendidos: [],
});

beforeEach(() => {
  vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(relatorio());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TelaRelatorios — números do período', () => {
  it('mostra vendas, faturamento, ticket médio e peças', async () => {
    render(<TelaRelatorios />);

    expect(await screen.findByTestId('faturamento')).toHaveTextContent('R$ 450,00');
    expect(screen.getByTestId('qtd-vendas')).toHaveTextContent('4');
    expect(screen.getByTestId('ticket-medio')).toHaveTextContent('R$ 112,50');
    expect(screen.getByTestId('pecas')).toHaveTextContent('9');
  });

  it('mostra o desconto concedido quando houve', async () => {
    render(<TelaRelatorios />);
    expect(await screen.findByText(/Desconto concedido/)).toBeVisible();
  });

  it('não fala de desconto quando não houve', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(vazio);
    render(<TelaRelatorios />);

    await screen.findByTestId('faturamento');
    expect(screen.queryByText(/Desconto concedido/)).not.toBeInTheDocument();
  });

  it('período sem venda diz isso, em vez de tela vazia', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(vazio);
    render(<TelaRelatorios />);

    expect(await screen.findByText('Sem movimento no período.')).toBeVisible();
    expect(screen.getByText('Nenhuma peça vendida.')).toBeVisible();
  });

  it('falha ao carregar aparece com opção de tentar de novo', async () => {
    vi.spyOn(clienteApi, 'relatorioVendas').mockRejectedValue(new Error('Servidor fora do ar.'));
    render(<TelaRelatorios />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor fora do ar.');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  });
});

describe('TelaRelatorios — gráfico', () => {
  it('os mesmos números aparecem em tabela, para leitor de tela', async () => {
    /*
     * O SVG é `aria-hidden`: quem não enxerga receberia "gráfico" e mais nada.
     * A tabela oculta é o conteúdo de verdade.
     */
    render(<TelaRelatorios />);

    const tabela = await screen.findByRole('table', { name: 'Faturamento por dia' });
    expect(tabela).toHaveTextContent('01/09/2026');
    expect(tabela).toHaveTextContent('R$ 350,00');
  });

  it('não desenha gráfico em 3D', async () => {
    /*
     * Barra em perspectiva é o exemplo clássico de gráfico que engana: a face
     * frontal fica mais baixa que o topo real e comparar duas barras vira
     * adivinhação. Num relatório de faturamento isso é número errado.
     */
    const { container } = render(<TelaRelatorios />);
    await screen.findByTestId('faturamento');

    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('TelaRelatorios — período', () => {
  it('consulta o servidor com as datas escolhidas', async () => {
    const consultar = vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(relatorio());
    render(<TelaRelatorios />);
    await screen.findByTestId('faturamento');

    await userEvent.click(screen.getByRole('button', { name: 'Hoje' }));

    await waitFor(() => {
      const ultima = consultar.mock.calls.at(-1)!;
      // Mesmo dia nas duas pontas: "hoje" é um período de um dia.
      expect(ultima[0]).toBe(ultima[1]);
    });
  });

  it('o atalho de 7 dias cobre uma semana', async () => {
    const consultar = vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(relatorio());
    render(<TelaRelatorios />);
    await screen.findByTestId('faturamento');

    await userEvent.click(screen.getByRole('button', { name: '7 dias' }));

    await waitFor(() => {
      const [de, ate] = consultar.mock.calls.at(-1)!;
      const dias = (new Date(ate).getTime() - new Date(de).getTime()) / 86_400_000;
      expect(dias).toBe(6); // 6 dias de diferença = 7 dias contando os dois
    });
  });
});

describe('TelaRelatorios — exportação', () => {
  it('exporta com separador e decimal que o Excel pt-BR entende', async () => {
    /*
     * Com vírgula separadora o Excel em português abre tudo numa coluna só, e
     * com ponto decimal a soma da coluna dá zero. Este teste lê o Blob que
     * seria baixado.
     */
    /*
     * `URL.createObjectURL` não existe no jsdom, então `spyOn` falha com
     * "does not exist" — é preciso instalar o stub, não espionar.
     */
    let conteudo = '';
    const criarUrl = vi.fn((blob: Blob) => {
      void blob.text().then((texto) => {
        conteudo = texto;
      });
      return 'blob:teste';
    });
    Object.defineProperty(URL, 'createObjectURL', { value: criarUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

    render(<TelaRelatorios />);
    await screen.findByTestId('faturamento');

    await userEvent.click(screen.getAllByRole('button', { name: 'Exportar CSV' })[0]!);

    await waitFor(() => expect(criarUrl).toHaveBeenCalled());
    await waitFor(() => expect(conteudo).toContain('Dia;Vendas;Faturamento'));
    expect(conteudo).toContain('01/09/2026;1;100,00');
    expect(conteudo).not.toContain('100.00');
  });

  it('não deixa exportar período vazio', async () => {
    // Um CSV só com cabeçalho parece download quebrado para quem clicou.
    vi.spyOn(clienteApi, 'relatorioVendas').mockResolvedValue(vazio);
    render(<TelaRelatorios />);
    await screen.findByTestId('faturamento');

    for (const botao of screen.getAllByRole('button', { name: 'Exportar CSV' })) {
      expect(botao).toBeDisabled();
    }
  });
});
