import 'fake-indexeddb/auto';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteApi } from '../api/cliente.js';
import { bancoLocal, montarTermos, type ItemCatalogo } from '../banco/local.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';
import { TelaEstoque } from './TelaEstoque.js';

function variante(parcial: Partial<ItemCatalogo> & { id: string; sku: string }): ItemCatalogo {
  const base = {
    produtoId: 'p1',
    codigoBarras: null,
    nome: 'Conjunto Renda',
    marca: 'Intimi',
    categoria: 'Lingerie',
    tamanho: 'M',
    cor: 'Preto',
    precoCentavos: 8_990,
    ativo: true,
    saldoEstoque: 3,
    atualizadoEm: '2026-09-01T10:00:00.000Z',
    ...parcial,
  };
  return { ...base, termos: montarTermos(base) };
}

const CATALOGO = [
  variante({ id: 'v1', sku: 'CJ-REN-M-PRETO', codigoBarras: '7890000000017', saldoEstoque: 3 }),
  variante({ id: 'v2', sku: 'CJ-REN-GG-VINHO', cor: 'Vinho', tamanho: 'GG', saldoEstoque: 0 }),
  variante({ id: 'v3', sku: 'CJ-REN-P-NUDE', cor: 'Nude', tamanho: 'P', saldoEstoque: -2 }),
];

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe35260812345678000199550010000001231000001234" versao="4.00">
    <ide><nNF>1123</nNF><dhEmi>2026-08-15T14:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000199</CNPJ><xNome>Confeccoes Intimi</xNome></emit>
    <det nItem="1"><prod>
      <cProd>FORN-1</cProd><cEAN>7890000000017</cEAN><xProd>CJ RENDA PT M</xProd>
      <uCom>UN</uCom><qCom>12.0000</qCom><vUnCom>25.5000000000</vUnCom><vProd>306.00</vProd>
    </prod></det>
    <det nItem="2"><prod>
      <cProd>DESCONHECIDO-9</cProd><cEAN>SEM GTIN</cEAN><xProd>PECA NOVA</xProd>
      <uCom>UN</uCom><qCom>4.0000</qCom><vUnCom>10.0000000000</vUnCom><vProd>40.00</vProd>
    </prod></det>
  </infNFe></NFe>
