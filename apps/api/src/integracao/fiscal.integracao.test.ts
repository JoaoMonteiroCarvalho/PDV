/**
 * A porta do documento fiscal, contra o banco real.
 *
 * Esta versão NÃO emite NFC-e. O que estes testes protegem é o ENCAIXE — e
 * três promessas que ele faz, cada uma testada com um emissor de mentira que
 * um emissor real um dia substitui:
 *
 *   1. Desligado, o fiscal não custa NADA: a porta não é chamada e nenhuma
 *      consulta extra roda no caminho da venda.
 *   2. A emissão acontece DEPOIS do commit, e a venda fica gravada mesmo
 *      quando a emissão falha. A venda já aconteceu no mundo real.
 *   3. Reenvio da fila offline NÃO emite de novo.
 *
 * Sem estes testes a porta seria decoração: um arquivo de interface que
 * ninguém percorre até o dia em que ligar o fiscal — o pior momento para
 * descobrir que o encaixe não encaixa.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gerarHashSenha } from '../autenticacao.js';
import { emissorDesligado, criarEmissorFiscal } from '../fiscal/desligado.js';
import type { EmissorFiscal, VendaParaFiscal } from '../fiscal/porta.js';
import { registrarVenda } from '../servicos/registrar-venda.js';
import { carregarConfiguracao } from '../config.js';

const prisma = new PrismaClient();
let operadorId: string;
let sessaoCaixaId: string;
let varianteId: string;
let clienteId: string;

async function limparBase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "RegistroAuditoria", "MovimentoEstoque", "Pagamento", "ItemVenda",
             "Cancelamento", "RecebimentoParcela", "ParcelaCrediario",
             "TituloCrediario", "Venda", "MovimentoCaixa", "SessaoCaixa",
             "Variante", "Produto", "Categoria", "Terminal", "Cliente",
             "Usuario" CASCADE
  `);
}

/** Emissor de mentira: registra o que recebeu e devolve o que mandarem. */
function emissorFalso(resposta: Awaited<ReturnType<EmissorFiscal['emitir']>>) {
  const recebidas: VendaParaFiscal[] = [];
  const emissor: EmissorFiscal = {
    habilitado: true,
    emitir: async (venda) => {
      recebidas.push(venda);
      return resposta;
    },
  };
  return { emissor, recebidas };
}

function vendaDeUmItem(id = crypto.randomUUID()) {
  return {
    id,
    sessaoCaixaId,
    criadaEmCliente: new Date(),
    itens: [
      { varianteId, quantidade: 2, precoUnitarioCentavos: 10_000, descontoCentavos: 0 },
    ],
    descontoSobreTotalCentavos: 0,
    pagamentos: [
      {
        forma: 'CREDITO' as const,
        valorCentavos: 20_000,
        trocoCentavos: 0,
        bandeira: 'Visa',
        parcelasCartao: 2,
      },
    ],
  };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBase();

  const usuario = await prisma.usuario.create({
    data: {
      nome: 'Ana',
      login: 'ana.fiscal',
      senhaHash: await gerarHashSenha('caixa123'),
      papel: 'OPERADOR',
      limiteDescontoBps: 10_000,
    },
  });
  operadorId = usuario.id;

  const terminal = await prisma.terminal.create({ data: { nome: 'Caixa Fiscal' } });
  const sessao = await prisma.sessaoCaixa.create({
    data: { terminalId: terminal.id, operadorId, fundoTrocoCentavos: 0 },
  });
  sessaoCaixaId = sessao.id;

  const produto = await prisma.produto.create({
    data: {
      nome: 'Conjunto Renda',
      ncm: '61083100',
      cest: '2804600',
      origem: 0,
      situacaoTributaria: '102',
    },
  });
  const variante = await prisma.variante.create({
    data: { produtoId: produto.id, sku: 'CJ-FISCAL', precoCentavos: 10_000 },
  });
  varianteId = variante.id;

  const cliente = await prisma.cliente.create({
    data: { nome: 'Carla', cpf: '52998224725', limiteCrediarioCentavos: 0 },
  });
  clienteId = cliente.id;
});

describe('fiscal desligado — o padrão desta versão', () => {
  it('registra a venda e devolve situação DESLIGADO', async () => {
    const resultado = await registrarVenda(prisma, vendaDeUmItem(), { operadorId });

    expect(resultado.fiscal).toEqual({ situacao: 'DESLIGADO' });
    expect(await prisma.venda.count()).toBe(1);
  });

  it('o emissor desligado nunca falha — emitir nada é o esperado, não um erro', async () => {
    await expect(
      emissorDesligado.emitir({} as VendaParaFiscal),
    ).resolves.toEqual({ situacao: 'DESLIGADO' });
    expect(emissorDesligado.habilitado).toBe(false);
  });

  it('desligado, a porta NÃO é chamada', async () => {
    // A promessa é que o módulo desligado não custa trabalho nenhum no
    // caminho da venda — nem o payload é montado.
    const espiao = vi.fn();
    const emissor: EmissorFiscal = { habilitado: false, emitir: espiao };

    await registrarVenda(prisma, vendaDeUmItem(), { operadorId, emissorFiscal: emissor });

    expect(espiao).not.toHaveBeenCalled();
  });

  it('`criarEmissorFiscal` devolve o desligado com a flag em false', () => {
    const configuracao = { ...carregarConfiguracao(), FISCAL_HABILITADO: false };
    expect(criarEmissorFiscal(configuracao)).toBe(emissorDesligado);
  });

  it('recusa criar emissor com a flag ligada, dizendo o que falta', () => {
    // Prometer emissão sem emissor é pior que não prometer: a loja acharia
    // estar emitindo.
    const configuracao = { ...carregarConfiguracao(), FISCAL_HABILITADO: true };
    expect(() => criarEmissorFiscal(configuracao)).toThrow(/nenhum emissor fiscal/i);
  });
});

