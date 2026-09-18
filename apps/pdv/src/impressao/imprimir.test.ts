/**
 * Testes de `imprimirComprovante` — o que dá para verificar sem impressora
 * física: o HTML gerado é válido, escapa conteúdo hostil, cai para download
 * quando o pop-up é bloqueado, e o CSS de página declara o que o comprovante
 * espera (80mm, fonte monoespaçada, largura de 48 colunas em `comprovante.ts`).
 *
 * O que ISTO NÃO PROVA: se uma impressora térmica real aceita o que sai daqui.
 * `window.print()` delega a decisão de tamanho de papel ao driver do sistema
 * operacional — o `@page { size: 80mm }` é um pedido, não uma garantia, e o
 * comportamento do Chromium com tamanhos em mm tem casos documentados de
 * inconsistência entre impressão interativa e geração de PDF headless. Ver
 * `CHECKLIST-IMPRESSAO-TERMICA.md` para o que só um teste com hardware real
 * resolve.
 */

import { describe, expect, it, vi } from 'vitest';
import { calcularVenda, deReais, type ItemEntrada } from '@pdv/shared';
import { imprimirComprovante } from './imprimir.js';
import type { DadosComprovante, DadosLoja } from './comprovante.js';

const LOJA: DadosLoja = { nome: 'Loja Teste' };

const itens: ItemEntrada[] = [
  {
    varianteId: 'a',
    quantidade: 1,
    precoUnitarioCentavos: deReais('50,00'),
    descontoCentavos: deReais('0'),
  },
];
const venda = calcularVenda(itens, deReais('0'));

const dados: DadosComprovante = {
  numero: 1,
  vendaId: 'abc12345-0000-0000-0000-000000000000',
  momento: new Date(2026, 0, 1, 12, 0),
  operador: 'Teste',
  itens: [
    {
      descricao: 'Produto Teste',
      categoria: null,
      tamanho: null,
      cor: null,
      quantidade: 1,
      precoUnitarioCentavos: 5000,
      totalCentavos: 5000,
    },
  ],
  pagamentos: [{ forma: 'DINHEIRO', valorCentavos: 5000, trocoCentavos: 0 }],
};

/**
 * Fábrica mínima de uma `Window` falsa: só o que `imprimirComprovante` usa.
 * `document.write` guarda o HTML recebido para inspeção.
 */
function janelaFalsa() {
  let htmlEscrito = '';
  const documento = {
    write: vi.fn((html: string) => {
      htmlEscrito = html;
    }),
    close: vi.fn(),
  };
  const janela = {
    document: documento,
    focus: vi.fn(),
    print: vi.fn(),
  };
  return { janela, obterHtml: () => htmlEscrito };
}

describe('imprimirComprovante', () => {
  it('abre a janela com o texto do comprovante dentro de um <pre>', () => {
    const { janela, obterHtml } = janelaFalsa();
    vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);

    imprimirComprovante(venda, dados, LOJA);

    const html = obterHtml();
    expect(html).toContain('<pre>');
    expect(html).toContain('Produto Teste' === 'Produto Teste' ? 'COMPROVANTE DE VENDA' : '');
    expect(janela.focus).toHaveBeenCalled();
    expect(janela.print).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('declara @page em 80mm — o pedido que o driver da impressora recebe', () => {
    const { janela, obterHtml } = janelaFalsa();
    vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);

    imprimirComprovante(venda, dados, LOJA);

    // Isto prova que o CSS PEDE 80mm — não prova que a impressora obedece.
    // window.print() delega a decisão final ao driver do SO; ver o checklist
    // de hardware para a validação que só uma impressora física resolve.
    expect(obterHtml()).toContain('@page { size: 80mm auto');

    vi.restoreAllMocks();
  });

  it('usa fonte monoespaçada — as colunas de comprovante.ts só alinham nela', () => {
    const { janela, obterHtml } = janelaFalsa();
    vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);

    imprimirComprovante(venda, dados, LOJA);

    // "Courier New" é o nome que a maioria dos drivers Windows expõe; sem
    // fonte monoespaçada, o preenchimento por espaço de `duasColunas()` em
    // comprovante.ts desalinha preço e rótulo no papel.
    expect(obterHtml()).toMatch(/font-family:\s*"Courier New"/);

    vi.restoreAllMocks();
  });

  it('escapa HTML do conteúdo — nome de produto não pode injetar marcação', () => {
    const { janela, obterHtml } = janelaFalsa();
    vi.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);

    const dadosComTagNoNome: DadosComprovante = {
      ...dados,
      itens: [{ ...dados.itens[0]!, descricao: '<script>alert(1)</script>' }],
      discricao: 'completo',
    };

    imprimirComprovante(venda, dadosComTagNoNome, LOJA);

    const html = obterHtml();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');

    vi.restoreAllMocks();
  });

  it('pop-up bloqueado (window.open devolve null): cai para download, não falha', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const criarObjectURL = vi.fn(() => 'blob:teste');
    const revogarObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: criarObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revogarObjectURL, configurable: true });

    const cliqueSimulado = vi.fn();
    const linkOriginal = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const elemento = linkOriginal(tag);
      if (tag === 'a') elemento.click = cliqueSimulado;
      return elemento;
    });

    /*
     * A venda JÁ ESTÁ gravada e enfileirada quando isto roda — um pop-up
     * bloqueado não pode impedir a operadora de seguir vendendo. O teste
     * verifica que o caminho de download é acionado, não que a impressão
     * "funcionou": sem impressora real não há como provar isso.
     */
    expect(() => imprimirComprovante(venda, dados, LOJA)).not.toThrow();
    expect(criarObjectURL).toHaveBeenCalled();
    expect(cliqueSimulado).toHaveBeenCalled();
    expect(revogarObjectURL).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
