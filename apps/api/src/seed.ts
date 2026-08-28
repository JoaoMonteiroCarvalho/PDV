/**
 * Carga inicial para desenvolvimento e demonstração.
 *
 * Reflete o mix real da loja: moda íntima como núcleo, mais pijama, moda
 * praia, perfumaria e sexshop. Serve para exercitar os dois formatos de
 * produto que o sistema precisa suportar ao mesmo tempo:
 *
 *   - peça de vestuário  -> várias variantes (tamanho × cor)
 *   - perfume / sexshop  -> uma variante só
 *
 * Idempotente: pode rodar quantas vezes quiser. O estoque inicial NÃO é um
 * campo — é lançado como movimento de ENTRADA_COMPRA no livro-razão, igual
 * a uma compra de verdade.
 *
 * Uso: npm run seed -w @pdv/api
 */

import { PrismaClient } from '@prisma/client';
import { gerarHashSenha } from './autenticacao.js';

const prisma = new PrismaClient();

interface ModeloProduto {
  readonly nome: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly prefixoSku: string;
  readonly precoCentavos: number;
  readonly custoCentavos: number;
  readonly tamanhos?: readonly string[];
  readonly cores?: readonly string[];
  readonly estoquePorVariante: number;
}

const CATEGORIAS = ['Lingerie', 'Pijamas', 'Moda Praia', 'Perfumaria', 'Sensual'] as const;

const PRODUTOS: readonly ModeloProduto[] = [
  {
    nome: 'Conjunto Renda Delicada',
    categoria: 'Lingerie',
    marca: 'Intimi',
    prefixoSku: 'CJ-REN',
    precoCentavos: 8990,
    custoCentavos: 3500,
    tamanhos: ['P', 'M', 'G', 'GG'],
    cores: ['Preto', 'Vermelho', 'Nude'],
    estoquePorVariante: 6,
  },
  {
    nome: 'Sutiã Push-up Microfibra',
    categoria: 'Lingerie',
    marca: 'Intimi',
    prefixoSku: 'SU-PUSH',
    precoCentavos: 6990,
    custoCentavos: 2600,
    tamanhos: ['38', '40', '42', '44', '46'],
    cores: ['Preto', 'Branco', 'Nude'],
    estoquePorVariante: 8,
  },
  {
    nome: 'Calcinha Fio Duplo Algodão',
    categoria: 'Lingerie',
    prefixoSku: 'CA-FIO',
    precoCentavos: 2490,
    custoCentavos: 890,
    tamanhos: ['P', 'M', 'G'],
    cores: ['Preto', 'Branco', 'Rosa', 'Nude'],
    estoquePorVariante: 15,
  },
  {
    nome: 'Pijama Cetim Manga Curta',
    categoria: 'Pijamas',
    marca: 'Noite Bela',
    prefixoSku: 'PJ-CET',
    precoCentavos: 12990,
    custoCentavos: 5400,
    tamanhos: ['P', 'M', 'G', 'GG'],
    cores: ['Vinho', 'Azul Marinho'],
    estoquePorVariante: 4,
  },
  {
    nome: 'Biquíni Cortininha',
    categoria: 'Moda Praia',
    prefixoSku: 'BQ-CORT',
    precoCentavos: 15990,
    custoCentavos: 6800,
    tamanhos: ['P', 'M', 'G'],
    cores: ['Preto', 'Estampado', 'Verde'],
    estoquePorVariante: 5,
  },
  {
    nome: 'Body Rendado Manga Longa',
    categoria: 'Sensual',
    prefixoSku: 'BD-REN',
    precoCentavos: 10990,
    custoCentavos: 4200,
    tamanhos: ['Único'],
    cores: ['Preto', 'Vermelho'],
    estoquePorVariante: 7,
  },
  // Produto simples: uma variante só, sem grade.
  {
    nome: 'Perfume Feminino Sedução 100ml',
    categoria: 'Perfumaria',
    marca: 'Essence',
    prefixoSku: 'PF-SED',
    precoCentavos: 18990,
    custoCentavos: 7900,
    estoquePorVariante: 12,
  },
  {
    nome: 'Óleo de Massagem Beijável 60ml',
    categoria: 'Sensual',
    prefixoSku: 'OL-MAS',
    precoCentavos: 3990,
    custoCentavos: 1400,
    estoquePorVariante: 20,
  },
];

