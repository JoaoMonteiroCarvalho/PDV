import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemCatalogo } from '../banco/local.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { ModalFinalizacao } from './ModalFinalizacao.js';

function item(preco: number, id = 'v1'): ItemCatalogo {
  return {
    id,
    produtoId: 'p1',
    sku: `SKU-${id}`,
    codigoBarras: null,
    nome: 'Conjunto Renda',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: 'M',
    cor: 'Preto',
    precoCentavos: preco,
    ativo: true,
    saldoEstoque: 5,
    atualizadoEm: '2026-08-01T10:00:00.000Z',
    termos: [],
  };
}

/** Estado do carrinho é global: cada teste começa do zero. */
beforeEach(() => {
  useCarrinho.getState().limparVenda();
});

function montar(precoCentavos = 10_000) {
  useCarrinho.getState().adicionarItem(item(precoCentavos));
  const aoConfirmar = vi.fn().mockResolvedValue(undefined);
  render(<ModalFinalizacao aoFechar={vi.fn()} aoConfirmar={aoConfirmar} />);
  return { aoConfirmar };
}

/**
 * Marca a confirmação da política de troca.
 *
 * A fixture é uma peça de lingerie, então quase todo teste passa por aqui —
 * o que é o ponto: com peça íntima no carrinho não existe finalizar sem a
 * operadora confirmar que avisou a cliente.
 */
async function confirmarPolitica() {
  await userEvent.click(screen.getByRole('checkbox'));
}

/** Digita centavos no campo de valor, como a operadora faz na maquininha. */
async function digitarValor(digitos: string) {
  const campo = screen.getByLabelText('Valor recebido');
  await userEvent.clear(campo);
  await userEvent.type(campo, digitos);
}

describe('ModalFinalizacao', () => {
  it('mostra o que ainda falta receber, sempre', () => {
    montar(10_000);
    expect(screen.getByText('Ainda falta receber')).toBeInTheDocument();
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
  });

  it('não deixa confirmar enquanto a conta não fecha', async () => {
    montar(10_000);
    const confirmar = screen.getByRole('button', { name: 'Confirmar venda' });
    expect(confirmar).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    // Valor vazio lança o saldo inteiro: a conta fecha.
    expect(screen.getByText('Pago por completo')).toBeInTheDocument();

    await confirmarPolitica();
    expect(screen.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled();
  });

  it('calcula o troco ao vivo enquanto a operadora digita', async () => {
    montar(10_000);
    await digitarValor('15000'); // R$ 150,00 numa venda de R$ 100,00

    expect(screen.getByText('Troco a devolver')).toBeInTheDocument();
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument();
  });

  it('venda dividida: Pix parcial e o resto em dinheiro', async () => {
    const { aoConfirmar } = montar(13_000);

    await userEvent.click(screen.getByRole('button', { name: 'Pix' }));
    await digitarValor('5000'); // R$ 50,00 no Pix
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    // O saldo restante é o que a operadora precisa ver agora.
    expect(screen.getByText('R$ 80,00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Dinheiro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    await confirmarPolitica();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venda' }));

    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoConfirmar.mock.calls[0]![0]).toEqual([
      { forma: 'PIX', valorCentavos: 5_000, trocoCentavos: 0 },
      { forma: 'DINHEIRO', valorCentavos: 8_000, trocoCentavos: 0 },
    ]);
  });

  it('recusa valor acima do saldo em cartão e Pix, explicando o porquê', async () => {
    montar(10_000);

    await userEvent.click(screen.getByRole('button', { name: 'Débito' }));
    await digitarValor('12000');
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    // A maquininha opera separada do PDV e não devolve troco.
    expect(screen.getByRole('alert')).toHaveTextContent(/Só existe troco em dinheiro/);
    expect(screen.getByRole('button', { name: 'Confirmar venda' })).toBeDisabled();
  });

  it('troco em dinheiro entra no pagamento enviado, não só na tela', async () => {
    const { aoConfirmar } = montar(10_000);

    await digitarValor('15000');
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    await confirmarPolitica();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venda' }));

    expect(aoConfirmar.mock.calls[0]![0]).toEqual([
      { forma: 'DINHEIRO', valorCentavos: 15_000, trocoCentavos: 5_000 },
    ]);
  });

  it('remover um pagamento lançado reabre o saldo', async () => {
    montar(10_000);
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    expect(screen.getByText('Pago por completo')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Remover pagamento em DINHEIRO/ }));

    expect(screen.getByText('Ainda falta receber')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar venda' })).toBeDisabled();
  });

  it('falha ao registrar aparece no modal, não numa tela em branco', async () => {
    useCarrinho.getState().adicionarItem(item(10_000));
    const aoConfirmar = vi.fn().mockRejectedValue(new Error('Caixa fechado.'));
    render(<ModalFinalizacao aoFechar={vi.fn()} aoConfirmar={aoConfirmar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    await confirmarPolitica();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar venda' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Caixa fechado.');
    // Os pagamentos continuam lançados: a operadora corrige e tenta de novo.
    expect(screen.getByText('Pago por completo')).toBeInTheDocument();
  });
});

describe('ModalFinalizacao — política de troca por higiene', () => {
  it('com peça íntima, não fecha a venda sem a operadora confirmar o aviso', async () => {
    montar(10_000);
    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));

    // A conta fechou, mas o botão continua travado: falta o aviso.
    expect(screen.getByText('Pago por completo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar venda' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled();
  });

  it('o aviso diz que defeito de fabricação continua trocando', async () => {
    // Sem essa ressalva a operadora repassaria à cliente uma regra que a loja
    // não pode aplicar — troca por defeito é direito, não cortesia.
    montar(10_000);
    expect(screen.getByText(/exceto defeito de fabricação/i)).toBeVisible();
  });

  it('venda sem peça íntima não pede confirmação nenhuma', async () => {
    /*
     * Pedir em toda venda treinaria a mão a marcar sem ler, que é o mesmo que
     * não pedir. Perfume não tem restrição de higiene.
     */
    useCarrinho.getState().limparVenda();
    useCarrinho.getState().adicionarItem({
      ...item(12_000, 'perfume'),
      nome: 'Perfume Sedução',
      categoria: 'Perfumaria',
    });
    const aoConfirmar = vi.fn().mockResolvedValue(undefined);
    render(<ModalFinalizacao aoFechar={vi.fn()} aoConfirmar={aoConfirmar} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lançar pagamento' }));
    expect(screen.getByRole('button', { name: 'Confirmar venda' })).toBeEnabled();
  });
});
