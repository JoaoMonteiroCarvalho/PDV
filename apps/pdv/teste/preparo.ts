/**
 * Preparo do ambiente de teste de componente.
 *
 * `jest-dom` adiciona asserções que descrevem o que a operadora veria
 * (`toBeVisible`, `toBeDisabled`) em vez de detalhes de implementação.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sem isto, um componente montado num teste vaza para o seguinte e as
// asserções passam a encontrar dois elementos com o mesmo texto.
afterEach(() => {
  cleanup();
});