function montarSku(prefixo: string, tamanho?: string, cor?: string): string {
  const partes = [prefixo];
  if (tamanho) partes.push(tamanho.toUpperCase().replace(/\s+/g, ''));
  if (cor) partes.push(cor.toUpperCase().replace(/\s+/g, '').slice(0, 6));
  return partes.join('-');
}

/** EAN-13 fictício e determinístico, só para o leitor de código de barras ter o que ler. */
function montarCodigoBarras(indice: number): string {
  const base = String(789_0000_00000 + indice).padStart(12, '0').slice(0, 12);
  const digitos = [...base].map(Number);
  const soma = digitos.reduce((total, digito, posicao) => total + digito * (posicao % 2 === 0 ? 1 : 3), 0);
  const verificador = (10 - (soma % 10)) % 10;
  return base + verificador;
}

async function main(): Promise<void> {
  console.log('Semeando base de desenvolvimento...');

  // --- Usuários ------------------------------------------------------------
  // Senhas fracas de propósito: base de DESENVOLVIMENTO. Em produção os
  // usuários são criados pelo administrador, nunca por seed.
  const [hashOperadora, hashGerente, hashAdmin] = await Promise.all([
    gerarHashSenha('caixa123'),
    gerarHashSenha('gerente123'),
    gerarHashSenha('admin123'),
  ]);

  const operadora = await prisma.usuario.upsert({
    where: { login: 'ana' },
    // Reescreve o hash: sem isso, um 'ana' preexistente com senha invalida
    // sobreviveria ao seed e o login falharia sem explicacao.
    update: { senhaHash: hashOperadora, limiteDescontoBps: 500, ativo: true },
    create: {
      nome: 'Ana Souza',
      login: 'ana',
      senhaHash: hashOperadora,
      papel: 'OPERADOR',
      // Concede até 5% sozinha; acima disso precisa de gerente.
      limiteDescontoBps: 500,
    },
  });

  const gerente = await prisma.usuario.upsert({
    where: { login: 'bia' },
    update: { senhaHash: hashGerente, papel: 'GERENTE', ativo: true },
    create: {
      nome: 'Bia Martins',
      login: 'bia',
      senhaHash: hashGerente,
      papel: 'GERENTE',
      limiteDescontoBps: 3000,
    },
  });

  await prisma.usuario.upsert({
    where: { login: 'admin' },
    update: { senhaHash: hashAdmin, papel: 'ADMIN', ativo: true },
    create: { nome: 'Administrador', login: 'admin', senhaHash: hashAdmin, papel: 'ADMIN', limiteDescontoBps: 10_000 },
  });

  // --- Terminal ------------------------------------------------------------
  const terminal = await prisma.terminal.upsert({
    where: { nome: 'Caixa 1' },
    update: {},
    create: { nome: 'Caixa 1' },
  });

  // --- Sessão de caixa aberta ---------------------------------------------
  // A tela de abertura de caixa é do próximo incremento. Até lá, o seed deixa
  // uma sessão aberta para o caixa ter onde lançar venda em desenvolvimento.
  let sessao = await prisma.sessaoCaixa.findFirst({
    where: { terminalId: terminal.id, status: 'ABERTA' },
  });
  if (!sessao) {
    sessao = await prisma.sessaoCaixa.create({
      data: {
        terminalId: terminal.id,
        operadorId: operadora.id,
        fundoTrocoCentavos: 20_000, // R$ 200,00 de fundo de troco
      },
    });
    await prisma.movimentoCaixa.create({
      data: {
        sessaoCaixaId: sessao.id,
        tipo: 'ABERTURA',
        valorCentavos: 20_000,
        usuarioId: operadora.id,
        observacao: 'Abertura de caixa (carga de desenvolvimento)',
      },
    });
  }

  // --- Categorias ----------------------------------------------------------
  const categorias = new Map<string, string>();
  for (const nome of CATEGORIAS) {
    const categoria = await prisma.categoria.upsert({
      where: { nome },
      update: {},
      create: { nome },
    });
    categorias.set(nome, categoria.id);
  }

  // --- Catálogo ------------------------------------------------------------
  let totalVariantes = 0;
  let indiceBarras = 0;

  for (const modelo of PRODUTOS) {
    const produto = await prisma.produto.upsert({
      where: { id: `seed-${modelo.prefixoSku}` },
      update: {},
      create: {
        id: `seed-${modelo.prefixoSku}`,
        nome: modelo.nome,
        marca: modelo.marca ?? null,
        categoriaId: categorias.get(modelo.categoria)!,
        // Campos fiscais deliberadamente vazios: regime tributário ainda não
        // definido pelo contador e esta versão não emite documento fiscal.
      },
    });

    const tamanhos = modelo.tamanhos ?? [undefined];
    const cores = modelo.cores ?? [undefined];

    for (const tamanho of tamanhos) {
      for (const cor of cores) {
        const sku = montarSku(modelo.prefixoSku, tamanho, cor);
        indiceBarras += 1;

        const variante = await prisma.variante.upsert({
          where: { sku },
          update: {},
          create: {
            produtoId: produto.id,
            sku,
            codigoBarras: montarCodigoBarras(indiceBarras),
            tamanho: tamanho ?? null,
            cor: cor ?? null,
            precoCentavos: modelo.precoCentavos,
            custoCentavos: modelo.custoCentavos,
          },
        });
        totalVariantes += 1;

        // Estoque inicial entra como movimento, não como campo. Só lança se a
        // variante ainda não tiver nenhum movimento — mantém o seed idempotente
        // sem precisar alterar o livro-razão, que é imutável.
        const jaTemMovimento = await prisma.movimentoEstoque.count({
          where: { varianteId: variante.id },
        });
        if (jaTemMovimento === 0) {
          await prisma.movimentoEstoque.create({
            data: {
              varianteId: variante.id,
              tipo: 'ENTRADA_COMPRA',
              quantidade: modelo.estoquePorVariante,
              custoUnitarioCentavos: modelo.custoCentavos,
              documentoTipo: 'CARGA_INICIAL',
              documentoId: 'seed',
              observacao: 'Estoque inicial da carga de desenvolvimento',
            },
          });
        }
      }
    }
  }

  // --- Cliente de crediário ------------------------------------------------
  await prisma.cliente.upsert({
    where: { cpf: '11144477735' },
    update: {},
    create: {
      nome: 'Carla Fernandes',
      cpf: '11144477735',
      telefone: '11999990000',
      limiteCrediarioCentavos: 50_000, // R$ 500,00
    },
  });

  const saldos = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
    `SELECT COALESCE(SUM("saldo"), 0)::bigint AS total FROM "EstoqueAtual"`,
  );

  console.log(`  usuários: ana (operadora, 5%), bia (gerente), admin`);
  console.log(`  terminal: ${terminal.nome}`);
  console.log(`  produtos: ${PRODUTOS.length} | variantes: ${totalVariantes}`);
  console.log(`  peças em estoque: ${saldos[0]?.total ?? 0}`);
  console.log(`  operadora id: ${operadora.id}`);
  console.log(`  gerente id: ${gerente.id}`);
  console.log('');
  console.log('  Sessao de caixa aberta. No navegador do caixa, rode uma vez:');
  console.log(`    localStorage.setItem('pdv.sessaoCaixaId', '${sessao.id}')`);
  console.log('Pronto.');
}

main()
  .catch((erro) => {
    console.error('Falha ao semear:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
