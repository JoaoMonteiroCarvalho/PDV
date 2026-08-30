/**
 * Serviço de cliente e crediário.
 *
 * Mesmo desenho do resto: `@pdv/shared` (cliente.ts) tem a regra pura, este
 * arquivo só traduz para Prisma. Recebimento de parcela é a única operação
 * que grava em duas tabelas na mesma transação — RecebimentoParcela e
 * MovimentoCaixa — porque o dinheiro que quita a dívida entra na gaveta.
 */

import type { PrismaClient } from '@prisma/client';
import { ErroCliente, calcularLimiteDisponivel, centavos, validarCadastroCliente, validarRecebimentoParcela } from '@pdv/shared';
import type {
  EntradaAtualizarCliente,
  EntradaCriarCliente,
  EntradaListarClientes,
  EntradaReceberParcela,
} from '../esquemas/cliente.js';

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

export async function criarCliente(prisma: PrismaClient, entrada: EntradaCriarCliente): Promise<{ id: string }> {
  validarCadastroCliente(entrada.nome, centavos(entrada.limiteCrediarioCentavos));

  const cliente = await prisma.cliente.create({
    data: {
      nome: entrada.nome.trim(),
      cpf: entrada.cpf ?? null,
      telefone: entrada.telefone ?? null,
      email: entrada.email ?? null,
      limiteCrediarioCentavos: entrada.limiteCrediarioCentavos,
      observacao: entrada.observacao ?? null,
    },
  });
  return { id: cliente.id };
}

export async function atualizarCliente(
  prisma: PrismaClient,
  clienteId: string,
  entrada: EntradaAtualizarCliente,
): Promise<{ id: string }> {
  const existente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
  if (!existente) throw new ErroCliente('CLIENTE_INEXISTENTE', 'Cliente não encontrado.');

  if (entrada.nome !== undefined || entrada.limiteCrediarioCentavos !== undefined) {
    const atual = await prisma.cliente.findUniqueOrThrow({
      where: { id: clienteId },
      select: { nome: true, limiteCrediarioCentavos: true },
    });
    validarCadastroCliente(
      entrada.nome ?? atual.nome,
      centavos(entrada.limiteCrediarioCentavos ?? atual.limiteCrediarioCentavos),
    );
  }

  await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      ...(entrada.nome !== undefined && { nome: entrada.nome.trim() }),
      ...(entrada.cpf !== undefined && { cpf: entrada.cpf }),
      ...(entrada.telefone !== undefined && { telefone: entrada.telefone }),
      ...(entrada.email !== undefined && { email: entrada.email }),
      ...(entrada.limiteCrediarioCentavos !== undefined && {
        limiteCrediarioCentavos: entrada.limiteCrediarioCentavos,
      }),
      ...(entrada.observacao !== undefined && { observacao: entrada.observacao }),
      ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
    },
  });
  return { id: clienteId };
}

export interface ClienteListado {
  readonly id: string;
  readonly nome: string;
  readonly cpf: string | null;
  readonly telefone: string | null;
  readonly ativo: boolean;
  readonly limiteCrediarioCentavos: number;
}

export interface ResultadoListaClientes {
  readonly itens: readonly ClienteListado[];
  readonly proximoCursor: string | null;
}

