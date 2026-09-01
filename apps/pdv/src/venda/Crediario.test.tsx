/**
 * Fiado na finalização da venda.
 *
 * O que estes testes protegem:
 *
 *   1. Fiado sem cliente identificada não passa — é dívida de ninguém, e o
 *      servidor recusaria depois do comprovante impresso.
 *   2. O limite respeitado é o DISPONÍVEL, já descontado o que ela deve.
 *   3. O plano de parcelas chega inteiro em quem registra a venda.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteApi, type ClienteDetalhe } from '../api/cliente.js';
import type { ItemCatalogo } from '../banco/local.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { ModalFinalizacao } from './ModalFinalizacao.js';

function item(preco: number): ItemCatalogo {
  return {
    id: 'v1',
    produtoId: 'p1',
    sku: 'PF-SED',
    codigoBarras: null,
    nome: 'Perfume Sedução',
    marca: 'Intimi',
    // Perfumaria: sem restrição de higiene, então o modal não pede o aviso de
    // troca e o teste fica focado no fiado.
    categoria: 'Perfumaria',
    tamanho: null,
    cor: null,
    precoCentavos: preco,
    ativo: true,
    saldoEstoque: 5,
    atualizadoEm: '2026-09-01T10:00:00.000Z',
    termos: [],
  };
}

function clienteCom(limiteDisponivel: number, saldoDevedor = 0): ClienteDetalhe {
  return {
    id: 'cli-1',
    nome: 'Carla Fernandes',
    cpf: '52998224725',
    telefone: null,
    limiteCrediarioCentavos: limiteDisponivel + saldoDevedor,
    observacao: null,
    ativo: true,
    saldoDevedorCentavos: saldoDevedor,
    limiteDisponivelCentavos: limiteDisponivel,
    parcelasEmAberto: [],
  };
}

function montar(precoCentavos: number) {
  useCarrinho.getState().adicionarItem(item(precoCentavos));
  const aoConfirmar = vi.fn().mockResolvedValue(undefined);
  render(<ModalFinalizacao aoFechar={vi.fn()} aoConfirmar={aoConfirmar} />);
  return { aoConfirmar };
}

/** Escolhe o fiado e seleciona a cliente na busca. */
async function escolherFiadoCom(cliente: ClienteDetalhe) {
  vi.spyOn(clienteApi, 'buscarClientes').mockResolvedValue([
    {
      id: cliente.id,
      nome: cliente.nome,
      cpf: cliente.cpf,
      telefone: null,
      limiteCrediarioCentavos: cliente.limiteCrediarioCentavos,
    },
  ]);
  vi.spyOn(clienteApi, 'obterCliente').mockResolvedValue(cliente);

  await userEvent.click(screen.getByRole('button', { name: 'Fiado' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Carla/ })).toBeVisible());
  await userEvent.click(screen.getByRole('button', { name: /Carla/ }));
  await waitFor(() => expect(screen.getByTestId('limite-disponivel-venda')).toBeVisible());
}

beforeEach(() => {
  useCarrinho.getState().limparVenda();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fiado exige cliente identificada', () => {
  it('lançar fiado sem cliente é recusado com instrução', async () => {
    vi.spyOn(clienteApi, 'buscarClientes').mockResolvedValue([]);
    montar(10_000);

    await userEvent.click(screen.getByRole('button', { name: 'Fiado' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Escolha a cliente antes de lançar no fiado.',
    );
  });

  it('a busca explica o que fazer quando não acha ninguém', async () => {
    vi.spyOn(clienteApi, 'buscarClientes').mockResolvedValue([]);
    montar(10_000);

    await userEvent.click(screen.getByRole('button', { name: 'Fiado' }));
    await userEvent.type(screen.getByLabelText('Cliente do fiado'), 'zzz');

    await waitFor(() =>
      expect(screen.getByText(/Cadastre em Clientes antes de vender fiado/)).toBeVisible(),
    );
  });
});

describe('limite do fiado', () => {
  it('mostra o que a cliente pode levar, já descontado o que deve', async () => {
    montar(10_000);
    await escolherFiadoCom(clienteCom(30_000, 20_000));

    // Limite 500, deve 200, pode levar 300.
    expect(screen.getByTestId('limite-disponivel-venda')).toHaveTextContent('R$ 300,00');
  });

  it('recusa lançar acima do disponível, dizendo o teto', async () => {
    montar(40_000);
    await escolherFiadoCom(clienteCom(30_000));

    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/pode levar no máximo R\$ 300,00/);
  });

  it('deixa lançar exatamente o disponível', async () => {
    montar(30_000);
    await escolherFiadoCom(clienteCom(30_000));

    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    expect(screen.getByText('Pago por completo')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled();
  });

  it('venda dividida: parte em dinheiro, resto no fiado', async () => {
    /*
     * É o caso real: a cliente paga o que tem e leva o resto fiado. O limite
     * confere só a parte do fiado, não o total da venda.
     */
    const { aoConfirmar } = montar(50_000);

    await screen.getByLabelText('Valor recebido').focus();
    await userEvent.keyboard('30000');
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    await escolherFiadoCom(clienteCom(30_000));
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venda' }));

    await waitFor(() => expect(aoConfirmar).toHaveBeenCalled());
    expect(aoConfirmar.mock.calls[0]![0]).toEqual([
      { forma: 'DINHEIRO', valorCentavos: 30_000, trocoCentavos: 0 },
      { forma: 'CREDIARIO', valorCentavos: 20_000, trocoCentavos: 0 },
    ]);
  });
});

describe('plano de parcelas', () => {
  it('leva cliente, parcelas e vencimento a quem registra a venda', async () => {
    const { aoConfirmar } = montar(30_000);
    await escolherFiadoCom(clienteCom(30_000));

    await userEvent.click(screen.getByRole('button', { name: '3x' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venda' }));

    await waitFor(() => expect(aoConfirmar).toHaveBeenCalled());
    const plano = aoConfirmar.mock.calls[0]![1];
    expect(plano).toMatchObject({ clienteId: 'cli-1', quantidadeParcelas: 3 });
    expect(plano.primeiroVencimento).toBeInstanceOf(Date);
  });

  it('venda sem fiado não leva plano nenhum', async () => {
    const { aoConfirmar } = montar(10_000);

    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venda' }));

    await waitFor(() => expect(aoConfirmar).toHaveBeenCalled());
    expect(aoConfirmar.mock.calls[0]![1]).toBeNull();
  });

  it('à vista é o padrão — não parcela sem alguém escolher', async () => {
    const { aoConfirmar } = montar(30_000);
    await escolherFiadoCom(clienteCom(30_000));

    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venda' }));

    await waitFor(() => expect(aoConfirmar).toHaveBeenCalled());
    expect(aoConfirmar.mock.calls[0]![1]).toMatchObject({ quantidadeParcelas: 1 });
  });
});