describe('o que a porta recebe', () => {
  it('leva os campos fiscais do produto como estavam na venda', async () => {
    const { emissor, recebidas } = emissorFalso({
      situacao: 'AUTORIZADO',
      chaveAcesso: '35260912345678000199650010000000011000000017',
      protocolo: '135260000000001',
    });

    await registrarVenda(prisma, vendaDeUmItem(), { operadorId, emissorFiscal: emissor });

    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]?.itens[0]).toMatchObject({
      sequencia: 1,
      sku: 'CJ-FISCAL',
      quantidade: 2,
      totalCentavos: 20_000,
      ncm: '61083100',
      cest: '2804600',
      origem: 0,
      situacaoTributaria: '102',
    });
  });

  it('leva os dados do cartão, que o documento fiscal precisa declarar', async () => {
    const { emissor, recebidas } = emissorFalso({ situacao: 'DESLIGADO' });

    await registrarVenda(prisma, vendaDeUmItem(), { operadorId, emissorFiscal: emissor });

    expect(recebidas[0]?.pagamentos[0]).toMatchObject({
      forma: 'CREDITO',
      valorCentavos: 20_000,
      bandeira: 'Visa',
      parcelasCartao: 2,
    });
  });

  it('venda sem cliente identificado leva cliente nulo — é o caso normal', async () => {
    const { emissor, recebidas } = emissorFalso({ situacao: 'DESLIGADO' });

    await registrarVenda(prisma, vendaDeUmItem(), { operadorId, emissorFiscal: emissor });

    expect(recebidas[0]?.cliente).toBeNull();
  });

  it('com cliente identificado, leva nome e CPF', async () => {
    const { emissor, recebidas } = emissorFalso({ situacao: 'DESLIGADO' });

    await registrarVenda(
      prisma,
      { ...vendaDeUmItem(), clienteId },
      { operadorId, emissorFiscal: emissor },
    );

    expect(recebidas[0]?.cliente).toEqual({ nome: 'Carla', cpf: '52998224725' });
  });

  it('leva o número sequencial da loja já atribuído pelo banco', async () => {
    const { emissor, recebidas } = emissorFalso({ situacao: 'DESLIGADO' });

    const resultado = await registrarVenda(prisma, vendaDeUmItem(), {
      operadorId,
      emissorFiscal: emissor,
    });

    expect(recebidas[0]?.numero).toBe(resultado.numero);
    expect(recebidas[0]?.vendaId).toBe(resultado.vendaId);
  });
});

describe('a venda já aconteceu — emissão não a desfaz', () => {
  it('SEFAZ indisponível: a venda fica gravada e a situação sobe no resultado', async () => {
    const { emissor } = emissorFalso({ situacao: 'INDISPONIVEL', motivo: 'SEFAZ fora do ar' });

    const resultado = await registrarVenda(prisma, vendaDeUmItem(), {
      operadorId,
      emissorFiscal: emissor,
    });

    expect(resultado.fiscal).toEqual({ situacao: 'INDISPONIVEL', motivo: 'SEFAZ fora do ar' });
    expect(await prisma.venda.count()).toBe(1);
  });

  it('documento rejeitado: a venda continua gravada', async () => {
    const { emissor } = emissorFalso({
      situacao: 'REJEITADO',
      codigo: '539',
      motivo: 'Duplicidade de NF-e',
    });

    const resultado = await registrarVenda(prisma, vendaDeUmItem(), {
      operadorId,
      emissorFiscal: emissor,
    });

    expect(resultado.fiscal).toMatchObject({ situacao: 'REJEITADO', codigo: '539' });
    expect(await prisma.venda.count()).toBe(1);
  });

  it('emissor que LANÇA não derruba a venda — vira INDISPONIVEL', async () => {
    /*
     * O contrato diz para não lançar. Isto é o cinto de segurança para quando
     * alguém esquecer: uma venda gravada, paga e entregue não pode virar erro
     * 500 para o caixa porque a biblioteca da SEFAZ estourou.
     */
    const emissor: EmissorFiscal = {
      habilitado: true,
      emitir: async () => {
        throw new Error('certificado digital vencido');
      },
    };

    const resultado = await registrarVenda(prisma, vendaDeUmItem(), {
      operadorId,
      emissorFiscal: emissor,
    });

    expect(resultado.fiscal).toEqual({
      situacao: 'INDISPONIVEL',
      motivo: 'certificado digital vencido',
    });
    expect(await prisma.venda.count()).toBe(1);
    // E o estoque foi baixado: a transação commitou antes da emissão.
    const movimentos = await prisma.movimentoEstoque.count({ where: { tipo: 'VENDA' } });
    expect(movimentos).toBe(1);
  });
});

describe('idempotência', () => {
  it('reenvio da fila offline NÃO emite um segundo documento', async () => {
    const { emissor, recebidas } = emissorFalso({ situacao: 'DESLIGADO' });
    const venda = vendaDeUmItem();

    const primeira = await registrarVenda(prisma, venda, {
      operadorId,
      emissorFiscal: emissor,
    });
    const segunda = await registrarVenda(prisma, venda, {
      operadorId,
      emissorFiscal: emissor,
    });

    expect(primeira.jaEstavaRegistrada).toBe(false);
    expect(segunda.jaEstavaRegistrada).toBe(true);
    // O documento foi resolvido no primeiro registro. Emitir de novo criaria
    // dois documentos para a mesma venda.
    expect(recebidas).toHaveLength(1);
    expect(await prisma.venda.count()).toBe(1);
  });
});
