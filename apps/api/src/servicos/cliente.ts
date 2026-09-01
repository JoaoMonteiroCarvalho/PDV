/**
 * Clientes e crediário (fiado).
 *
 * O crediário é dívida de gente real com a loja. Duas regras governam este
 * arquivo:
 *
 *   1. Recebimento é LANÇAMENTO, nunca edição. A parcela não é "marcada como
 *      paga": cria-se um `RecebimentoParcela`, e o status vem da soma. Assim
 *      um pagamento parcial existe de verdade, e nada some por alguém ter
 *      clicado no lugar errado.
 *   2. Recebimento entra na GAVETA. Ele pertence a uma sessão de caixa aberta
 *      e precisa bater no fechamento — dinheiro de fiado que não passa pelo
 *      caixa é dinheiro que ninguém confere.
 */

import { normalizarCpf, somenteDigitos } from '@pdv/shared';
import { Prisma, type PrismaClient } from '@prisma/client';

export class ErroCliente extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroCliente';
  }
}

export interface CriarClienteEntrada {
  readonly nome: string;
  readonly cpf?: string | undefined;
  readonly telefone?: string | undefined;
  readonly limiteCrediarioCentavos: number;
  readonly observacao?: string | undefined;
}

export async function criarCliente(prisma: PrismaClient, entrada: CriarClienteEntrada) {
  // O CPF é gravado só com dígitos: formatado criaria dois registros para a
  // mesma pessoa e o índice único não pegaria a duplicata.
  const cpf = entrada.cpf ? normalizarCpf(entrada.cpf) : null;

  if (cpf) {
    const existente = await prisma.cliente.findUnique({ where: { cpf }, select: { id: true, nome: true } });
    if (existente) {
      throw new ErroCliente(
        'CPF_JA_CADASTRADO',
        `Este CPF já está cadastrado para ${existente.nome}.`,
      );
    }
  }

  return prisma.cliente.create({
    data: {
      nome: entrada.nome,
      cpf,
      telefone: entrada.telefone ?? null,
      limiteCrediarioCentavos: entrada.limiteCrediarioCentavos,
      observacao: entrada.observacao ?? null,
    },
    select: { id: true, nome: true, cpf: true, telefone: true, limiteCrediarioCentavos: true },
  });
}

/**
 * Busca por nome ou CPF.
 *
 * Quem digita CPF costuma digitar com ponto; quem digita nome digita metade.
 * Os dois caminhos precisam funcionar sem a operadora escolher um modo.
 */
export async function buscarClientes(
  prisma: PrismaClient,
  filtros: { busca?: string | undefined; limite: number },
) {
  const busca = filtros.busca?.trim() ?? '';
  const digitos = somenteDigitos(busca);

  const where: Prisma.ClienteWhereInput = { ativo: true };
  if (busca.length > 0) {
    where.OR = [
      { nome: { contains: busca, mode: 'insensitive' } },
      ...(digitos.length >= 3 ? [{ cpf: { startsWith: digitos } }] : []),
    ];
  }

  return prisma.cliente.findMany({
    where,
    orderBy: { nome: 'asc' },
    take: filtros.limite,
    select: { id: true, nome: true, cpf: true, telefone: true, limiteCrediarioCentavos: true },
  });
}

export interface ParcelaEmAberto {
  readonly id: string;
  readonly numero: number;
  readonly totalParcelas: number;
  readonly valorCentavos: number;
  readonly recebidoCentavos: number;
  readonly vencimento: Date;
  readonly vendaNumero: number;
}

/**
 * Ficha da cliente: limite, quanto já deve e quais parcelas estão abertas.
 *
 * `saldoDevedorCentavos` é o que FALTA receber — valor da parcela menos o que
 * já entrou. É esse número que consome o limite, não o valor original.
 */
export async function obterCliente(prisma: PrismaClient, clienteId: string) {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: {
      id: true,
      nome: true,
      cpf: true,
      telefone: true,
      limiteCrediarioCentavos: true,
      observacao: true,
      ativo: true,
    },
  });
  if (!cliente) throw new ErroCliente('CLIENTE_INEXISTENTE', 'Cliente não encontrado.');

  const parcelas = await prisma.parcelaCrediario.findMany({
    where: { titulo: { clienteId }, status: { not: 'PAGA' } },
    orderBy: { vencimento: 'asc' },
    select: {
      id: true,
      numero: true,
      valorCentavos: true,
      vencimento: true,
      recebimentos: { select: { valorCentavos: true } },
      titulo: {
        select: {
          venda: { select: { numero: true } },
          _count: { select: { parcelas: true } },
        },
      },
    },
  });

  const emAberto: ParcelaEmAberto[] = parcelas.map((parcela) => ({
    id: parcela.id,
    numero: parcela.numero,
    totalParcelas: parcela.titulo._count.parcelas,
    valorCentavos: parcela.valorCentavos,
    recebidoCentavos: parcela.recebimentos.reduce((soma, r) => soma + r.valorCentavos, 0),
    vencimento: parcela.vencimento,
    vendaNumero: parcela.titulo.venda.numero,
  }));

  const saldoDevedorCentavos = emAberto.reduce(
    (soma, parcela) => soma + (parcela.valorCentavos - parcela.recebidoCentavos),
    0,
  );

  return {
    ...cliente,
    saldoDevedorCentavos,
    limiteDisponivelCentavos: Math.max(0, cliente.limiteCrediarioCentavos - saldoDevedorCentavos),
    parcelasEmAberto: emAberto,
  };
}

