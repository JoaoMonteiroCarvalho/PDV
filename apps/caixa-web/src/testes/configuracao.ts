import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Sem `test.globals: true` no vitest.config, o auto-cleanup do Testing
// Library não se registra sozinho — sem isto, o DOM de um teste vaza pro
// próximo e "getByRole" passa a encontrar elementos duplicados.
afterEach(() => {
  cleanup();
});
