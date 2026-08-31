/**
 * O estado de conexão é um requisito não negociável da operação: precisa
 * estar sempre visível e SEMPRE em palavras.
 *
 * Estes testes travam esse contrato. Se alguém trocar o texto por um ícone
 * "para economizar espaço", eles quebram — que é exatamente a intenção.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoSincronizacao } from '../sincronizacao/motor.js';

const estadoAtual = { valor: null as EstadoSincronizacao | null };

vi.mock('../sincronizacao/motorGlobal.js', () => ({
  motorSincronizacao: {
    aoMudar: (ouvinte: (estado: EstadoSincronizacao) => void) => {
      if (estadoAtual.valor) ouvinte(estadoAtual.valor);
      return () => undefined;
    },
  },
}));

const { IndicadorConexao } = await import('./IndicadorConexao.js');

function definirEstado(parcial: Partial<EstadoSincronizacao>): void {
  estadoAtual.valor = {
    online: true,
    pendentes: 0,
    bloqueadas: 0,
    sincronizando: false,
    ultimaSincronizacao: null,
    produtosLocais: 0,
    ...parcial,
  };
}

afterEach(() => {
  estadoAtual.valor = null;
});

describe('IndicadorConexao', () => {
  it('diz "Online" em palavras, não só por cor ou ícone', () => {
    definirEstado({ online: true });
    render(<IndicadorConexao />);
    expect(screen.getByText('Online')).toBeVisible();
  });

  it('offline avisa que a venda continua possível — não é erro', () => {
    definirEstado({ online: false });
    render(<IndicadorConexao />);
    // A operadora não pode achar que o caixa parou.
    expect(screen.getByText(/vendendo normalmente/i)).toBeVisible();
  });

  it('mostra quantas vendas aguardam envio, com o número exato', () => {
    definirEstado({ online: true, pendentes: 3 });
    render(<IndicadorConexao />);
    expect(screen.getByText(/3 vendas aguardando envio/i)).toBeVisible();
  });

  it('usa singular quando há uma só venda pendente', () => {
    definirEstado({ online: true, pendentes: 1 });
    render(<IndicadorConexao />);
    expect(screen.getByText(/1 venda aguardando envio/i)).toBeVisible();
  });

  it('não polui a barra quando não há nada pendente', () => {
    definirEstado({ online: true, pendentes: 0, bloqueadas: 0 });
    render(<IndicadorConexao />);
    expect(screen.queryByText(/aguardando envio/i)).toBeNull();
    expect(screen.queryByText(/chame o gerente/i)).toBeNull();
  });

  it('venda bloqueada diz o que fazer, não só que deu errado', () => {
    definirEstado({ online: true, bloqueadas: 2 });
    render(<IndicadorConexao />);
    expect(screen.getByText(/2 com problema — chame o gerente/i)).toBeVisible();
  });

  it('sinaliza sincronização em andamento', () => {
    definirEstado({ online: true, sincronizando: true });
    render(<IndicadorConexao />);
    expect(screen.getByText('Sincronizando')).toBeVisible();
  });
});
