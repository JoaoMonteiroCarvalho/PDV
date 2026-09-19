/**
 * O que estes testes travam é a ALÇADA.
 *
 * Desconto é o ponto do sistema em que uma operadora consegue, sozinha,
 * transferir dinheiro da margem da loja para a conta da cliente. A regra que
 * impede isso — "acima do seu limite, só com gerente" — vive no servidor e é
 * decidida lá. Mas se a tela deixar confirmar sem a liberação, a venda vai
 * para a fila, é impressa, a cliente vai embora, e só então o servidor recusa:
 * vira venda bloqueada com o dinheiro já fora da gaveta.
 *
 * Por isso a trava é testada aqui também, e não só na API.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { useSessao } from '../estado/sessaoStore.js';
import { ModalDesconto } from './ModalDesconto.js';
import type { ItemCatalogo } from '../banco/local.js';

const CONJUNTO: ItemCatalogo = {
  id: '11111111-1111-4111-8111-111111111111',
  produtoId: '22222222-2222-4222-8222-222222222222',
  sku: 'CJ-RENDA-M-PRETO',
  codigoBarras: '7891234567890',
  nome: 'Conjunto Renda',
  marca: null,
  categoria: 'Conjunto',
  tamanho: 'M',
  cor: 'preto',
  // R$ 100,00 — deixa a conta de porcentagem legível no teste.
  precoCentavos: 10_000,
  ativo: true,
  saldoEstoque: 5,
  atualizadoEm: new Date().toISOString(),
  termos: [],
};

function prepararCaixa(limiteDescontoBps: number): void {
  useSessao.setState({
    operadora: {
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Operadora',
      papel: 'OPERADOR',
      limiteDescontoBps,
    },
  });
  useCarrinho.getState().limparVenda();
  useCarrinho.getState().adicionarItem(CONJUNTO);
}

afterEach(() => {
  useCarrinho.getState().limparVenda();
  useSessao.setState({ operadora: null });
});

describe('ModalDesconto — dentro da alçada', () => {
  it('aplica o desconto sem pedir gerente nenhuma', async () => {
    // Alçada de 10%; o desconto será de 5%.
    prepararCaixa(1_000);
    const usuario = userEvent.setup();
    render(<ModalDesconto alvo={{ tipo: 'TOTAL' }} aoFechar={() => undefined} />);

    await usuario.click(screen.getByRole('button', { name: 'Em porcentagem' }));
    await usuario.type(screen.getByLabelText('Desconto (%)'), '5');

    expect(screen.queryByText(/Autorização da gerente/i)).toBeNull();

    await usuario.click(screen.getByRole('button', { name: 'Aplicar desconto' }));
    expect(useCarrinho.getState().carrinho.descontoSobreTotalCentavos).toBe(500);
  });

  it('mostra o percentual efetivo da venda enquanto ainda dá para mudar', async () => {
    prepararCaixa(1_000);
    const usuario = userEvent.setup();
    render(<ModalDesconto alvo={{ tipo: 'TOTAL' }} aoFechar={() => undefined} />);

    await usuario.click(screen.getByRole('button', { name: 'Em porcentagem' }));
    await usuario.type(screen.getByLabelText('Desconto (%)'), '5');

    expect(screen.getByText(/Desconto efetivo da venda: 5%/i)).toBeVisible();
  });
});

describe('ModalDesconto — acima da alçada', () => {
  it('não deixa confirmar sem a liberação da gerente', async () => {
    // Alçada de 5%; o desconto será de 20%.
    prepararCaixa(500);
    const usuario = userEvent.setup();
    render(<ModalDesconto alvo={{ tipo: 'TOTAL' }} aoFechar={() => undefined} />);

    await usuario.click(screen.getByRole('button', { name: 'Em porcentagem' }));
    await usuario.type(screen.getByLabelText('Desconto (%)'), '20');

    expect(screen.getByText(/Autorização da gerente/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aplicar desconto' })).toBeDisabled();
    // E nada foi aplicado ao carrinho pelas costas.
    expect(useCarrinho.getState().carrinho.descontoSobreTotalCentavos).toBe(0);
  });

  it('diz qual é o limite de quem está operando, em vez de só recusar', async () => {
    prepararCaixa(500);
    const usuario = userEvent.setup();
    render(<ModalDesconto alvo={{ tipo: 'TOTAL' }} aoFechar={() => undefined} />);

    await usuario.click(screen.getByRole('button', { name: 'Em porcentagem' }));
    await usuario.type(screen.getByLabelText('Desconto (%)'), '20');

    expect(screen.getByText(/acima da sua alçada de 5%/i)).toBeVisible();
  });

  it('operadora sem alçada nenhuma precisa de gerente para qualquer desconto', async () => {
    prepararCaixa(0);
    const usuario = userEvent.setup();
    render(<ModalDesconto alvo={{ tipo: 'TOTAL' }} aoFechar={() => undefined} />);

    await usuario.click(screen.getByRole('button', { name: 'Em porcentagem' }));
    await usuario.type(screen.getByLabelText('Desconto (%)'), '1');

    expect(screen.getByRole('button', { name: 'Aplicar desconto' })).toBeDisabled();
  });
});

describe('ModalDesconto — desconto no item', () => {
  it('a base do percentual é a linha, não a venda inteira', async () => {
    prepararCaixa(10_000);
    // Duas peças de R$ 100: a linha vale R$ 200.
    useCarrinho.getState().adicionarItem(CONJUNTO);
    const usuario = userEvent.setup();
    render(
      <ModalDesconto alvo={{ tipo: 'ITEM', varianteId: CONJUNTO.id }} aoFechar={() => undefined} />,
    );

    await usuario.click(screen.getByRole('button', { name: 'Em porcentagem' }));
    await usuario.type(screen.getByLabelText('Desconto (%)'), '10');

    await usuario.click(screen.getByRole('button', { name: 'Aplicar desconto' }));
    const item = useCarrinho.getState().carrinho.itens[0];
    expect(item?.descontoCentavos).toBe(2_000);
  });
});
