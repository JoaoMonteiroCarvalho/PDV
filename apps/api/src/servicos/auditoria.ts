/**
 * Consulta do registro de auditoria.
 *
 * O sistema já gravava auditoria em oito pontos — sangria, suprimento,
 * divergência de fechamento, desconto acima da alçada, devolução, entrada de
 * estoque, ajuste de inventário, alteração de preço — e **nada lia**. Uma
 * auditoria que ninguém consulta não dissuade ninguém: o registro existe para
 * a pergunta "quem autorizou isso?" ter resposta, e sem tela a resposta estava
 * num banco que só o desenvolvedor alcança.
 *
 * Nada aqui escreve. O registro é estritamente insert-only — quem consulta não
 * corrige, e não existe caminho no código para corrigir.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

export class ErroAuditoria extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroAuditoria';
  }
}

export interface FiltrosAuditoria {
  readonly acao?: string | undefined;
  readonly usuarioId?: string | undefined;
  /** `YYYY-MM-DD`, inclusive. */
  readonly de?: string | undefined;
  /** `YYYY-MM-DD`, inclusive — o dia inteiro entra. */
  readonly ate?: string | undefined;
  readonly pagina: number;
  readonly porPagina: number;
}

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converte `YYYY-MM-DD` no início daquele dia, no fuso do servidor.
 *
 * O recorte é por DIA DA LOJA, igual ao relatório de vendas. Com corte em UTC,
 * no Brasil toda ação depois das 21h cairia no dia seguinte, e procurar a
 * sangria "de ontem à noite" não a encontraria em ontem.
 */
function inicioDoDia(data: string): Date {
  const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number];
  return new Date(ano, mes - 1, dia, 0, 0, 0, 0);
}

function montarIntervalo(de: string | undefined, ate: string | undefined) {
  if (de !== undefined && !FORMATO_DATA.test(de)) {
    throw new ErroAuditoria('PERIODO_INVALIDO', 'Informe a data inicial no formato AAAA-MM-DD.');
  }
  if (ate !== undefined && !FORMATO_DATA.test(ate)) {
    throw new ErroAuditoria('PERIODO_INVALIDO', 'Informe a data final no formato AAAA-MM-DD.');
  }

  const inicio = de === undefined ? undefined : inicioDoDia(de);
  let fim: Date | undefined;
  if (ate !== undefined) {
    // Fim EXCLUSIVO no início do dia seguinte: a ação das 23h59 do último dia
    // entra, e nada do dia seguinte entra junto.
    fim = inicioDoDia(ate);
    fim.setDate(fim.getDate() + 1);
  }

  if (inicio && fim && inicio >= fim) {
    throw new ErroAuditoria('PERIODO_INVERTIDO', 'A data inicial é depois da final.');
  }
  return { inicio, fim };
}

export async function consultarAuditoria(prisma: PrismaClient, filtros: FiltrosAuditoria) {
  const { inicio, fim } = montarIntervalo(filtros.de, filtros.ate);

  const filtro: Prisma.RegistroAuditoriaWhereInput = {
    ...(filtros.acao ? { acao: filtros.acao } : {}),
    ...(filtros.usuarioId ? { usuarioId: filtros.usuarioId } : {}),
    ...(inicio || fim
      ? { criadoEm: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lt: fim } : {}) } }
      : {}),
  };

  const [registros, total] = await Promise.all([
    prisma.registroAuditoria.findMany({
      where: filtro,
      // Mais recente primeiro: quem abre esta tela está investigando algo que
      // acabou de acontecer, não lendo a história desde o começo.
      orderBy: { criadoEm: 'desc' },
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      select: {
        id: true,
        acao: true,
        entidade: true,
        entidadeId: true,
        valorAntes: true,
        valorDepois: true,
        criadoEm: true,
        usuario: { select: { id: true, nome: true } },
        autorizadoPor: { select: { id: true, nome: true } },
      },
    }),
    prisma.registroAuditoria.count({ where: filtro }),
  ]);

  return {
    itens: registros.map((registro) => ({
      id: registro.id,
      acao: registro.acao,
      entidade: registro.entidade,
      entidadeId: registro.entidadeId,
      valorAntes: registro.valorAntes,
      valorDepois: registro.valorDepois,
      criadoEm: registro.criadoEm,
      usuario: registro.usuario.nome,
      autorizadoPor: registro.autorizadoPor?.nome ?? null,
    })),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

/**
 * Ações que de fato existem no banco, para montar o filtro.
 *
 * Vem do banco, não de uma lista fixa no código: uma constante aqui ficaria
 * desatualizada no dia em que alguém gravasse uma ação nova, e o filtro
 * esconderia justamente o evento que ninguém esperava.
 */
export async function listarAcoes(prisma: PrismaClient): Promise<string[]> {
  const linhas = await prisma.registroAuditoria.findMany({
    distinct: ['acao'],
    orderBy: { acao: 'asc' },
    select: { acao: true },
  });
  return linhas.map((linha) => linha.acao);
}
