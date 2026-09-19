/**
 * O estado de conexão é um requisito não negociável da operação: precisa
 * estar sempre visível e SEMPRE em palavras.
 *
 * Estes testes travam esse contrato. Se alguém trocar o texto por um ícone
 * "para economizar espaço", eles quebram — que é exatamente a intenção.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

/**
 * Os selos de pendência são links para `/pendencias` — sem contexto de rota o
 * React Router lança antes de qualquer asserção acontecer.
 */
function renderizar(): void {
  render(
    <MemoryRouter>
      <IndicadorConexao />
    </MemoryRouter>,
  );
}

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
  vi.restoreAllMocks();
});

describe('IndicadorConexao', () => {
  it('diz "Online" em palavras, não só por cor ou ícone', () => {
    definirEstado({ online: true });
    renderizar();
    expect(screen.getByText('Online')).toBeVisible();
  });

  it('offline avisa que a venda continua possível — não é erro', () => {
    // Estar online vem do NAVEGADOR, nao do motor: o indicador precisa
    // acertar mesmo antes de o motor de sincronizacao subir.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    definirEstado({ online: false });
    renderizar();
    // A operadora não pode achar que o caixa parou.
    expect(screen.getByText(/vendendo normalmente/i)).toBeVisible();
  });

  it('acerta o estado offline mesmo sem o motor ter iniciado', () => {
    // Cenario da corrida real: tela montada, motor ainda subindo, rede caida.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    estadoAtual.valor = null; // motor nunca emitiu nada
    renderizar();
    expect(screen.getByText(/vendendo normalmente/i)).toBeVisible();
  });

  it('mostra quantas vendas aguardam envio, com o número exato', () => {
    definirEstado({ online: true, pendentes: 3 });
    renderizar();
    expect(screen.getByText(/3 vendas aguardando envio/i)).toBeVisible();
  });

  it('usa singular quando há uma só venda pendente', () => {
    definirEstado({ online: true, pendentes: 1 });
    renderizar();
    expect(screen.getByText(/1 venda aguardando envio/i)).toBeVisible();
  });

  it('não polui a barra quando não há nada pendente', () => {
    definirEstado({ online: true, pendentes: 0, bloqueadas: 0 });
    renderizar();
    expect(screen.queryByText(/aguardando envio/i)).toBeNull();
    expect(screen.queryByText(/chame o gerente/i)).toBeNull();
  });

  it('venda bloqueada diz o que fazer, não só que deu errado', () => {
    definirEstado({ online: true, bloqueadas: 2 });
    renderizar();
    expect(screen.getByText(/2 com problema — chame o gerente/i)).toBeVisible();
  });

  it('o aviso leva à tela de pendências — avisar sem dar saída não resolve', () => {
    definirEstado({ online: true, bloqueadas: 2 });
    renderizar();
    expect(screen.getByRole('link', { name: /chame o gerente/i })).toHaveAttribute(
      'href',
      '/pendencias',
    );
  });

  it('sinaliza sincronização em andamento', () => {
    definirEstado({ online: true, sincronizando: true });
    renderizar();
    expect(screen.getByText('Sincronizando')).toBeVisible();
  });
});
