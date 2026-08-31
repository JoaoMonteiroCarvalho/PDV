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

  /*
   * Categorias REAIS da loja, não um rótulo genérico. A categoria decide duas
   * coisas de negócio que os testes precisam exercitar: o termo discreto que
   * vai ao comprovante e se a venda exige confirmação da política de troca
   * por higiene. Com "Categoria E2E" nenhum dos dois caminhos aparecia.
   */
  const categoria = await prisma.categoria.create({ data: { nome: 'Vestuario' } });
  const categoriaIntima = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const categoriaPerfumaria = await prisma.categoria.create({ data: { nome: 'Perfumaria' } });
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

  /*
   * Produto com GRADE de verdade, para o E2E da tela de venda.
   *
   * A grade é montada com um buraco deliberado: Vinho/GG não existe. Sem esse
   * buraco o teste não conseguiria distinguir "esgotado" de "a loja não vende
   * essa combinação" — que é justamente a diferença que a operadora precisa
   * enxergar para não prometer reposição de algo que nunca vai chegar.
   *
   *          P        GG
   *  Preto   5        0 (esgotado)
   *  Vinho   3        — (não existe)
   */
  const produtoGrade = await prisma.produto.create({
    data: { nome: DADOS_E2E.produtoComGrade.nome, categoriaId: categoriaIntima.id },
  });
  const combinacoes = [
    { tamanho: 'P', cor: 'Preto', saldo: 5 },
    { tamanho: 'GG', cor: 'Preto', saldo: 0 },
    { tamanho: 'P', cor: 'Vinho', saldo: 3 },
  ] as const;

  for (const combinacao of combinacoes) {
    const varianteGrade = await prisma.variante.create({
      data: {
        produtoId: produtoGrade.id,
        sku: `E2E-GRADE-${combinacao.tamanho}-${combinacao.cor.toUpperCase()}`,
        tamanho: combinacao.tamanho,
        cor: combinacao.cor,
        precoCentavos: DADOS_E2E.produtoComGrade.precoCentavos,
        custoCentavos: 3000,
      },
    });
    // Saldo zero fica SEM movimento: é o mesmo estado de uma peça que a loja
    // cadastrou e ainda não recebeu, e exercita o `?? 0` da rota do catálogo.
    if (combinacao.saldo > 0) {
      await prisma.movimentoEstoque.create({
        data: {
          varianteId: varianteGrade.id,
          tipo: 'ENTRADA_COMPRA',
          quantidade: combinacao.saldo,
          custoUnitarioCentavos: 3000,
          documentoTipo: 'CARGA_E2E',
          documentoId: 'seed-e2e',
        },
      });
    }
  }

  const produtoSimples = await prisma.produto.create({
    data: { nome: DADOS_E2E.produtoSemVariacao.nome, categoriaId: categoriaPerfumaria.id },
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
