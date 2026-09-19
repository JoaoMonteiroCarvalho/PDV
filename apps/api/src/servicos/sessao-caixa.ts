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

// ---------------------------------------------------------------------------
// Relatório de fechamento (Z)
// ---------------------------------------------------------------------------

/**
 * O documento do fim do turno.
 *
 * Antes, fechar o caixa devolvia três números — esperado, contado, diferença —
 * e mais nada. Isso responde "bateu?" mas não "bateu com o quê?": sem a quebra
 * por forma de pagamento não dá para conciliar o extrato da maquininha nem
 * saber quanto do dia foi Pix.
 *
 * **Só DINHEIRO entra na conferência da gaveta.** Cartão e Pix não passam pela
 * gaveta — a maquininha opera separada do PDV —, e crediário não é dinheiro
 * recebido, é promessa. Somá-los ao esperado faria toda gaveta fechar com
 * sobra fantasma. Eles aparecem no relatório porque o turno os movimentou, não
 * porque entram no caixa físico.
 *
 * O valor por forma é LÍQUIDO do troco: a nota de R$ 100 dada para pagar R$ 50
 * é R$ 50 de dinheiro na gaveta, não R$ 100.
 */
export interface RelatorioFechamento {
  readonly sessaoId: string;
  readonly terminal: string;
  readonly operador: string;
  readonly abertaEm: Date;
  readonly fechadaEm: Date | null;
  readonly status: 'ABERTA' | 'FECHADA';
  readonly vendas: { readonly quantidade: number; readonly totalCentavos: number };
  readonly porForma: readonly {
    readonly forma: string;
    readonly quantidade: number;
    readonly totalCentavos: number;
  }[];
  readonly gaveta: {
    readonly fundoTrocoCentavos: number;
    readonly vendasEmDinheiroCentavos: number;
    readonly recebimentosCrediarioCentavos: number;
    readonly suprimentosCentavos: number;
    readonly sangriasCentavos: number;
    readonly devolucoesCentavos: number;
    readonly esperadoCentavos: number;
    readonly contadoCentavos: number | null;
    readonly diferencaCentavos: number | null;
  };
  readonly movimentos: readonly {
    readonly tipo: string;
    readonly valorCentavos: number;
    readonly observacao: string | null;
    readonly criadoEm: Date;
    readonly usuario: string;
    readonly autorizadoPor: string | null;
  }[];
}

export async function gerarRelatorioFechamento(
  prisma: PrismaClient,
  sessaoCaixaId: string,
): Promise<RelatorioFechamento> {
  const sessao = await prisma.sessaoCaixa.findUnique({
    where: { id: sessaoCaixaId },
    select: {
      id: true,
      status: true,
      abertaEm: true,
      fechadaEm: true,
      fundoTrocoCentavos: true,
      valorContadoCentavos: true,
      diferencaCentavos: true,
      terminal: { select: { nome: true } },
      operador: { select: { nome: true } },
    },
  });
  if (!sessao) throw new ErroCaixa('SESSAO_INEXISTENTE', 'Sessão de caixa não encontrada.');

  const vendas = await prisma.venda.findMany({
    where: { sessaoCaixaId },
    select: {
      totalCentavos: true,
      pagamentos: { select: { forma: true, valorCentavos: true, trocoCentavos: true } },
    },
  });

  const porForma = new Map<string, { quantidade: number; totalCentavos: number }>();
  let totalVendido = 0;
  for (const venda of vendas) {
    totalVendido += venda.totalCentavos;
    for (const pagamento of venda.pagamentos) {
      const acumulado = porForma.get(pagamento.forma) ?? { quantidade: 0, totalCentavos: 0 };
      porForma.set(pagamento.forma, {
        quantidade: acumulado.quantidade + 1,
        totalCentavos:
          acumulado.totalCentavos + pagamento.valorCentavos - pagamento.trocoCentavos,
      });
    }
  }

  const movimentos = await prisma.movimentoCaixa.findMany({
    where: { sessaoCaixaId },
    orderBy: { criadoEm: 'asc' },
    select: {
      tipo: true,
      valorCentavos: true,
      observacao: true,
      criadoEm: true,
      usuario: { select: { nome: true } },
      autorizadoPor: { select: { nome: true } },
    },
  });

  /** Soma os movimentos de um tipo. O sinal do banco é preservado. */
  const somaDoTipo = (tipo: string): number =>
    movimentos
      .filter((movimento) => movimento.tipo === tipo)
      .reduce((total, movimento) => total + movimento.valorCentavos, 0);

  const vendasEmDinheiro = somaDoTipo('VENDA_DINHEIRO');
  const recebimentos = somaDoTipo('RECEBIMENTO_CREDIARIO');
  const suprimentos = somaDoTipo('SUPRIMENTO');
  const sangrias = somaDoTipo('SANGRIA');
  const devolucoes = somaDoTipo('CANCELAMENTO');

  // Mesmo cálculo do fechamento: fundo + tudo que não é a abertura.
  const esperado =
    sessao.fundoTrocoCentavos +
    movimentos
      .filter((movimento) => movimento.tipo !== 'ABERTURA')
      .reduce((total, movimento) => total + movimento.valorCentavos, 0);

  return {
    sessaoId: sessao.id,
    terminal: sessao.terminal.nome,
    operador: sessao.operador.nome,
    abertaEm: sessao.abertaEm,
    fechadaEm: sessao.fechadaEm,
    status: sessao.status,
    vendas: { quantidade: vendas.length, totalCentavos: totalVendido },
    porForma: [...porForma.entries()]
      .map(([forma, dados]) => ({ forma, ...dados }))
      .sort((a, b) => b.totalCentavos - a.totalCentavos),
    gaveta: {
      fundoTrocoCentavos: sessao.fundoTrocoCentavos,
      vendasEmDinheiroCentavos: vendasEmDinheiro,
      recebimentosCrediarioCentavos: recebimentos,
      suprimentosCentavos: suprimentos,
      sangriasCentavos: sangrias,
      devolucoesCentavos: devolucoes,
      esperadoCentavos: esperado,
      contadoCentavos: sessao.valorContadoCentavos,
      diferencaCentavos: sessao.diferencaCentavos,
    },
    movimentos: movimentos.map((movimento) => ({
      tipo: movimento.tipo,
      valorCentavos: movimento.valorCentavos,
      observacao: movimento.observacao,
      criadoEm: movimento.criadoEm,
      usuario: movimento.usuario.nome,
      autorizadoPor: movimento.autorizadoPor?.nome ?? null,
    })),
  };
}
