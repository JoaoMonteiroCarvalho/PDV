/**
 * Clientes e crediário contra o banco real.
 *
 * O que estes testes protegem:
 *
 *   1. CPF é validado com dígito verificador, não com "tem 11 números" — é o
 *      que liga a dívida a uma pessoa de verdade.
 *   2. Recebimento é LANÇAMENTO: pagamento parcial existe, e o status vem da
 *      soma, nunca de alguém marcar a parcela como paga.
 *   3. Recebimento entra na gaveta: sem caixa aberto, não entra.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { carregarConfiguracao } from '../config.js';
import { construirServidor } from '../servidor.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
let token: string;
let sessaoCaixaId: string;

const CPF_VALIDO = '52998224725';
const OUTRO_CPF_VALIDO = '11144477735';

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

function autenticado() {
  return { authorization: `Bearer ${token}` };
}

async function criarCliente(corpo: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/clientes', headers: autenticado(), payload: corpo });
}

/** Cria cliente com título e parcelas, sem passar pela rota de venda. */
async function criarDivida(opcoes: { limite: number; parcelas: number[] }) {
  const cliente = await prisma.cliente.create({
    data: { nome: 'Carla', cpf: CPF_VALIDO, limiteCrediarioCentavos: opcoes.limite },
  });

  const categoria = await prisma.categoria.create({ data: { nome: 'Lingerie' } });
  const produto = await prisma.produto.create({
    data: { nome: 'Conjunto', categoriaId: categoria.id },
  });
  const variante = await prisma.variante.create({
    data: { produtoId: produto.id, sku: 'CJ-1', precoCentavos: 5_000, custoCentavos: 2_000 },
  });

  const total = opcoes.parcelas.reduce((soma, valor) => soma + valor, 0);
  const venda = await prisma.venda.create({
    data: {
      // O id da venda vem do caixa: e a chave de idempotencia, sem default.
      id: crypto.randomUUID(),
      sessaoCaixaId,
      clienteId: cliente.id,
      operadorId: (await prisma.usuario.findFirstOrThrow()).id,
      subtotalCentavos: total,
      descontoCentavos: 0,
      totalCentavos: total,
      criadaEmCliente: new Date(),
      itens: {
        create: [
          {
            varianteId: variante.id,
            // `ItemVenda` guarda a descrição do momento da venda: o cadastro
            // pode mudar depois, o comprovante impresso não.
            sequencia: 1,
            descricao: 'Conjunto',
            sku: 'CJ-1',
            quantidade: 1,
            precoUnitarioCentavos: total,
            descontoCentavos: 0,
            totalCentavos: total,
          },
        ],
      },
    },
  });

  const titulo = await prisma.tituloCrediario.create({
    data: { vendaId: venda.id, clienteId: cliente.id, valorTotalCentavos: total },
  });

  const parcelas = await Promise.all(
    opcoes.parcelas.map((valor, indice) =>
      prisma.parcelaCrediario.create({
        data: {
          tituloId: titulo.id,
          numero: indice + 1,
          valorCentavos: valor,
          vencimento: new Date(2026, 9 + indice, 10),
        },
      }),
    ),
  );

  return { cliente, titulo, parcelas };
}

beforeAll(async () => {
  app = await construirServidor(carregarConfiguracao());
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBase();

  await prisma.usuario.create({
    data: {
      nome: 'Ana',
      login: 'ana.cliente',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
    },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/sessao/login',
    payload: { login: 'ana.cliente', senha: 'caixa123' },
  });
  token = (login.json() as { token: string }).token;

  const terminal = await prisma.terminal.create({ data: { nome: 'Caixa 1' } });
  const sessao = await prisma.sessaoCaixa.create({
    data: {
      terminalId: terminal.id,
      operadorId: (await prisma.usuario.findFirstOrThrow()).id,
      fundoTrocoCentavos: 0,
    },
  });
  sessaoCaixaId = sessao.id;
});

