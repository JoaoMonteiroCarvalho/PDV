/**
 * Dados fixos do seed de E2E — sem efeitos colaterais.
 *
 * Separado de `seed-e2e.ts` de propósito: aquele arquivo roda `main()` ao
 * ser importado (semeia o banco). Importar dados dele em `fixtures.ts`
 * disparava o seed de novo dentro do processo de teste, contra o banco
 * errado — daí este módulo puro.
 */

export const DADOS_E2E = {
  operador: { login: 'ana.e2e', senha: 'caixa123', nome: 'Ana E2E' },
  gerente: { login: 'bia.e2e', senha: 'gerente123', nome: 'Bia E2E' },
  terminal: { nome: 'Caixa E2E' },
  produto: { nome: 'Camiseta Teste E2E', sku: 'E2E-CAMISETA-M-AZUL', precoCentavos: 5000 },
  produtoSemVariacao: { nome: 'Perfume Teste E2E', sku: 'E2E-PERFUME', precoCentavos: 12000 },
} as const;
