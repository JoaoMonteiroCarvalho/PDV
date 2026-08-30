import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TelaApresentacao } from './TelaApresentacao.js';

describe('TelaApresentacao', () => {
  it('mostra a manchete e chama aoEntrar ao clicar em Entrar', async () => {
    const usuario = userEvent.setup();
    const aoEntrar = vi.fn();
    render(<TelaApresentacao aoEntrar={aoEntrar} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Seu caixa/);

    await usuario.click(screen.getAllByRole('button', { name: /Entrar/ })[0]!);
    expect(aoEntrar).toHaveBeenCalled();
  });

  it('sem WebGL (jsdom), mostra a forma estática em vez do canvas 3D', () => {
    render(<TelaApresentacao aoEntrar={vi.fn()} />);
    // jsdom não implementa WebGL — o componente detecta isso e usa o
    // fallback estático, nunca tenta montar o Canvas do react-three-fiber.
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
  });

  it('lista os recursos reais do sistema, não texto genérico', () => {
    render(<TelaApresentacao aoEntrar={vi.fn()} />);
    expect(screen.getByText(/Frente de caixa sem mouse/)).toBeInTheDocument();
    expect(screen.getByText(/Crediário sem planilha/)).toBeInTheDocument();
  });
});
