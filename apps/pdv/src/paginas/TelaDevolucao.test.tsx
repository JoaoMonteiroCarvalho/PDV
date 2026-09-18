/**
 * Testes da tela de devolução, com foco no que a auditoria apontou como o
 * ponto frágil do sistema: a autorização de gerente.
 *
 * O que estes testes travam: a tela NUNCA manda o id da gerente como prova de
 * autorização — ela repassa o token assinado que o servidor emitiu. O desenho
 * anterior mandava só o UUID, e qualquer operador que soubesse esse UUID
 * (visível em `GET /usuarios`) conseguia registrar uma devolução "autorizada"
 * montando a requisição à mão. Ver `autorizacao.ts` na API.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroApi, clienteApi, type Operador } from '../api/cliente.js';
import { useCaixa } from '../estado/caixaStore.js';
import { TelaDevolucao } from './TelaDevolucao.js';

const SESSAO = {
  id: 'sessao-1',
  terminalId: 't1',
  fundoTrocoCentavos: 20_000,
  abertaEm: '2026-09-01T09:00:00.000Z',
  saldoEsperadoCentavos: 50_000,
};

const GERENTE: Operador = {
  id: 'ger-1',
  nome: 'Bia Martins',
  papel: 'GERENTE',
  limiteDescontoBps: 3_000,
};

/** Token opaco para a tela: ela só o repassa, quem valida é o servidor. */
const TOKEN_AUTORIZACAO = 'token-de-autorizacao-assinado';

const VENDA = { id: 'venda-1', numero: 42, totalCentavos: 8990, registradaEm: '2026-09-01T10:00:00.000Z' };

const ITEM = {
  itemVendaId: 'item-1',
  varianteId: 'var-1',
  descricao: 'Camisola Seda',
  sku: 'CAM-001-P-ROSA',
  quantidadeVendida: 2,
  quantidadeJaDevolvida: 0,
  precoUnitarioLiquidoCentavos: 4495,
};

function montar() {
  return render(
    <MemoryRouter initialEntries={['/devolucao']}>
      <Routes>
        <Route path="/devolucao" element={<TelaDevolucao />} />
        <Route path="/venda" element={<p>tela de venda</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Passo 1: localizar a venda, para chegar ao formulário de devolução. */
async function localizarVenda() {
  vi.spyOn(clienteApi, 'buscarVendaPorNumero').mockResolvedValue(VENDA);
  vi.spyOn(clienteApi, 'buscarDisponivelParaDevolucao').mockResolvedValue({
    vendaId: VENDA.id,
    itens: [ITEM],
  });

  await userEvent.type(screen.getByLabelText('Número ou código da venda'), '42');
  await userEvent.click(screen.getByRole('button', { name: 'Buscar venda' }));
  await screen.findByText(ITEM.descricao);
}

async function autorizarComoGerente() {
  await userEvent.type(screen.getByLabelText('Login do gerente'), 'bia');
  await userEvent.type(screen.getByLabelText('Senha do gerente'), 'gerente123');
  await userEvent.click(screen.getByRole('button', { name: 'Autorizar' }));
}

beforeEach(() => {
  useCaixa.setState({ sessao: SESSAO, jaConsultou: true, erro: null, carregando: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TelaDevolucao — autorização de gerente', () => {
  it('manda o TOKEN assinado, nunca o id da gerente, ao registrar', async () => {
    const registrar = vi
      .spyOn(clienteApi, 'registrarDevolucao')
      .mockResolvedValue({ cancelamentoId: 'canc-1', totalCentavos: 4495 });
    vi.spyOn(clienteApi, 'entrarSemTrocarSessao').mockResolvedValue({
      operador: GERENTE,
      tokenAutorizacao: TOKEN_AUTORIZACAO,
    });

    montar();
    await localizarVenda();

    await userEvent.click(screen.getByLabelText(`Aumentar quantidade de ${ITEM.descricao}`));
    await userEvent.type(screen.getByPlaceholderText('Ex.: peça com defeito'), 'Peça com defeito');
    await autorizarComoGerente();
    await screen.findByText('Autorizado');

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar devolução' }));

    await waitFor(() => expect(registrar).toHaveBeenCalled());
    const [, corpo] = registrar.mock.calls[0]!;
    expect(corpo.tokenAutorizacao).toBe(TOKEN_AUTORIZACAO);
    // O id da gerente não é prova de nada e não deve viajar como autorização.
    expect(JSON.stringify(corpo)).not.toContain(GERENTE.id);
  });

  it('sem autorização, o botão de confirmar continua travado', async () => {
    montar();
    await localizarVenda();

    await userEvent.click(screen.getByLabelText(`Aumentar quantidade de ${ITEM.descricao}`));
    await userEvent.type(screen.getByPlaceholderText('Ex.: peça com defeito'), 'Peça com defeito');

    // Itens marcados e motivo preenchido não bastam: falta a gerente.
    expect(screen.getByRole('button', { name: 'Confirmar devolução' })).toBeDisabled();
  });

  it('operador comum recusado pelo servidor aparece como erro, sem liberar a tela', async () => {
    // O servidor recusa em /sessao/autorizar quem não tem alçada — a tela
    // nunca chega a receber um token.
    vi.spyOn(clienteApi, 'entrarSemTrocarSessao').mockRejectedValue(
      new ErroApi(
        403,
        'AUTORIZADOR_SEM_PERMISSAO',
        'Esta pessoa não tem perfil de gerente para autorizar a operação.',
      ),
    );

    montar();
    await localizarVenda();
    await userEvent.click(screen.getByLabelText(`Aumentar quantidade de ${ITEM.descricao}`));
    await userEvent.type(screen.getByPlaceholderText('Ex.: peça com defeito'), 'Peça com defeito');
    await autorizarComoGerente();

    expect(await screen.findByText(/não tem perfil de gerente/i)).toBeVisible();
    expect(screen.queryByText('Autorizado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar devolução' })).toBeDisabled();
  });

  it('trocar de gerente trava a tela de novo — token não fica pendurado', async () => {
    vi.spyOn(clienteApi, 'entrarSemTrocarSessao').mockResolvedValue({
      operador: GERENTE,
      tokenAutorizacao: TOKEN_AUTORIZACAO,
    });

    montar();
    await localizarVenda();
    await userEvent.click(screen.getByLabelText(`Aumentar quantidade de ${ITEM.descricao}`));
    await userEvent.type(screen.getByPlaceholderText('Ex.: peça com defeito'), 'Peça com defeito');
    await autorizarComoGerente();
    await screen.findByText('Autorizado');

    await userEvent.click(screen.getByRole('button', { name: 'Trocar' }));

    expect(screen.getByRole('button', { name: 'Confirmar devolução' })).toBeDisabled();
  });
});
