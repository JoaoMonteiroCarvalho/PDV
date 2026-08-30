import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
// jsdom não tem IndexedDB. Sem isto, todo o banco local (Dexie — fila de
// vendas, catálogo) quebra em qualquer teste de componente que passe perto.
import 'fake-indexeddb/auto';

// jsdom também não implementa matchMedia (usado para "prefers-reduced-motion"
// na TelaApresentacao, e internamente pelo GSAP/ScrollTrigger). Sem isto,
// qualquer teste que renderize essa tela quebra antes mesmo de montar.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}

// Sem `test.globals: true` no vitest.config, o auto-cleanup do Testing
// Library não se registra sozinho — sem isto, o DOM de um teste vaza pro
// próximo e "getByRole" passa a encontrar elementos duplicados.
afterEach(() => {
  cleanup();
});
