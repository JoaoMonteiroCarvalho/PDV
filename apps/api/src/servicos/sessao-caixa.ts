/**
 * Serviço de sessão de caixa: abertura, sangria/suprimento e fechamento.
 *
 * Todo o cálculo de negócio vem de `@pdv/shared` (`caixa.ts`). Este arquivo só
 * traduz para consultas Prisma e transações — o mesmo desenho de
 * `registrar-venda.ts`.
 */

import type { PrismaClient } from '@prisma/client';
import {
  ErroCaixa,
  calcularFechamento,
  centavos,
  sinalDoMovimentoManual,
  somar,
  validarAbertura,
  validarMovimentoManual,
  type Centavos,
  type TipoMovimentoManual,
} from '@pdv/shared';

async function autorizadorEhGerente(
  prisma: PrismaClient,
  autorizadoPorId: string | undefined,
): Promise<boolean> {
  if (!autorizadoPorId) return false;
  const usuario = await prisma.usuario.findUnique({
    where: { id: autorizadoPorId },
    select: { papel: true, ativo: true },
  });
  return !!usuario && usuario.ativo && (usuario.papel === 'GERENTE' || usuario.papel === 'ADMIN');
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

export interface AbrirSessaoEntrada {
  readonly terminalId: string;
  readonly fundoTrocoCentavos: number;
}

export async function abrirSessao(
  prisma: PrismaClient,
  entrada: AbrirSessaoEntrada,
  contexto: { operadorId: string },
): Promise<{ id: string }> {
  const fundo = centavos(entrada.fundoTrocoCentavos);
  validarAbertura(fundo);

  const terminal = await prisma.terminal.findUnique({ where: { id: entrada.terminalId } });
  if (!terminal || !terminal.ativo) {
    throw new ErroCaixa('TERMINAL_INEXISTENTE', 'Terminal não encontrado ou inativo.');
  }

  const jaAberta = await prisma.sessaoCaixa.findFirst({
    where: { terminalId: entrada.terminalId, status: 'ABERTA' },
    select: { id: true },
  });
  if (jaAberta) {
    throw new ErroCaixa(
      'SESSAO_JA_ABERTA',
      'Já existe uma sessão de caixa aberta neste terminal. Feche-a antes de abrir outra.',
    );
  }

  const sessao = await prisma.$transaction(async (tx) => {
    const nova = await tx.sessaoCaixa.create({
      data: {
        terminalId: entrada.terminalId,
        operadorId: contexto.operadorId,
        fundoTrocoCentavos: fundo,
      },
    });
    await tx.movimentoCaixa.create({
      data: {
        sessaoCaixaId: nova.id,
        tipo: 'ABERTURA',
        valorCentavos: fundo,
        usuarioId: contexto.operadorId,
        observacao: 'Abertura de caixa',
      },
    });
    return nova;
  });

  return { id: sessao.id };
}

// ---------------------------------------------------------------------------
// Sangria e suprimento
// ---------------------------------------------------------------------------

export interface MovimentoManualEntrada {
  readonly sessaoCaixaId: string;
  readonly tipo: TipoMovimentoManual;
  readonly valorCentavos: number;
  readonly observacao?: string | undefined;
  readonly autorizadoPorId?: string | undefined;
}

export async function registrarMovimentoManual(
  prisma: PrismaClient,
  entrada: MovimentoManualEntrada,
  contexto: { operadorId: string },
): Promise<{ id: string }> {
  const valor = centavos(entrada.valorCentavos);
  const ehGerente = await autorizadorEhGerente(prisma, entrada.autorizadoPorId);

  // Sangria e suprimento NÃO têm alçada de operador: toda operação exige
  // gerente, sem exceção de valor pequeno — é o ponto clássico de fraude
  // interna que a auditoria precisa cobrir sempre.
  validarMovimentoManual(entrada.tipo, valor, {
    autorizadoPorId: entrada.autorizadoPorId,
    autorizadorEhGerente: ehGerente,
  });

  const sessao = await prisma.sessaoCaixa.findUnique({
    where: { id: entrada.sessaoCaixaId },
    select: { status: true },
  });
  if (!sessao) throw new ErroCaixa('SESSAO_INEXISTENTE', 'Sessão de caixa não encontrada.');
  if (sessao.status !== 'ABERTA') {
    throw new ErroCaixa('SESSAO_FECHADA', 'A sessão de caixa já foi fechada.');
  }

  const movimento = await prisma.$transaction(async (tx) => {
    const registro = await tx.movimentoCaixa.create({
      data: {
        sessaoCaixaId: entrada.sessaoCaixaId,
        tipo: entrada.tipo,
        valorCentavos: sinalDoMovimentoManual(entrada.tipo, valor),
        observacao: entrada.observacao ?? null,
        usuarioId: contexto.operadorId,
        autorizadoPorId: entrada.autorizadoPorId!,
      },
    });

    // Sangria e suprimento envolvem dinheiro saindo/entrando fora do fluxo de
    // venda — sempre auditado, com o valor e quem autorizou.
    await tx.registroAuditoria.create({
      data: {
        acao: entrada.tipo,
        entidade: 'SessaoCaixa',
        entidadeId: entrada.sessaoCaixaId,
        usuarioId: contexto.operadorId,
        autorizadoPorId: entrada.autorizadoPorId!,
        valorDepois: { valorCentavos: valor, observacao: entrada.observacao ?? null },
      },
    });

    return registro;
  });

  return { id: movimento.id };
}

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

export interface FecharSessaoEntrada {
  readonly sessaoCaixaId: string;
  readonly valorContadoCentavos: number;
}

export interface ResultadoFecharSessao {
  readonly valorEsperadoCentavos: number;
  readonly valorContadoCentavos: number;
  readonly diferencaCentavos: number;
}

export async function fecharSessao(
  prisma: PrismaClient,
  entrada: FecharSessaoEntrada,
  contexto: { operadorId: string },
): Promise<ResultadoFecharSessao> {
  const sessao = await prisma.sessaoCaixa.findUnique({
    where: { id: entrada.sessaoCaixaId },
    select: { id: true, status: true, fundoTrocoCentavos: true },
  });
  if (!sessao) throw new ErroCaixa('SESSAO_INEXISTENTE', 'Sessão de caixa não encontrada.');
  if (sessao.status !== 'ABERTA') {
    throw new ErroCaixa('SESSAO_JA_FECHADA', 'Esta sessão de caixa já está fechada.');
  }

  // Soma tudo que aconteceu na sessão, exceto a abertura (já está no fundo).
  const agregado = await prisma.movimentoCaixa.aggregate({
    where: { sessaoCaixaId: entrada.sessaoCaixaId, tipo: { not: 'ABERTURA' } },
    _sum: { valorCentavos: true },
  });
  const outrosMovimentos = centavos(agregado._sum.valorCentavos ?? 0);
  const valorContado = centavos(entrada.valorContadoCentavos);

  const resultado = calcularFechamento(
    { fundoTrocoCentavos: centavos(sessao.fundoTrocoCentavos), outrosMovimentosCentavos: outrosMovimentos },
    valorContado,
  );

  await prisma.$transaction(async (tx) => {
    await tx.sessaoCaixa.update({
      where: { id: sessao.id },
      data: {
        status: 'FECHADA',
        fechadaEm: new Date(),
        valorContadoCentavos: valorContado,
        diferencaCentavos: resultado.diferencaCentavos,
      },
    });

    await tx.movimentoCaixa.create({
      data: {
        sessaoCaixaId: sessao.id,
        tipo: 'FECHAMENTO',
        valorCentavos: 0,
        usuarioId: contexto.operadorId,
        observacao: `Contado: ${valorContado}, esperado: ${resultado.valorEsperadoCentavos}`,
      },
    });

    // Divergência sempre vira auditoria — o fechamento não é bloqueado por
    // ela, mas o fato de a gaveta não bater precisa ficar registrado.
    if (resultado.temDivergencia) {
      await tx.registroAuditoria.create({
        data: {
          acao: 'DIVERGENCIA_FECHAMENTO_CAIXA',
          entidade: 'SessaoCaixa',
          entidadeId: sessao.id,
          usuarioId: contexto.operadorId,
          valorAntes: { esperadoCentavos: resultado.valorEsperadoCentavos },
          valorDepois: {
            contadoCentavos: valorContado,
            diferencaCentavos: resultado.diferencaCentavos,
          },
        },
      });
    }
  });

  return {
    valorEsperadoCentavos: resultado.valorEsperadoCentavos,
    valorContadoCentavos: valorContado,
    diferencaCentavos: resultado.diferencaCentavos,
  };
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export interface StatusSessao {
  readonly id: string;
  readonly terminalId: string;
  readonly fundoTrocoCentavos: number;
  readonly abertaEm: Date;
  readonly saldoEsperadoCentavos: number;
}

/** Sessão aberta de um terminal, com o saldo esperado calculado ao vivo — usado pela tela do caixa e pela conferência antes de fechar. */
export async function obterSessaoAberta(
  prisma: PrismaClient,
  terminalId: string,
): Promise<StatusSessao | null> {
  const sessao = await prisma.sessaoCaixa.findFirst({
    where: { terminalId, status: 'ABERTA' },
  });
  if (!sessao) return null;

  const agregado = await prisma.movimentoCaixa.aggregate({
    where: { sessaoCaixaId: sessao.id, tipo: { not: 'ABERTURA' } },
    _sum: { valorCentavos: true },
  });
  const saldoEsperado = somar(
    centavos(sessao.fundoTrocoCentavos),
    centavos(agregado._sum.valorCentavos ?? 0),
  );

  return {
    id: sessao.id,
    terminalId: sessao.terminalId,
    fundoTrocoCentavos: sessao.fundoTrocoCentavos,
    abertaEm: sessao.abertaEm,
    saldoEsperadoCentavos: saldoEsperado,
  };
}