describe('cadastro de cliente', () => {
  it('exige autenticação', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/clientes' });
    expect(resposta.statusCode).toBe(401);
  });

  it('cadastra com CPF válido, guardando só os dígitos', async () => {
    /*
     * Guardar formatado criaria dois registros para a mesma pessoa, a busca
     * por um não acharia o outro, e o índice único deixaria a duplicata passar.
     */
    const resposta = await criarCliente({ nome: 'Carla Fernandes', cpf: '529.982.247-25' });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ nome: 'Carla Fernandes', cpf: CPF_VALIDO });
  });

  it('recusa CPF com dígito verificador errado', async () => {
    // "Tem 11 números" deixaria passar dívida no nome de ninguém.
    const resposta = await criarCliente({ nome: 'Fulana', cpf: '52998224726' });
    expect(resposta.statusCode).toBe(400);
  });

  it('recusa sequência de dígitos iguais', async () => {
    const resposta = await criarCliente({ nome: 'Fulana', cpf: '11111111111' });
    expect(resposta.statusCode).toBe(400);
  });

  it('cadastra sem CPF — a loja atende quem não quer informar', async () => {
    const resposta = await criarCliente({ nome: 'Cliente Sem CPF' });
    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ cpf: null });
  });

  it('duas clientes sem CPF convivem', async () => {
    /*
     * Se string vazia virasse CPF gravado, o índice único deixaria só a
     * primeira ser cadastrada — e a segunda receberia um erro incompreensível.
     */
    expect((await criarCliente({ nome: 'Uma', cpf: '' })).statusCode).toBe(201);
    expect((await criarCliente({ nome: 'Outra', cpf: '' })).statusCode).toBe(201);
  });

  it('recusa CPF repetido dizendo de quem é', async () => {
    await criarCliente({ nome: 'Carla', cpf: CPF_VALIDO });
    const segunda = await criarCliente({ nome: 'Outra Pessoa', cpf: CPF_VALIDO });

    expect(segunda.statusCode).toBe(409);
    expect(segunda.json()).toMatchObject({ codigo: 'CPF_JA_CADASTRADO' });
    expect((segunda.json() as { mensagem: string }).mensagem).toContain('Carla');
  });

  it('limite de crediário começa em zero — não vende fiado por omissão', async () => {
    const resposta = await criarCliente({ nome: 'Nova' });
    expect(resposta.json()).toMatchObject({ limiteCrediarioCentavos: 0 });
  });
});

describe('busca de clientes', () => {
  beforeEach(async () => {
    await criarCliente({ nome: 'Carla Fernandes', cpf: CPF_VALIDO });
    await criarCliente({ nome: 'Beatriz Lima', cpf: OUTRO_CPF_VALIDO });
  });

  async function buscar(consulta: string) {
    const resposta = await app.inject({
      method: 'GET',
      url: `/clientes?busca=${encodeURIComponent(consulta)}`,
      headers: autenticado(),
    });
    return resposta.json() as { nome: string }[];
  }

  it('acha por parte do nome', async () => {
    expect(await buscar('carla')).toHaveLength(1);
    expect((await buscar('lima'))[0]).toMatchObject({ nome: 'Beatriz Lima' });
  });

  it('acha por CPF, mesmo digitado com pontuação', async () => {
    // Quem digita CPF costuma digitar com ponto; quem digita nome digita
    // metade. Os dois caminhos funcionam sem escolher um "modo".
    expect((await buscar('529.982'))[0]).toMatchObject({ nome: 'Carla Fernandes' });
  });

  it('sem busca, lista em ordem alfabética', async () => {
    const todos = await buscar('');
    expect(todos.map((c) => c.nome)).toEqual(['Beatriz Lima', 'Carla Fernandes']);
  });
});

describe('ficha da cliente', () => {
  it('mostra saldo devedor e limite disponível', async () => {
    const { cliente } = await criarDivida({ limite: 50_000, parcelas: [10_000, 10_000] });

    const resposta = await app.inject({
      method: 'GET',
      url: `/clientes/${cliente.id}`,
      headers: autenticado(),
    });

    expect(resposta.json()).toMatchObject({
      saldoDevedorCentavos: 20_000,
      limiteDisponivelCentavos: 30_000,
    });
    expect((resposta.json() as { parcelasEmAberto: unknown[] }).parcelasEmAberto).toHaveLength(2);
  });

  it('cliente inexistente devolve 404, não 500', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/clientes/00000000-0000-4000-8000-000000000000',
      headers: autenticado(),
    });
    expect(resposta.statusCode).toBe(404);
  });
});