export async function listarClientes(
  prisma: PrismaClient,
  entrada: EntradaListarClientes,
): Promise<ResultadoListaClientes> {
  const clientes = await prisma.cliente.findMany({
    where: entrada.busca
      ? {
          OR: [
            { nome: { contains: entrada.busca, mode: 'insensitive' } },
            { cpf: { contains: entrada.busca } },
          ],
        }
      : {},
    orderBy: { nome: 'asc' },
    take: entrada.limite + 1,
    ...(entrada.cursor && { cursor: { id: entrada.cursor }, skip: 1 }),
  });

  const temMais = clientes.length > entrada.limite;
  const pagina = temMais ? clientes.slice(0, entrada.limite) : clientes;

  return {
    itens: pagina.map((cliente) => ({
      id: cliente.id,
      nome: cliente.nome,
      cpf: cliente.cpf,
      telefone: cliente.telefone,
      ativo: cliente.ativo,
      limiteCrediarioCentavos: cliente.limiteCrediarioCentavos,
    })),
    proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Crediário
// ---------------------------------------------------------------------------

export interface ParcelaEmAberto {
  readonly id: string;
  readonly tituloId: string;
  readonly vendaId: string;
  readonly numero: number;
  readonly valorCentavos: number;
  readonly vencimento: string;
  readonly status: string;
}

export interface CrediarioCliente {
  readonly clienteId: string;
  readonly limiteCrediarioCentavos: number;
  readonly emAbertoCentavos: number;
  readonly limiteDisponivelCentavos: number;
  readonly parcelas: readonly ParcelaEmAberto[];
}

export async function obterCrediarioCliente(
  prisma: PrismaClient,
  clienteId: string,
): Promise<CrediarioCliente | null> {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { id: true, limiteCrediarioCentavos: true },
  });
  if (!cliente) return null;

  const parcelas = await prisma.parcelaCrediario.findMany({
    where: { status: 'ABERTA', titulo: { clienteId } },
    orderBy: { vencimento: 'asc' },
    select: {
      id: true,
      tituloId: true,
      numero: true,
      valorCentavos: true,
      vencimento: true,
      status: true,
      titulo: { select: { vendaId: true } },
    },
  });

  const emAberto = parcelas.reduce((soma, parcela) => soma + parcela.valorCentavos, 0);
  const limite = centavos(cliente.limiteCrediarioCentavos);
  const disponivel = calcularLimiteDisponivel(limite, centavos(emAberto));

  return {
    clienteId: cliente.id,
    limiteCrediarioCentavos: cliente.limiteCrediarioCentavos,
    emAbertoCentavos: emAberto,
    limiteDisponivelCentavos: disponivel,
    parcelas: parcelas.map((parcela) => ({
      id: parcela.id,
      tituloId: parcela.tituloId,
      vendaId: parcela.titulo.vendaId,
      numero: parcela.numero,
      valorCentavos: parcela.valorCentavos,
      vencimento: parcela.vencimento.toISOString(),
      status: parcela.status,
    })),
  };
}

export async function receberParcela(
  prisma: PrismaClient,
  parcelaId: string,
  entrada: EntradaReceberParcela,
  contexto: { operadorId: string },
): Promise<{ id: string }> {
  const parcela = await prisma.parcelaCrediario.findUnique({
    where: { id: parcelaId },
    select: { id: true, tituloId: true, valorCentavos: true, status: true },
  });
  if (!parcela) throw new ErroCliente('PARCELA_INEXISTENTE', 'Parcela não encontrada.');

  validarRecebimentoParcela(parcela.status, centavos(parcela.valorCentavos), centavos(entrada.valorCentavos));

  const sessao = await prisma.sessaoCaixa.findUnique({
    where: { id: entrada.sessaoCaixaId },
    select: { status: true },
  });
  if (!sessao) throw new ErroCliente('SESSAO_INEXISTENTE', 'Sessão de caixa não encontrada.');
  if (sessao.status !== 'ABERTA') {
    throw new ErroCliente('SESSAO_FECHADA', 'A sessão de caixa já foi fechada.');
  }

  const recebimento = await prisma.$transaction(async (tx) => {
    const registro = await tx.recebimentoParcela.create({
      data: {
        parcelaId,
        valorCentavos: entrada.valorCentavos,
        forma: entrada.forma,
        sessaoCaixaId: entrada.sessaoCaixaId,
        usuarioId: contexto.operadorId,
      },
    });

    await tx.parcelaCrediario.update({ where: { id: parcelaId }, data: { status: 'PAGA' } });

    // Dinheiro/Pix/Débito/Crédito de recebimento entram na gaveta igual a
    // uma venda — precisa bater no fechamento do dia.
    await tx.movimentoCaixa.create({
      data: {
        sessaoCaixaId: entrada.sessaoCaixaId,
        tipo: 'RECEBIMENTO_CREDIARIO',
        valorCentavos: entrada.valorCentavos,
        usuarioId: contexto.operadorId,
        documentoTipo: 'RECEBIMENTO_PARCELA',
        documentoId: registro.id,
      },
    });

    // Quando a última parcela em aberto do título quita, o título vira QUITADO.
    const restantes = await tx.parcelaCrediario.count({
      where: { tituloId: parcela.tituloId, status: 'ABERTA' },
    });
    if (restantes === 0) {
      await tx.tituloCrediario.update({ where: { id: parcela.tituloId }, data: { status: 'QUITADO' } });
    }

    return registro;
  });

  return { id: recebimento.id };
}