</nfeProc>`;

function montar() {
  return render(
    <MemoryRouter>
      <TelaEstoque />
    </MemoryRouter>,
  );
}

/** Entrega o XML ao input de arquivo, como a operadora faria. */
async function enviarXml(conteudo = XML, nome = 'nota.xml') {
  const arquivo = new File([conteudo], nome, { type: 'text/xml' });
  await userEvent.upload(screen.getByLabelText('Arquivo XML da nota fiscal'), arquivo);
}

beforeEach(async () => {
  await bancoLocal.catalogo.clear();
  await bancoLocal.catalogo.bulkPut(CATALOGO);
  vi.spyOn(motorSincronizacao, 'sincronizarCatalogo').mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TelaEstoque — lista', () => {
  it('mostra o que a loja tem, do menor saldo para o maior', async () => {
    // Menor saldo primeiro: é o que precisa repor, e a razão de abrir a tela.
    montar();

    const itens = await screen.findAllByRole('listitem');
    expect(itens).toHaveLength(3);
    expect(itens[0]).toHaveTextContent('CJ-REN-P-NUDE');
  });

  it('saldo negativo aparece como negativo, pedindo conferência', async () => {
    /*
     * Significa que vendeu mais do que o cadastro diz existir. Esconder isso
     * tiraria da loja o único sinal de que aquele produto precisa de olhada.
     */
    montar();
    expect(await screen.findByText('-2 — conferir')).toBeVisible();
  });

  it('esgotado é dito em palavra, não em zero solto', async () => {
    montar();
    expect(await screen.findByText('esgotado')).toBeVisible();
  });

  it('filtra por nome ou SKU', async () => {
    montar();
    await screen.findAllByRole('listitem');

    await userEvent.type(screen.getByLabelText('Filtrar'), 'GG-VINHO');

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });
});

describe('TelaEstoque — leitura do XML', () => {
  it('lê a nota e concilia o que reconhece', async () => {
    montar();
    await screen.findAllByRole('listitem');
    await enviarXml();

    expect(await screen.findByText(/Nota 1123 — Confeccoes Intimi/)).toBeVisible();
    expect(screen.getByText('código de barras')).toBeVisible();
  });

  it('avisa o que não reconheceu, sem travar o resto', async () => {
    /*
     * A mercadoria já está na loja: travar a nota inteira por um item novo
     * deixaria tudo fora do sistema até alguém cadastrar a peça.
     */
    montar();
    await screen.findAllByRole('listitem');
    await enviarXml();

    expect(await screen.findByText('não reconhecido')).toBeVisible();
    expect(screen.getByText(/não foi reconhecido/)).toBeVisible();
    // Os 12 do item reconhecido entram; os 4 do desconhecido, não.
    expect(screen.getByRole('button', { name: 'Dar entrada em 12 peças' })).toBeEnabled();
  });

  it('a operadora pode casar o item pendente na mão', async () => {
    montar();
    await screen.findAllByRole('listitem');
    await enviarXml();
    await screen.findByText('não reconhecido');

    await userEvent.selectOptions(screen.getByLabelText('Peça do item 2'), 'v2');

    expect(screen.getByText('escolhido na mão')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dar entrada em 16 peças' })).toBeEnabled();
  });

  it('a quantidade é editável — a nota nem sempre bate com a caixa', async () => {
    montar();
    await screen.findAllByRole('listitem');
    await enviarXml();
    await screen.findByText('código de barras');

    const campo = screen.getByLabelText('Quantidade do item 1');
    await userEvent.clear(campo);
    await userEvent.type(campo, '10');

    expect(screen.getByRole('button', { name: 'Dar entrada em 10 peças' })).toBeEnabled();
  });

  it('arquivo que não é NF-e explica o que enviar', async () => {
    montar();
    await screen.findAllByRole('listitem');
    await enviarXml('<?xml version="1.0"?><pedido><item/></pedido>', 'pedido.xml');

    expect(await screen.findByRole('alert')).toHaveTextContent(/veio com a mercadoria/);
  });

  it('XML quebrado não deixa a tela em branco', async () => {
    montar();
    await screen.findAllByRole('listitem');
    await enviarXml('<nfe><nao fecha>', 'lixo.xml');

    expect(await screen.findByRole('alert')).toHaveTextContent(/não é um XML válido/);
    expect(screen.getByText('O que tem na loja')).toBeVisible();
  });
});

describe('TelaEstoque — registro da entrada', () => {
  async function abrirNota() {
    montar();
    await screen.findAllByRole('listitem');
    await enviarXml();
    await screen.findByText('código de barras');
  }

  it('envia só as linhas conciliadas, com o custo da nota', async () => {
    const registrar = vi
      .spyOn(clienteApi, 'registrarEntradaEstoque')
      .mockResolvedValue({ movimentos: 1, pecas: 12 });
    await abrirNota();

    await userEvent.click(screen.getByRole('button', { name: 'Dar entrada em 12 peças' }));

    await waitFor(() => expect(registrar).toHaveBeenCalledTimes(1));
    expect(registrar.mock.calls[0]![0]).toMatchObject({
      itens: [{ varianteId: 'v1', quantidade: 12, custoUnitarioCentavos: 2_550 }],
      // A chave identifica a nota sem ambiguidade — é ela que trava a duplicata.
      documento: '35260812345678000199550010000001231000001234',
    });
  });

  it('confirma quantas peças entraram', async () => {
    vi.spyOn(clienteApi, 'registrarEntradaEstoque').mockResolvedValue({ movimentos: 1, pecas: 12 });
    await abrirNota();

    await userEvent.click(screen.getByRole('button', { name: 'Dar entrada em 12 peças' }));

    expect(await screen.findByText('Entrada registrada')).toBeVisible();
    expect(screen.getByText('12 peças')).toBeVisible();
  });

  it('nota repetida mostra a recusa do servidor, não finge sucesso', async () => {
    vi.spyOn(clienteApi, 'registrarEntradaEstoque').mockRejectedValue(
      new Error('A nota NF-1123 já teve entrada registrada. Lançar de novo dobraria o estoque.'),
    );
    await abrirNota();

    await userEvent.click(screen.getByRole('button', { name: 'Dar entrada em 12 peças' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/já teve entrada registrada/),
    );
    expect(screen.queryByText('Entrada registrada')).not.toBeInTheDocument();
  });

  it('sem nenhum item reconhecido, não deixa dar entrada', async () => {
    await bancoLocal.catalogo.clear();
    montar();
    await enviarXml();

    await waitFor(() => expect(screen.getByText(/Nota 1123/)).toBeVisible());
    expect(screen.getByRole('button', { name: /Dar entrada em 0 peças/ })).toBeDisabled();
    expect(screen.getByText(/Nenhum item reconhecido ainda/)).toBeVisible();
  });
});