export interface ReceberParcelaEntrada {
  readonly parcelaId: string;
  readonly sessaoCaixaId: string;
  readonly valorCentavos: number;
  readonly forma: 'DINHEIRO' | 'DEBITO' | 'CREDITO' | 'PIX';
}

export interface ResultadoRecebimento {
  readonly parcelaId: string;
  readonly recebidoCentavos: number;
  readonly restanteCentavos: number;
  readonly status: 'ABERTA' | 'PAGA';
}

export async function receberParcela(
  prisma: PrismaClient,
  entrada: ReceberParcelaEntrada,
  contexto: { operadorId: string },
): Promise<ResultadoRecebimento> {
  const parcela = await prisma.parcelaCrediario.findUnique({
    where: { id: entrada.parcelaId },
    select: {
      id: true,
      valorCentavos: true,
      status: true,
      recebimentos: { select: { valorCentavos: true } },
      titulo: { select: { id: true, clienteId: true } },
    },
  });
  if (!parcela) throw new ErroCliente('PARCELA_INEXISTENTE', 'Parcela não encontrada.');
  if (parcela.status === 'PAGA') {
    throw new ErroCliente('PARCELA_JA_PAGA', 'Esta parcela já está quitada.');
  }

  const jaRecebido = parcela.recebimentos.reduce((soma, r) => soma + r.valorCentavos, 0);
  const restante = parcela.valorCentavos - jaRecebido;

  /*
   * Receber mais do que falta não é "sobra": é erro de digitação. Aceitar
   * criaria crédito fantasma que ninguém sabe devolver, e o saldo devedor da
   * cliente ficaria negativo.
   */
  if (entrada.valorCentavos > restante) {
    throw new ErroCliente(
      'VALOR_ACIMA_DO_RESTANTE',
      `Faltam ${restante} centavos nesta parcela, e o valor informado é maior.`,
    );
  }

  const sessao = await prisma.sessaoCaixa.findUnique({
    where: { id: entrada.sessaoCaixaId },
    select: { status: true },
  });
  if (!sessao || sessao.status !== 'ABERTA') {
    // Recebimento entra na gaveta: sem caixa aberto não há onde lançar, e o
    // dinheiro entraria sem passar pela conferência do fechamento.
    throw new ErroCliente('SESSAO_FECHADA', 'Não há caixa aberto para receber o pagamento.');
  }

  const novoRecebido = jaRecebido + entrada.valorCentavos;
  const quitou = novoRecebido >= parcela.valorCentavos;

  await prisma.$transaction(async (tx) => {
    await tx.recebimentoParcela.create({
      data: {
        parcelaId: parcela.id,
        valorCentavos: entrada.valorCentavos,
        forma: entrada.forma,
        sessaoCaixaId: entrada.sessaoCaixaId,
        usuarioId: contexto.operadorId,
      },
    });

    if (quitou) {
      await tx.parcelaCrediario.update({
        where: { id: parcela.id },
        data: { status: 'PAGA' },
      });

      // Título fecha quando a última parcela fecha.
      const abertas = await tx.parcelaCrediario.count({
        where: { tituloId: parcela.titulo.id, status: { not: 'PAGA' } },
      });
      if (abertas === 0) {
        await tx.tituloCrediario.update({
          where: { id: parcela.titulo.id },
          data: { status: 'QUITADO' },
        });
      }
    }

    await tx.registroAuditoria.create({
      data: {
        acao: 'RECEBIMENTO_CREDIARIO',
        entidade: 'ParcelaCrediario',
        entidadeId: parcela.id,
        usuarioId: contexto.operadorId,
        valorDepois: {
          valorCentavos: entrada.valorCentavos,
          forma: entrada.forma,
          quitou,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return {
    parcelaId: parcela.id,
    recebidoCentavos: novoRecebido,
    restanteCentavos: Math.max(0, parcela.valorCentavos - novoRecebido),
    status: quitou ? 'PAGA' : 'ABERTA',
  };
}
