/**
 * Serviço de gestão de operadores (equipe).
 *
 * Criar/editar é permissão permanente do cargo — a checagem de papel
 * (`validarPermissaoGestaoOperadores`) acontece aqui, não é um overlay de
 * autorização pontual como sangria ou desconto acima da alçada.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { ErroOperador, type Papel, validarCadastroOperador, validarPermissaoGestaoOperadores } from '@pdv/shared';
import { gerarHashSenha } from '../autenticacao.js';
import type { EntradaAtualizarOperador, EntradaCriarOperador } from '../esquemas/operador.js';

export interface OperadorListado {
  readonly id: string;
  readonly nome: string;
  readonly login: string;
  readonly papel: string;
  readonly limiteDescontoBps: number;
  readonly ativo: boolean;
}

export async function listarOperadores(
  prisma: PrismaClient,
  opcoes: { somenteAtivos: boolean },
): Promise<readonly OperadorListado[]> {
  const operadores = await prisma.usuario.findMany({
    where: opcoes.somenteAtivos ? { ativo: true } : {},
    select: { id: true, nome: true, login: true, papel: true, limiteDescontoBps: true, ativo: true },
    orderBy: { nome: 'asc' },
  });
  return operadores;
}

export async function criarOperador(
  prisma: PrismaClient,
  entrada: EntradaCriarOperador,
  contexto: { papelDeQuemPede: Papel },
): Promise<{ id: string }> {
  validarPermissaoGestaoOperadores(contexto.papelDeQuemPede);
  validarCadastroOperador(entrada.nome, entrada.login, entrada.senha);

  const senhaHash = await gerarHashSenha(entrada.senha);
  try {
    const usuario = await prisma.usuario.create({
      data: {
        nome: entrada.nome.trim(),
        login: entrada.login.trim(),
        senhaHash,
        papel: entrada.papel,
        limiteDescontoBps: entrada.limiteDescontoBps,
      },
    });
    return { id: usuario.id };
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      throw new ErroOperador('LOGIN_EM_USO', 'Já existe um operador com este login.');
    }
    throw erro;
  }
}

export async function atualizarOperador(
  prisma: PrismaClient,
  operadorId: string,
  entrada: EntradaAtualizarOperador,
  contexto: { papelDeQuemPede: Papel },
): Promise<{ id: string }> {
  validarPermissaoGestaoOperadores(contexto.papelDeQuemPede);

  const existente = await prisma.usuario.findUnique({ where: { id: operadorId }, select: { id: true } });
  if (!existente) throw new ErroOperador('OPERADOR_INEXISTENTE', 'Operador não encontrado.');

  const senhaHash = entrada.novaSenha ? await gerarHashSenha(entrada.novaSenha) : undefined;

  await prisma.usuario.update({
    where: { id: operadorId },
    data: {
      ...(entrada.nome !== undefined && { nome: entrada.nome.trim() }),
      ...(entrada.papel !== undefined && { papel: entrada.papel }),
      ...(entrada.limiteDescontoBps !== undefined && { limiteDescontoBps: entrada.limiteDescontoBps }),
      ...(entrada.ativo !== undefined && { ativo: entrada.ativo }),
      ...(senhaHash !== undefined && { senhaHash }),
    },
  });
  return { id: operadorId };
}
