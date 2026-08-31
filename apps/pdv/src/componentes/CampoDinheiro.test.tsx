/**
 * O campo monetário é onde erro de digitação vira erro de dinheiro. Estes
 * testes cobrem o que a operadora realmente faz: digitar rápido, errar,
 * apagar, colar valor de outro lugar.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CampoDinheiro, aplicarTecla, digitosParaCentavos } from './CampoDinheiro.js';

describe('aplicarTecla()', () => {
  it('dígito entra pela direita, como numa maquininha', () => {
    expect(aplicarTecla(0, '1')).toBe(1);
    expect(aplicarTecla(1, '2')).toBe(12);
    expect(aplicarTecla(12, '5')).toBe(125);
    expect(aplicarTecla(125, '0')).toBe(1250);
  });

  it('apagar tira o último dígito, não o campo inteiro', () => {
    expect(aplicarTecla(1250, 'Backspace')).toBe(125);
    expect(aplicarTecla(1, 'Backspace')).toBe(0);
    expect(aplicarTecla(0, 'Backspace')).toBe(0);
  });

  it('devolve null para tecla que não é dela — Tab e setas seguem o caminho normal', () => {
    expect(aplicarTecla(100, 'Tab')).toBeNull();
    expect(aplicarTecla(100, 'ArrowLeft')).toBeNull();
    expect(aplicarTecla(100, 'Enter')).toBeNull();
    expect(aplicarTecla(100, ',')).toBeNull();
  });

  it('ignora a tecla que estouraria o limite, em vez de truncar calado', () => {
    const quaseNoTeto = 9_999_999_999_999;
    expect(aplicarTecla(quaseNoTeto, '9')).toBe(quaseNoTeto);
    expect(Number.isSafeInteger(aplicarTecla(quaseNoTeto, '9')!)).toBe(true);
  });
});

describe('digitosParaCentavos()', () => {
  it('lê a digitação como centavos, no padrão de maquininha', () => {
    expect(digitosParaCentavos('1250')).toBe(1250);
    expect(digitosParaCentavos('5')).toBe(5);
    expect(digitosParaCentavos('100000')).toBe(100_000);
  });

  it('ignora tudo que não é dígito, inclusive o que ele mesmo formatou', () => {
    // O campo mostra "1.250,00" e devolve esse texto no onChange.
    expect(digitosParaCentavos('1.250,00')).toBe(125_000);
    expect(digitosParaCentavos('R$ 12,50')).toBe(1250);
  });

  it('campo vazio é zero, não NaN', () => {
    expect(digitosParaCentavos('')).toBe(0);
    expect(digitosParaCentavos('abc')).toBe(0);
  });

  it('zeros à esquerda não fazem o valor crescer', () => {
    expect(digitosParaCentavos('000')).toBe(0);
    expect(digitosParaCentavos('0012')).toBe(12);
  });

  it('valor absurdamente longo não vira Infinity nem perde precisão', () => {
    const resultado = digitosParaCentavos('9'.repeat(40));
    expect(Number.isFinite(resultado)).toBe(true);
    expect(Number.isSafeInteger(resultado)).toBe(true);
  });
});

function CampoControlado({ inicial = 0 }: { inicial?: number }) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <CampoDinheiro rotulo="Fundo de troco" valorCentavos={valor} aoMudar={setValor} />
      <output data-testid="centavos">{valor}</output>
    </>
  );
}

describe('CampoDinheiro', () => {
  it('mostra o valor formatado enquanto a operadora digita', async () => {
    const usuario = userEvent.setup();
    render(<CampoControlado />);
    const campo = screen.getByLabelText('Fundo de troco');

    await usuario.type(campo, '20000');

    // Digitou "20000" -> R$ 200,00. O engano de casa decimal aparece na hora.
    expect(campo).toHaveValue('200,00');
    expect(screen.getByTestId('centavos')).toHaveTextContent('20000');
  });

  it('começa em zero formatado, nunca vazio ou NaN', () => {
    render(<CampoControlado />);
    expect(screen.getByLabelText('Fundo de troco')).toHaveValue('0,00');
  });

  it('apagar tudo volta a zero sem quebrar', async () => {
    const usuario = userEvent.setup();
    render(<CampoControlado inicial={5000} />);
    const campo = screen.getByLabelText('Fundo de troco');

    await usuario.clear(campo);

    expect(screen.getByTestId('centavos')).toHaveTextContent('0');
    expect(campo).toHaveValue('0,00');
  });

  it('entrega centavos inteiros ao pai, nunca float', async () => {
    const usuario = userEvent.setup();
    const aoMudar = vi.fn();
    render(<CampoDinheiro rotulo="Valor" valorCentavos={0} aoMudar={aoMudar} />);

    await usuario.type(screen.getByLabelText('Valor'), '1');

    const recebido = aoMudar.mock.calls.at(-1)?.[0];
    expect(Number.isInteger(recebido)).toBe(true);
  });

  it('o valor não depende de onde o cursor está', async () => {
    /*
     * Regressão real, achada no E2E da tela de venda: com o cursor no início
     * de "0,00", digitar "4" dava R$ 40,00; com o cursor no fim, R$ 0,04. A
     * operadora clica no meio do número o tempo todo.
     */
    const usuario = userEvent.setup();
    render(<CampoControlado />);
    const campo = screen.getByLabelText<HTMLInputElement>('Fundo de troco');

    campo.focus();
    campo.setSelectionRange(0, 0); // cursor no começo, de propósito
    await usuario.keyboard('4000');

    expect(screen.getByTestId('centavos')).toHaveTextContent('4000');
    expect(campo).toHaveValue('40,00');
  });

  it('apagar volta um dígito por vez, não zera o campo', async () => {
    const usuario = userEvent.setup();
    render(<CampoControlado inicial={12_345} />);
    const campo = screen.getByLabelText('Fundo de troco');

    await usuario.click(campo);
    await usuario.keyboard('{Backspace}');

    expect(campo).toHaveValue('12,34');
  });

  it('associa o erro ao campo para leitor de tela', () => {
    render(
      <CampoDinheiro rotulo="Valor" valorCentavos={0} aoMudar={() => {}} erro="Informe um valor" />,
    );
    expect(screen.getByLabelText('Valor')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Informe um valor')).toBeVisible();
  });
});
