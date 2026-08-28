/**
 * Seed do banco de E2E.
 *
 * Determinístico e mínimo, de propósito: os testes do Playwright afirmam
 * contra nomes e preços exatos ("Camiseta Teste E2E", R$ 50,00). Se este seed
 * usasse o catálogo grande de desenvolvimento, qualquer alteração de preço lá
 * quebraria os testes aqui sem relação nenhuma com um bug real.
 *
 * Roda ANTES da suíte (ver `globalSetup` no playwright.config.ts), sempre
 * limpando a base primeiro — cada execução do Playwright começa do zero.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarHashSenha } from '../apps/api/src/autenticacao.ts';
import { DADOS_E2E } from './dados.js';

config({ path: resolve(dirname(), '../.env') });

function dirname(): string {
  return fileURLToPath(new URL('.', import.meta.url));
}

if (!process.env.DATABASE_URL_E2E) {
  throw new Error('DATABASE_URL_E2E não definida — veja .env.example.');
}
if (process.env.DATABASE_URL_E2E === process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_E2E aponta para o banco de desenvolvimento. Isso apagaria dados reais.');
}
process.env.DATABASE_URL = process.env.DATABASE_URL_E2E;

const prisma = new PrismaClient();


async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

async function main(): Promise<void> {
  await limparBase();

  await prisma.usuario.create({
    data: {
      nome: DADOS_E2E.operador.nome,
      login: DADOS_E2E.operador.login,
      senhaHash: await gerarHashSenha(DADOS_E2E.operador.senha),
      papel: 'OPERADOR',
      limiteDescontoBps: 500,
    },
  });
  await prisma.usuario.create({
    data: {
      nome: DADOS_E2E.gerente.nome,
      login: DADOS_E2E.gerente.login,
      senhaHash: await gerarHashSenha(DADOS_E2E.gerente.senha),
      papel: 'GERENTE',
    },
  });

  const terminal = await prisma.terminal.create({ data: { nome: DADOS_E2E.terminal.nome } });

  const categoria = await prisma.categoria.create({ data: { nome: 'Categoria E2E' } });
  const produto = await prisma.produto.create({
    data: { nome: DADOS_E2E.produto.nome, categoriaId: categoria.id },
  });
  const variante = await prisma.variante.create({
    data: {
      produtoId: produto.id,
      sku: DADOS_E2E.produto.sku,
      tamanho: 'M',
      cor: 'Azul',
      precoCentavos: DADOS_E2E.produto.precoCentavos,
      custoCentavos: 2000,
    },
  });
  await prisma.movimentoEstoque.create({
    data: {
      varianteId: variante.id,
      tipo: 'ENTRADA_COMPRA',
      quantidade: 100,
      custoUnitarioCentavos: 2000,
      documentoTipo: 'CARGA_E2E',
      documentoId: 'seed-e2e',
    },
  });

  const produtoSimples = await prisma.produto.create({
    data: { nome: DADOS_E2E.produtoSemVariacao.nome, categoriaId: categoria.id },
  });
  const varianteSimples = await prisma.variante.create({
    data: {
      produtoId: produtoSimples.id,
      sku: DADOS_E2E.produtoSemVariacao.sku,
      precoCentavos: DADOS_E2E.produtoSemVariacao.precoCentavos,
      custoCentavos: 5000,
    },
  });
  await prisma.movimentoEstoque.create({
    data: {
      varianteId: varianteSimples.id,
      tipo: 'ENTRADA_COMPRA',
      quantidade: 50,
      custoUnitarioCentavos: 5000,
      documentoTipo: 'CARGA_E2E',
      documentoId: 'seed-e2e',
    },
  });

  // Grava o terminalId gerado para o globalSetup do Playwright poder ler:
  // a tela de "configurar terminal" pede o ID uma vez, e o teste precisa
  // saber qual colar — o valor é gerado pelo banco, não fixo no código.
  writeFileSync(
    resolve(dirname(), '.dados-seed.json'),
    JSON.stringify({ terminalId: terminal.id }, null, 2),
  );

  console.log(`Seed E2E pronto. terminalId=${terminal.id}`);
  await prisma.$disconnect();
}

main().catch((erro) => {
  console.error('Falha ao semear base de E2E:', erro);
  process.exit(1);
});
