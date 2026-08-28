/**
 * Servidor Fastify do PDV.
 *
 * Responsabilidade desta camada: validar formato (Zod), identificar o
 * operador, chamar o serviço e traduzir erro de domínio em status HTTP.
 * Nenhuma regra de dinheiro mora aqui.
 */

import fastifyJwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type TokenOperador, verificarSenha } from './autenticacao.js';
import { carregarConfiguracao, type Configuracao } from './config.js';
import { ErroCaixa, ErroDevolucao, ErroVenda } from '@pdv/shared';
import { esquemaAbrirSessao, esquemaFecharSessao, esquemaMovimentoManual } from './esquemas/caixa.js';
import { esquemaRegistrarDevolucao } from './esquemas/devolucao.js';
import { esquemaRegistrarVenda } from './esquemas/venda.js';
import { obterDisponivelParaDevolucao, registrarDevolucao } from './servicos/devolucao.js';
import {
  abrirSessao,
  fecharSessao,
  obterSessaoAberta,
  registrarMovimentoManual,
} from './servicos/sessao-caixa.js';
import { registrarVenda } from './servicos/registrar-venda.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenOperador;
    user: TokenOperador;
  }
}

/**
 * Erro de negócio → status HTTP.
 *
 * O padrão é 422 (a requisição está bem formada, mas a regra de negócio
 * recusa). 409 é reservado para conflito de estado, e 403 para falta de
 * permissão — o frontend usa isso para decidir se abre a tela de liberação
 * de gerente ou apenas mostra a mensagem.
 */
const STATUS_POR_CODIGO: Readonly<Record<string, number>> = {
  DESCONTO_ACIMA_DA_ALCADA: 403,
  AUTORIZADOR_SEM_PERMISSAO: 403,
  LIMITE_CREDIARIO_EXCEDIDO: 403,
  SESSAO_FECHADA: 409,
  SESSAO_INEXISTENTE: 404,
  VARIANTE_INEXISTENTE: 404,
  CLIENTE_INEXISTENTE: 404,
  OPERADOR_INVALIDO: 401,
  // Caixa
  AUTORIZACAO_OBRIGATORIA: 403,
  TERMINAL_INEXISTENTE: 404,
  SESSAO_JA_ABERTA: 409,
  SESSAO_JA_FECHADA: 409,
  // Devolução
  VENDA_INEXISTENTE: 404,
  QUANTIDADE_MAIOR_QUE_DISPONIVEL: 422,
  ITEM_INEXISTENTE: 404,
};

