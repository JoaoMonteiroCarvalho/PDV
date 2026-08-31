/**
 * A decisão de renderizar 3D é o ponto onde o app respeita duas coisas
 * diferentes: o que a máquina aguenta e o que a operadora quer.
 *
 * Um erro aqui não é cosmético — é a tela de login não abrir num mini-PC sem
 * WebGL, ou o 3D voltar sozinho depois de alguém desligar para ganhar
 * velocidade.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  definirEfeitos3d,
  efeitos3dLigados,
  limparCacheWebgl,
  podeRenderizar3d,
  webglDisponivel,
} from './capacidade.js';

beforeEach(() => {
  localStorage.clear();
  limparCacheWebgl();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webglDisponivel()', () => {
  it('detecta suporte quando o contexto é criado', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    expect(webglDisponivel()).toBe(true);
  });

  it('não quebra quando o navegador BLOQUEIA o WebGL lançando exceção', () => {
    // Alguns navegadores lançam em vez de devolver null quando o WebGL está
    // desabilitado por política. Sem o try/catch, a tela de login inteira caía.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('WebGL bloqueado por política');
    });
    expect(webglDisponivel()).toBe(false);
  });

  it('trata ausência de contexto como "não suportado"', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(webglDisponivel()).toBe(false);
  });

  it('consulta o navegador uma vez só e reaproveita o resultado', () => {
    const espiao = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as never);

    webglDisponivel();
    webglDisponivel();
    webglDisponivel();

    // Criar canvas a cada render para testar WebGL seria caro à toa.
    expect(espiao).toHaveBeenCalledTimes(1);
  });
});

describe('interruptor de efeitos 3D', () => {
  it('vem ligado por padrão', () => {
    expect(efeitos3dLigados()).toBe(true);
  });

  it('desligar persiste entre sessões', () => {
    definirEfeitos3d(false);
    expect(efeitos3dLigados()).toBe(false);
  });

  it('religar volta ao normal', () => {
    definirEfeitos3d(false);
    definirEfeitos3d(true);
    expect(efeitos3dLigados()).toBe(true);
  });
});

describe('podeRenderizar3d()', () => {
  it('exige as duas condições: máquina capaz E operadora querendo', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    expect(podeRenderizar3d()).toBe(true);
  });

  it('não renderiza quando a operadora desligou, mesmo com WebGL disponível', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    definirEfeitos3d(false);
    // Quem prefere velocidade a estética tem a palavra final.
    expect(podeRenderizar3d()).toBe(false);
  });

  it('não renderiza sem WebGL, mesmo com o interruptor ligado', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    definirEfeitos3d(true);
    expect(podeRenderizar3d()).toBe(false);
  });
});
