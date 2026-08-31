import 'fake-indexeddb/auto';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { bancoLocal, montarTermos, type ItemCatalogo } from '../banco/local.js';
import { useCaixa } from '../estado/caixaStore.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { TelaProduto } from './TelaProduto.js';

function variante(parcial: Partial<ItemCatalogo> & { id: string }): ItemCatalogo {
  const base = {
    produtoId: 'p1',
    sku: `SKU-${parcial.id}`,
    codigoBarras: null,
    nome: 'Conjunto Renda',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: null,
    cor: null,
    precoCentavos: 8990,
    ativo: true,
    saldoEstoque: 4,
    atualizadoEm: '2026-08-01T10:00:00.000Z',
    ...parcial,
  };
  return { ...base, termos: montarTermos(base) };
}

const GRADE = [
  variante({ id: 'a', cor: 'Preto', tamanho: 'P', saldoEstoque: 0, codigoBarras: '7890000000011' }),
  variante({ id: 'b', cor: 'Preto', tamanho: 'GG', saldoEstoque: 6, codigoBarras: '7890000000028' }),
  variante({ id: 'c', cor: 'Vinho', tamanho: 'P', saldoEstoque: 2, precoCentavos: 10990 }),
];

async function semearCatalogo(itens: ItemCatalogo[]) {
  await bancoLocal.catalogo.clear();
  await bancoLocal.catalogo.bulkPut(itens);
}

function montar(caminho: string) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/produto/:produtoId" element={<TelaProduto />} />
        <Route path="/venda" element={<p>tela de venda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  useCarrinho.getState().limparVenda();
  useCaixa.setState({ sessao: null, jaConsultou: true });
  await semearCatalogo(GRADE);
});

describe('TelaProduto', () => {
  it('mostra a peça com marca, categoria e faixa de preço', async () => {
    montar('/produto/p1');

    expect(await screen.findByRole('heading', { name: 'Conjunto Renda' })).toBeVisible();
    expect(screen.getByText('Intimi · Lingerie')).toBeVisible();
    expect(screen.getByText('R$ 89,90 – R$ 109,90')).toBeVisible();
  });

  it('abre na combinação com saldo, não na primeira da lista', async () => {
    // Preto/P é a primeira cadastrada e está zerada. Abrir nela faria a
    // operadora ler "0" e achar que o produto inteiro acabou.
    montar('/produto/p1');

    expect(await screen.findByText('6 em estoque')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tamanho GG' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('trocar de combinação troca o código e o preço na ficha', async () => {
    montar('/produto/p1');
    await screen.findByText('6 em estoque');

    // É daqui que sai o código para o pedido de reposição.
    expect(screen.getByText('7890000000028')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /Tamanho P/ }));

    expect(screen.getByText('7890000000011')).toBeVisible();
    expect(screen.getByText('Sem saldo registrado')).toBeVisible();
  });

  it('diz quando a loja não vende aquela combinação, em vez de mostrar zero', async () => {
    montar('/produto/p1');
    await screen.findByText('6 em estoque');

    // Vinho/GG nunca foi cadastrado — diferente de ter acabado.
    await userEvent.click(screen.getByRole('button', { name: 'Cor Vinho' }));
    await userEvent.click(screen.getByRole('button', { name: /Tamanho GG/ }));

    expect(screen.getByText(/não vende esta combinação/)).toBeVisible();
  });

  it('avisa no rótulo do tamanho que ele não existe naquela cor', async () => {
    montar('/produto/p1');
    await screen.findByText('6 em estoque');

    await userEvent.click(screen.getByRole('button', { name: 'Cor Vinho' }));

    expect(
      screen.getByRole('button', { name: 'Tamanho GG, não vendido nesta cor' }),
    ).toBeInTheDocument();
  });

  it('sem caixa aberto, consulta funciona mas não deixa lançar', async () => {
    montar('/produto/p1');
    await screen.findByText('6 em estoque');

    expect(screen.getByRole('button', { name: 'Adicionar à venda' })).toBeDisabled();
    expect(screen.getByText(/Consultar funciona sempre/)).toBeVisible();
  });

  it('com caixa aberto, lança a combinação escolhida e vai para a venda', async () => {
    useCaixa.setState({
      sessao: {
        id: 'sessao-1',
        terminalId: 't1',
        fundoTrocoCentavos: 0,
        abertaEm: '2026-08-31T10:00:00.000Z',
        saldoEsperadoCentavos: 0,
      },
      jaConsultou: true,
    });

    montar('/produto/p1');
    await screen.findByText('6 em estoque');

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar à venda' }));

    const itens = useCarrinho.getState().carrinho.itens;
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ varianteId: 'b', cor: 'Preto', tamanho: 'GG' });
    expect(await screen.findByText('tela de venda')).toBeVisible();
  });

  it('aceita o id de uma VARIANTE na URL, não só o do produto', async () => {
    // A tela de venda trabalha com variantes; um link colado de lá não pode
    // dar "não encontrado" por uma diferença que a operadora não vê.
    montar('/produto/c');

    expect(await screen.findByRole('heading', { name: 'Conjunto Renda' })).toBeVisible();
  });

  it('produto ausente explica que a consulta usa o catálogo baixado', async () => {
    montar('/produto/nao-existe');

    expect(await screen.findByText(/Produto não encontrado neste caixa/)).toBeVisible();
    expect(screen.getByText(/pode ainda não ter sincronizado/)).toBeVisible();
  });

  it('a prévia avisa que não é foto do produto', async () => {
    // Sem esse aviso a operadora pode descrever para a cliente um modelo que
    // não existe, confiando numa imagem que só indica a cor.
    montar('/produto/p1');
    await screen.findByText('6 em estoque');

    expect(screen.getByText(/Não é foto do produto/)).toBeVisible();
  });

  it('sem WebGL a prévia cai no palco estático, não em erro', async () => {
    // jsdom não tem WebGL: é exatamente o caso do mini-PC com driver antigo.
    montar('/produto/p1');
    await screen.findByText('6 em estoque');

    expect(screen.getByRole('img', { name: /Prévia abstrata de Conjunto Renda/ })).toBeVisible();
  });
});

describe('TelaProduto — produto sem variação', () => {
  it('perfume não mostra seletor de cor nem de tamanho', async () => {
    await semearCatalogo([
      variante({
        id: 'x',
        produtoId: 'p9',
        nome: 'Perfume Sedução',
        categoria: 'Perfumaria',
        cor: null,
        tamanho: null,
        saldoEstoque: 12,
      }),
    ]);

    montar('/produto/p9');
    await screen.findByText('12 em estoque');

    expect(screen.queryByRole('button', { name: /Tamanho/ })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /representada como frasco/ })).toBeVisible();
  });
});