export async function construirServidor(
  configuracao: Configuracao = carregarConfiguracao(),
  prisma: PrismaClient = new PrismaClient(),
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: configuracao.NODE_ENV === 'production' ? 'info' : 'debug' },
    // O caixa gera o UUID da venda; correlacionar log com venda facilita suporte.
    genReqId: (requisicao) => (requisicao.headers['x-request-id'] as string) ?? crypto.randomUUID(),
  });

  await app.register(fastifyJwt, {
    secret: configuracao.JWT_SEGREDO,
    sign: { expiresIn: '12h' }, // cobre um turno inteiro de loja
  });

  async function exigirOperador(requisicao: FastifyRequest): Promise<void> {
    await requisicao.jwtVerify();
  }

  // --- Saúde ---------------------------------------------------------------

  app.get('/saude', async () => ({
    ok: true,
    fiscalHabilitado: configuracao.FISCAL_HABILITADO,
    emissao: 'COMPROVANTE_NAO_FISCAL',
  }));

  // --- Login ---------------------------------------------------------------

  const esquemaLogin = z.object({
    login: z.string().min(1),
    senha: z.string().min(1),
  });

  app.post('/sessao/login', async (requisicao, resposta) => {
    const entrada = esquemaLogin.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { login: entrada.data.login },
      select: { id: true, nome: true, papel: true, senhaHash: true, ativo: true, limiteDescontoBps: true },
    });

    // Mensagem única para login inexistente e senha errada: não entregamos ao
    // atacante a informação de quais logins existem.
    const senhaConfere =
      usuario !== null && usuario.ativo && (await verificarSenha(entrada.data.senha, usuario.senhaHash));
    if (!usuario || !senhaConfere) {
      return resposta.status(401).send({ codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'Login ou senha incorretos.' });
    }

    const token = app.jwt.sign({ sub: usuario.id, nome: usuario.nome, papel: usuario.papel });
    return {
      token,
      operador: {
        id: usuario.id,
        nome: usuario.nome,
        papel: usuario.papel,
        limiteDescontoBps: usuario.limiteDescontoBps,
      },
    };
  });

  // --- Venda ---------------------------------------------------------------

  /**
   * Registra uma venda já fechada no caixa.
   *
   * IDEMPOTENTE: o mesmo `id` (UUID gerado no caixa) nunca gera duas vendas.
   * Um retry da fila offline devolve 200 com a venda existente; o primeiro
   * envio devolve 201. A fila trata os dois como sucesso e descarta o item.
   */
  app.post('/vendas', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const entrada = esquemaRegistrarVenda.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({
        codigo: 'ENTRADA_INVALIDA',
        erros: entrada.error.issues.map((problema) => ({
          campo: problema.path.join('.'),
          mensagem: problema.message,
        })),
      });
    }

    try {
      const resultado = await registrarVenda(prisma, entrada.data, {
        operadorId: requisicao.user.sub,
      });
      return resposta.status(resultado.jaEstavaRegistrada ? 200 : 201).send(resultado);
    } catch (erro) {
      if (erro instanceof ErroVenda) {
        const status = STATUS_POR_CODIGO[erro.codigo] ?? 422;
        return resposta.status(status).send({ codigo: erro.codigo, mensagem: erro.message });
      }
      throw erro;
    }
  });

  // --- Devolução / cancelamento ---------------------------------------------

  /**
   * Localiza uma venda pelo número sequencial impresso no comprovante — é o
   * identificador que o operador tem em mãos ao atender uma devolução, não
   * o UUID interno.
   */
  app.get('/vendas/por-numero/:numero', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const parametros = z.object({ numero: z.coerce.number().int().positive() }).safeParse(requisicao.params);
    if (!parametros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: parametros.error.issues });
    }
    const venda = await prisma.venda.findUnique({
      where: { numero: parametros.data.numero },
      select: { id: true, numero: true, totalCentavos: true, registradaEm: true },
    });
    if (!venda) return resposta.status(404).send({ codigo: 'VENDA_INEXISTENTE' });
    return venda;
  });

  /**
   * Localiza uma venda pelo prefixo do UUID — o código curto impresso no
   * comprovante ("ABC12345"). Existe porque o número sequencial só é
   * atribuído quando o servidor confirma a venda; uma venda ainda na fila de
   * sincronização offline não tem número, mas já tem esse código impresso.
   */
  app.get('/vendas/por-codigo/:codigo', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const parametros = z
      .object({ codigo: z.string().regex(/^[0-9a-fA-F]{8}$/, 'Código deve ter 8 caracteres hexadecimais') })
      .safeParse(requisicao.params);
    if (!parametros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: parametros.error.issues });
    }

    const vendas = await prisma.venda.findMany({
      where: { id: { startsWith: parametros.data.codigo.toLowerCase() } },
      select: { id: true, numero: true, totalCentavos: true, registradaEm: true },
      take: 2,
    });

    if (vendas.length === 0) return resposta.status(404).send({ codigo: 'VENDA_INEXISTENTE' });
    if (vendas.length > 1) {
      // Extremamente improvável (8 hex = 4 bilhões de combinações), mas se
      // colidir é melhor recusar explicitamente do que devolver a errada.
      return resposta
        .status(409)
        .send({ codigo: 'CODIGO_AMBIGUO', mensagem: 'Mais de uma venda com esse código. Use o número da venda.' });
    }
    return vendas[0];
  });

  /**
   * Itens da venda com o disponível para devolução — a UI monta a tela de
   * devolução a partir daqui, sabendo quanto de cada item já foi devolvido.
   */
  app.get(
    '/vendas/:id/disponivel-para-devolucao',
    { preHandler: exigirOperador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      if (!parametros.success) {
        return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: parametros.error.issues });
      }
      const disponivel = await obterDisponivelParaDevolucao(prisma, parametros.data.id);
      if (!disponivel) return resposta.status(404).send({ codigo: 'VENDA_INEXISTENTE' });
      return disponivel;
    },
  );

  /**
   * Registra devolução (parcial ou total) de itens de uma venda.
   *
   * A venda original NUNCA é alterada — o banco impede fisicamente qualquer
   * UPDATE nela. Devolução é sempre um documento novo (Cancelamento) que
   * aponta para a venda, exatamente como o briefing original exige.
   *
   * Exige gerente identificado SEM alçada de valor — mesma disciplina de
   * sangria/suprimento: mexer em dinheiro fora do fluxo normal de venda é o
   * ponto clássico de fraude interna.
   */
  app.post(
    '/vendas/:id/devolucao',
    { preHandler: exigirOperador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      const entrada = esquemaRegistrarDevolucao.safeParse(requisicao.body);
      if (!parametros.success || !entrada.success) {
        return resposta.status(400).send({
          codigo: 'ENTRADA_INVALIDA',
          erros: [...(parametros.success ? [] : parametros.error.issues), ...(entrada.success ? [] : entrada.error.issues)],
        });
      }
      try {
        const resultado = await registrarDevolucao(
          prisma,
          { vendaId: parametros.data.id, ...entrada.data },
          { operadorId: requisicao.user.sub },
        );
        return resposta.status(201).send(resultado);
      } catch (erro) {
        if (erro instanceof ErroDevolucao) {
          const status = STATUS_POR_CODIGO[erro.codigo] ?? 422;
          return resposta.status(status).send({ codigo: erro.codigo, mensagem: erro.message });
        }
        throw erro;
      }
    },
  );

  // --- Catálogo ------------------------------------------------------------

  const esquemaCatalogo = z.object({
    /** Marca d'água da última sincronização. Ausente = carga completa. */
    desde: z.coerce.date().optional(),
    /** Desempate do cursor: último id recebido com aquele mesmo `desde`. */
    ultimoId: z.string().uuid().optional(),
    limite: z.coerce.number().int().min(1).max(1000).default(500),
  });

  /**
   * Catálogo para o caixa, em páginas incrementais.
   *
   * Com mais de 10 mil SKUs, baixar tudo a cada sincronização é inviável — a
   * abertura do caixa levaria minutos. O cliente guarda o `atualizadoEm` do
   * último item recebido e pede só o que mudou desde então.
   *
   * A paginação é por CHAVE (`atualizadoEm`, `id`), não por OFFSET. Com offset,
   * uma escrita concorrente desloca as linhas e a página seguinte pula
   * registros — um produto sumiria do caixa sem ninguém perceber. O desempate
   * por `id` cobre o caso de várias variantes gravadas no mesmo milissegundo.
   *
   * Variante desativada não é removida: ela volta com `ativo: false` e o caixa
   * a remove do índice local. Exclusão silenciosa deixaria produto fantasma.
   */
  app.get('/catalogo', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const entrada = esquemaCatalogo.safeParse(requisicao.query);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    const { desde, ultimoId, limite } = entrada.data;

    const filtro =
      desde === undefined
        ? {}
        : ultimoId === undefined
          ? { atualizadoEm: { gt: desde } }
          : {
              OR: [
                { atualizadoEm: { gt: desde } },
                { atualizadoEm: desde, id: { gt: ultimoId } },
              ],
            };

    // Pede um a mais que o limite para saber se há próxima página sem COUNT.
    const encontradas = await prisma.variante.findMany({
      where: filtro,
      orderBy: [{ atualizadoEm: 'asc' }, { id: 'asc' }],
      take: limite + 1,
      select: {
        id: true,
        sku: true,
        codigoBarras: true,
        tamanho: true,
        cor: true,
        precoCentavos: true,
        ativo: true,
        atualizadoEm: true,
        produto: {
          select: { nome: true, marca: true, ativo: true, categoria: { select: { nome: true } } },
        },
      },
    });

    const temMais = encontradas.length > limite;
    const pagina = temMais ? encontradas.slice(0, limite) : encontradas;
    const ultima = pagina.at(-1);

    return {
      itens: pagina.map((variante) => ({
        id: variante.id,
        sku: variante.sku,
        codigoBarras: variante.codigoBarras,
        nome: variante.produto.nome,
        marca: variante.produto.marca,
        categoria: variante.produto.categoria?.nome ?? null,
        tamanho: variante.tamanho,
        cor: variante.cor,
        precoCentavos: variante.precoCentavos,
        // Produto inativo derruba todas as suas variantes de uma vez.
        ativo: variante.ativo && variante.produto.ativo,
        atualizadoEm: variante.atualizadoEm.toISOString(),
      })),
      proximoDesde: ultima?.atualizadoEm.toISOString() ?? null,
      proximoUltimoId: ultima?.id ?? null,
      temMais,
    };
  });

  // --- Sessão de caixa -------------------------------------------------------

  /** Traduz ErroCaixa em status HTTP, igual ao que já existe para ErroVenda. */
  function tratarErroCaixa(erro: unknown, resposta: FastifyReply): FastifyReply | never {
    if (erro instanceof ErroCaixa) {
      const status = STATUS_POR_CODIGO[erro.codigo] ?? 422;
      return resposta.status(status).send({ codigo: erro.codigo, mensagem: erro.message });
    }
    throw erro;
  }

  /**
   * Abre uma sessão de caixa no terminal informado.
   *
   * Recusa com 409 se o terminal já tiver uma sessão aberta — abrir duas
   * sessões simultâneas no mesmo caixa físico duplicaria onde a venda lança
   * o dinheiro.
   */
  app.post('/sessoes-caixa', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const entrada = esquemaAbrirSessao.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    try {
      const sessao = await abrirSessao(prisma, entrada.data, { operadorId: requisicao.user.sub });
      return resposta.status(201).send(sessao);
    } catch (erro) {
      return tratarErroCaixa(erro, resposta);
    }
  });

  /** Sessão aberta de um terminal — usado pelo caixa para saber onde lançar a venda. */
  app.get('/sessoes-caixa/aberta', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const esquemaConsulta = z.object({ terminalId: z.string().uuid() });
    const entrada = esquemaConsulta.safeParse(requisicao.query);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    const sessao = await obterSessaoAberta(prisma, entrada.data.terminalId);
    if (!sessao) return resposta.status(404).send({ codigo: 'SESSAO_INEXISTENTE' });
    return sessao;
  });

  /**
   * Sangria (retirada) ou suprimento (reforço) de caixa.
   *
   * SEMPRE exige gerente identificado, sem alçada de valor — diferente do
   * desconto de venda, que o operador concede sozinho até um limite. Mexer na
   * gaveta fora do fluxo de venda é o ponto clássico de fraude interna.
   */
  app.post(
    '/sessoes-caixa/:id/movimentos',
    { preHandler: exigirOperador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      const entrada = esquemaMovimentoManual.safeParse(requisicao.body);
      if (!parametros.success || !entrada.success) {
        return resposta.status(400).send({
          codigo: 'ENTRADA_INVALIDA',
          erros: [...(parametros.success ? [] : parametros.error.issues), ...(entrada.success ? [] : entrada.error.issues)],
        });
      }
      try {
        const movimento = await registrarMovimentoManual(
          prisma,
          { sessaoCaixaId: parametros.data.id, ...entrada.data },
          { operadorId: requisicao.user.sub },
        );
        return resposta.status(201).send(movimento);
      } catch (erro) {
        return tratarErroCaixa(erro, resposta);
      }
    },
  );

  /**
   * Fecha a sessão de caixa.
   *
   * Divergência entre o valor contado e o esperado NUNCA bloqueia o
   * fechamento — a loja precisa poder encerrar o dia mesmo com a gaveta
   * batendo errado — mas é sempre registrada em auditoria.
   */
  app.post(
    '/sessoes-caixa/:id/fechar',
    { preHandler: exigirOperador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      const entrada = esquemaFecharSessao.safeParse(requisicao.body);
      if (!parametros.success || !entrada.success) {
        return resposta.status(400).send({
          codigo: 'ENTRADA_INVALIDA',
          erros: [...(parametros.success ? [] : parametros.error.issues), ...(entrada.success ? [] : entrada.error.issues)],
        });
      }
      try {
        const resultado = await fecharSessao(
          prisma,
          { sessaoCaixaId: parametros.data.id, ...entrada.data },
          { operadorId: requisicao.user.sub },
        );
        return resultado;
      } catch (erro) {
        return tratarErroCaixa(erro, resposta);
      }
    },
  );

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}

/** Ponto de entrada. Só executa quando este arquivo é o módulo principal. */
const ehModuloPrincipal =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (ehModuloPrincipal) {
  const configuracao = carregarConfiguracao();
  const app = await construirServidor(configuracao);
  await app.listen({ port: configuracao.PORTA, host: '0.0.0.0' });
}