describe('recebimento de parcela', () => {
  async function receber(parcelaId: string, corpo: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/parcelas/${parcelaId}/receber`,
      headers: autenticado(),
      payload: { sessaoCaixaId, forma: 'DINHEIRO', ...corpo },
    });
  }

  it('quita a parcela quando o valor cobre tudo', async () => {
    const { parcelas } = await criarDivida({ limite: 50_000, parcelas: [10_000] });

    const resposta = await receber(parcelas[0]!.id, { valorCentavos: 10_000 });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ status: 'PAGA', restanteCentavos: 0 });
  });

  it('pagamento parcial existe de verdade', async () => {
    /*
     * A cliente paga metade hoje e metade na semana que vem. Se o sistema só
     * soubesse "paga ou não paga", a operadora teria que escolher entre mentir
     * e recusar o dinheiro.
     */
    const { parcelas } = await criarDivida({ limite: 50_000, parcelas: [10_000] });

    const primeira = await receber(parcelas[0]!.id, { valorCentavos: 4_000 });
    expect(primeira.json()).toMatchObject({ status: 'ABERTA', restanteCentavos: 6_000 });

    const segunda = await receber(parcelas[0]!.id, { valorCentavos: 6_000 });
    expect(segunda.json()).toMatchObject({ status: 'PAGA', restanteCentavos: 0 });
  });

  it('o saldo devedor cai conforme recebe', async () => {
    const { cliente, parcelas } = await criarDivida({ limite: 50_000, parcelas: [10_000, 10_000] });
    await receber(parcelas[0]!.id, { valorCentavos: 4_000 });

    const ficha = await app.inject({
      method: 'GET',
      url: `/clientes/${cliente.id}`,
      headers: autenticado(),
    });
    expect(ficha.json()).toMatchObject({ saldoDevedorCentavos: 16_000 });
  });

  it('recusa receber mais do que falta', async () => {
    // Não é "sobra", é erro de digitação: aceitar criaria crédito fantasma e
    // saldo devedor negativo.
    const { parcelas } = await criarDivida({ limite: 50_000, parcelas: [10_000] });

    const resposta = await receber(parcelas[0]!.id, { valorCentavos: 12_000 });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json()).toMatchObject({ codigo: 'VALOR_ACIMA_DO_RESTANTE' });
  });

  it('recusa receber parcela já quitada', async () => {
    const { parcelas } = await criarDivida({ limite: 50_000, parcelas: [10_000] });
    await receber(parcelas[0]!.id, { valorCentavos: 10_000 });

    const denovo = await receber(parcelas[0]!.id, { valorCentavos: 1_000 });
    expect(denovo.statusCode).toBe(409);
    expect(denovo.json()).toMatchObject({ codigo: 'PARCELA_JA_PAGA' });
  });

  it('sem caixa aberto, não recebe', async () => {
    /*
     * Recebimento entra na gaveta e precisa bater no fechamento. Dinheiro de
     * fiado que não passa pelo caixa é dinheiro que ninguém confere.
     */
    const { parcelas } = await criarDivida({ limite: 50_000, parcelas: [10_000] });
    await prisma.sessaoCaixa.update({
      where: { id: sessaoCaixaId },
      data: { status: 'FECHADA', fechadaEm: new Date() },
    });

    const resposta = await receber(parcelas[0]!.id, { valorCentavos: 10_000 });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json()).toMatchObject({ codigo: 'SESSAO_FECHADA' });
  });

  it('o título fecha quando a última parcela fecha', async () => {
    const { titulo, parcelas } = await criarDivida({ limite: 50_000, parcelas: [5_000, 5_000] });

    await receber(parcelas[0]!.id, { valorCentavos: 5_000 });
    let atual = await prisma.tituloCrediario.findUniqueOrThrow({ where: { id: titulo.id } });
    expect(atual.status).toBe('ABERTO');

    await receber(parcelas[1]!.id, { valorCentavos: 5_000 });
    atual = await prisma.tituloCrediario.findUniqueOrThrow({ where: { id: titulo.id } });
    expect(atual.status).toBe('QUITADO');
  });

  it('grava auditoria do recebimento', async () => {
    const { parcelas } = await criarDivida({ limite: 50_000, parcelas: [10_000] });
    await receber(parcelas[0]!.id, { valorCentavos: 10_000, forma: 'PIX' });

    const auditoria = await prisma.registroAuditoria.findFirst({
      where: { acao: 'RECEBIMENTO_CREDIARIO' },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria!.valorDepois).toMatchObject({ forma: 'PIX', quitou: true });
  });
});
