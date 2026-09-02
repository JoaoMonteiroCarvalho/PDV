/**
 * Usuários e configuração da loja.
 *
 * Duas regras governam este arquivo, e as duas existem para o mesmo fim:
 * ninguém consegue se promover nem apagar o próprio rastro.
 *
 *   1. Só GERENTE e ADMIN administram usuários. Operador não cria, não muda
 *      papel, não redefine senha de ninguém.
 *   2. Usuário nunca é APAGADO, só desativado. Ele assina venda, sangria e
 *      auditoria; deletar romperia a chave estrangeira ou, pior, apagaria de
 *      quem foi a ação.
 */

import { gerarHashSenha } from '../autenticacao.js';
import type { PrismaClient } from '@prisma/client';

export class ErroAdministracao extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroAdministracao';
  }
}

export type Papel = 'OPERADOR' | 'GERENTE' | 'ADMIN';

export function podeAdministrar(papel: string): boolean {
  return papel === 'GERENTE' || papel === 'ADMIN';
}

const CAMPOS_PUBLICOS = {
  id: true,
  nome: true,
  login: true,
  papel: true,
  limiteDescontoBps: true,
  ativo: true,
  criadoEm: true,
} as const;

export async function listarUsuarios(prisma: PrismaClient) {
  // Inclui os inativos: quem administra precisa ver quem foi desativado para
  // poder reativar, e sumir com eles esconderia metade da informação.
  return prisma.usuario.findMany({ orderBy: [{ ativo: 'desc' }, { nome: 'asc' }], select: CAMPOS_PUBLICOS });
}

export interface CriarUsuarioEntrada {
  readonly nome: string;
  readonly login: string;
  readonly senha: string;
  readonly papel: Papel;
  readonly limiteDescontoBps: number;
}

export async function criarUsuario(prisma: PrismaClient, entrada: CriarUsuarioEntrada) {
  const existente = await prisma.usuario.findUnique({
    where: { login: entrada.login },
    select: { id: true },
  });
  if (existente) {
    throw new ErroAdministracao('LOGIN_EM_USO', `Já existe usuário com o login "${entrada.login}".`);
  }

  return prisma.usuario.create({
    data: {
      nome: entrada.nome,
      login: entrada.login,
      senhaHash: await gerarHashSenha(entrada.senha),
      papel: entrada.papel,
      limiteDescontoBps: entrada.limiteDescontoBps,
    },
    select: CAMPOS_PUBLICOS,
  });
}

export interface AtualizarUsuarioEntrada {
  readonly nome?: string | undefined;
  readonly papel?: Papel | undefined;
  readonly limiteDescontoBps?: number | undefined;
  readonly ativo?: boolean | undefined;
}

export async function atualizarUsuario(
  prisma: PrismaClient,
  usuarioId: string,
  entrada: AtualizarUsuarioEntrada,
  contexto: { autorId: string },
) {
  const alvo = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, papel: true, ativo: true },
  });
  if (!alvo) throw new ErroAdministracao('USUARIO_INEXISTENTE', 'Usuário não encontrado.');

  /*
   * Ninguém se desativa nem se rebaixa. Não é paternalismo: numa loja com um
   * gerente só, ele se trancaria para fora do sistema e ninguém conseguiria
   * autorizar sangria nem administrar usuários até alguém mexer no banco.
   */
  if (alvo.id === contexto.autorId) {
    if (entrada.ativo === false) {
      throw new ErroAdministracao('NAO_PODE_SE_DESATIVAR', 'Você não pode desativar a si mesmo.');
    }
    if (entrada.papel && entrada.papel !== alvo.papel) {
      throw new ErroAdministracao(
        'NAO_PODE_MUDAR_PROPRIO_PAPEL',
        'Você não pode mudar o próprio papel. Peça a outro gerente.',
      );
    }
  }

  if (entrada.ativo === false || (entrada.papel && entrada.papel === 'OPERADOR')) {
    await garantirQueSobraAdministrador(prisma, alvo.id);
  }

  return prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      ...(entrada.nome !== undefined && { nome: entrada.nome }),
      ...(entrada.papel !== undefined && { papel: entrada.papel }),
      ...(entrada.limiteDescontoBps !== undefined && {
        limiteDescontoBps: entrada.limiteDescontoBps,
      }),
      ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
    },
    select: CAMPOS_PUBLICOS,
  });
}

/**
 * A loja não pode ficar sem ninguém que administre.
 *
 * Sangria exige gerente. Se o último for desativado ou rebaixado, o caixa
 * continua vendendo mas ninguém autoriza retirada nem cria usuário — e a saída
 * é mexer no banco à mão.
 */
async function garantirQueSobraAdministrador(prisma: PrismaClient, excetoId: string): Promise<void> {
  const outros = await prisma.usuario.count({
    where: { id: { not: excetoId }, ativo: true, papel: { in: ['GERENTE', 'ADMIN'] } },
  });
  if (outros === 0) {
    throw new ErroAdministracao(
      'ULTIMO_ADMINISTRADOR',
      'Este é o último gerente ativo. Promova outra pessoa antes de desativá-lo ou rebaixá-lo.',
    );
  }
}

export async function trocarSenha(
  prisma: PrismaClient,
  usuarioId: string,
  senha: string,
): Promise<{ id: string }> {
  const alvo = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true } });
  if (!alvo) throw new ErroAdministracao('USUARIO_INEXISTENTE', 'Usuário não encontrado.');

  await prisma.usuario.update({
    where: { id: usuarioId },
    data: { senhaHash: await gerarHashSenha(senha) },
  });
  return { id: usuarioId };
}

// ---------------------------------------------------------------------------
// Configuração da loja
// ---------------------------------------------------------------------------

const ID_LOJA = 'loja';

/**
 * A linha nasce com a migration, então isto sempre encontra algo. O `upsert`
 * é rede de segurança para banco criado por outro caminho — não custa nada e
 * evita a tela de configuração quebrar por uma linha faltando.
 */
export async function obterConfiguracaoLoja(prisma: PrismaClient) {
  return prisma.configuracaoLoja.upsert({
    where: { id: ID_LOJA },
    update: {},
    create: { id: ID_LOJA, nome: 'Loja' },
  });
}

export interface ConfiguracaoLojaEntrada {
  readonly nome: string;
  readonly endereco?: string | undefined;
  readonly telefone?: string | undefined;
  readonly cnpj?: string | undefined;
  readonly politicaTrocaExtra?: string | undefined;
}

export async function salvarConfiguracaoLoja(
  prisma: PrismaClient,
  entrada: ConfiguracaoLojaEntrada,
) {
  /*
   * Campo vazio vira `null`, não string vazia. O comprovante testa presença
   * (`if (loja.endereco)`) para decidir se imprime a linha; com "" ele
   * imprimiria uma linha em branco no papel.
   */
  const ouNulo = (valor: string | undefined) => (valor && valor.length > 0 ? valor : null);

  return prisma.configuracaoLoja.upsert({
    where: { id: ID_LOJA },
    update: {
      nome: entrada.nome,
      endereco: ouNulo(entrada.endereco),
      telefone: ouNulo(entrada.telefone),
      cnpj: ouNulo(entrada.cnpj),
      politicaTrocaExtra: ouNulo(entrada.politicaTrocaExtra),
    },
    create: {
      id: ID_LOJA,
      nome: entrada.nome,
      endereco: ouNulo(entrada.endereco),
      telefone: ouNulo(entrada.telefone),
      cnpj: ouNulo(entrada.cnpj),
      politicaTrocaExtra: ouNulo(entrada.politicaTrocaExtra),
    },
  });
}
