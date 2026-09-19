/**
 * Servidor Fastify do PDV.
 *
 * Responsabilidade desta camada: validar formato (Zod), identificar o
 * operador, chamar o serviço e traduzir erro de domínio em status HTTP.
 * Nenhuma regra de dinheiro mora aqui.
 */

import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { Prisma, PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verificarSenha } from './autenticacao.js';
import {
  VALIDADE_AUTORIZACAO,
  ehPapelAutorizador,
  ehTokenDeAutorizacao,
  ehTokenDeSessao,
  type TokenOperador,
} from './autorizacao.js';
import { carregarConfiguracao, type Configuracao } from './config.js';
import { ErroCaixa, ErroDevolucao, ErroVenda } from '@pdv/shared';
import { esquemaAbrirSessao, esquemaFecharSessao, esquemaMovimentoManual } from './esquemas/caixa.js';
import { esquemaEntradaEstoque } from './esquemas/estoque.js';
import {
  esquemaAjusteInventario,
  esquemaAtualizarProduto,
  esquemaAtualizarVariante,
  esquemaCriarCategoria,
  esquemaCriarProduto,
  esquemaHistoricoMovimentacao,
  esquemaListarProdutos,
  esquemaVarianteNova,
} from './esquemas/catalogo.js';
import {
  ErroCatalogo,
  atualizarProduto,
  atualizarVariante,
  criarCategoria,
  criarProduto,
  criarVariante,
  listarCategorias,
  listarProdutos,
  obterProduto,
} from './servicos/catalogo.js';
import { ErroAuditoria, consultarAuditoria, listarAcoes } from './servicos/auditoria.js';
import {
  esquemaAtualizarUsuario,
  esquemaConfiguracaoLoja,
  esquemaCriarUsuario,
  esquemaTrocarSenha,
} from './esquemas/administracao.js';
import {
  esquemaBuscarClientes,
  esquemaCriarCliente,
  esquemaReceberParcela,
} from './esquemas/cliente.js';
import { esquemaRegistrarDevolucao } from './esquemas/devolucao.js';
import {
  ErroEstoque,
  ajustarInventario,
  historicoMovimentacao,
  registrarEntradaEstoque,
} from './servicos/estoque.js';
import {
  ErroCliente,
  buscarClientes,
  criarCliente,
  obterCliente,
  receberParcela,
} from './servicos/cliente.js';
import { ErroRelatorio, gerarRelatorioVendas } from './servicos/relatorio.js';
import {
  ErroAdministracao,
  atualizarUsuario,
  criarUsuario,
  listarUsuarios,
  obterConfiguracaoLoja,
  podeAdministrar,
  salvarConfiguracaoLoja,
  trocarSenha,
} from './servicos/administracao.js';
import { esquemaRegistrarVenda } from './esquemas/venda.js';
import { obterDisponivelParaDevolucao, registrarDevolucao } from './servicos/devolucao.js';
import {
  abrirSessao,
  fecharSessao,
  gerarRelatorioFechamento,
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

  /**
   * Allowlist de origem. Sem isto, qualquer página aberta no navegador do
   * caixa consegue disparar requisições autenticadas contra a API.
   */
  await app.register(fastifyCors, {
    origin: configuracao.ORIGENS_PERMITIDAS,
    credentials: true,
  });

  /**
   * Teto global de requisições.
   *
   * O hash scrypt já torna cada tentativa de senha cara (~100ms), mas sem
   * limite de taxa nada impede milhares de tentativas em sequência. O login
   * tem limite próprio, bem mais apertado, declarado na rota.
   */
  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Em teste o limite atrapalharia os casos que disparam muitas requisições
    // em sequência; a proteção é de produção, não de suíte.
    global: configuracao.NODE_ENV !== 'test',
  });

  await app.register(fastifyJwt, {
    secret: configuracao.JWT_SEGREDO,
    sign: { expiresIn: '12h' }, // cobre um turno inteiro de loja
  });

  /**
   * Limite específico das rotas que recebem senha.
   *
   * Vale por login+IP: travar só por IP puniria a loja inteira, que sai por
   * um NAT só, quando uma única conta está sob ataque.
   */
  const limiteDeSenha = {
    max: configuracao.NODE_ENV === 'test' ? 10_000 : 10,
    timeWindow: '1 minute',
    keyGenerator: (requisicao: FastifyRequest) => {
      const corpo = requisicao.body as { login?: unknown } | undefined;
      const login = typeof corpo?.login === 'string' ? corpo.login : 'desconhecido';
      return `${requisicao.ip}:${login}`;
    },
  };

  /**
   * Exige sessão de trabalho válida.
   *
   * Recusa explicitamente um token de autorização pontual: ele prova que uma
   * gerente liberou UMA operação, não que ela está operando o sistema.
   */
  async function exigirOperador(
    requisicao: FastifyRequest,
    resposta: FastifyReply,
  ): Promise<void> {
    await requisicao.jwtVerify();
    if (ehTokenDeSessao(requisicao.user)) return;

    await resposta
      .status(401)
      .send({ codigo: 'TOKEN_INVALIDO', mensagem: 'Faça login novamente para continuar.' });
  }

  /**
   * Lê a identidade de quem autorizou a operação a partir do token assinado.
   *
   * A identidade NUNCA vem do corpo da requisição: é exatamente isso que
   * permitia forjar uma autorização sabendo o UUID de uma gerente. Aqui só
   * passa quem apresentou um token que o próprio servidor emitiu, contra
   * senha, minutos atrás.
   */
  function identificarAutorizador(
    tokenAutorizacao: string,
    opcoes: { readonly aceitarExpirado?: boolean } = {},
  ): string | null {
    try {
      const token = app.jwt.verify<TokenOperador>(tokenAutorizacao, {
        // A venda fecha offline e pode subir horas depois, quando o prazo de
        // 15 minutos já passou. O que impede forjar é a ASSINATURA; recusar
        // pelo prazo só descartaria uma venda já paga e impressa. Devolução e
        // sangria são online e imediatas, e mantêm o prazo.
        ignoreExpiration: opcoes.aceitarExpirado === true,
      });
      return ehTokenDeAutorizacao(token) ? token.sub : null;
    } catch {
      // Assinatura inválida, expirado ou malformado — tudo é a mesma recusa.
      return null;
    }
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

  app.post('/sessao/login', { config: { rateLimit: limiteDeSenha } }, async (requisicao, resposta) => {
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

    const token = app.jwt.sign({
      sub: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
      tipo: 'SESSAO',
    });
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

  // --- Autorização pontual de gerente --------------------------------------

  /**
   * Emite um token de autorização de vida curta, sem trocar a sessão do caixa.
   *
   * Usada quando a operadora está no meio de uma devolução ou sangria e chama
   * a gerente para liberar: a gerente digita a senha dela, o servidor devolve
   * um token assinado, e a operação segue com a operadora ainda logada.
   *
   * O token que sai daqui NÃO serve para navegar o sistema (`tipo` o separa da
   * sessão de trabalho) e vale minutos, não o turno.
   */
  app.post(
    '/sessao/autorizar',
    { config: { rateLimit: limiteDeSenha } },
    async (requisicao, resposta) => {
      const entrada = esquemaLogin.safeParse(requisicao.body);
      if (!entrada.success) {
        return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
      }

      const usuario = await prisma.usuario.findUnique({
        where: { login: entrada.data.login },
        select: { id: true, nome: true, papel: true, senhaHash: true, ativo: true },
      });

      const senhaConfere =
        usuario !== null && usuario.ativo && (await verificarSenha(entrada.data.senha, usuario.senhaHash));
      if (!usuario || !senhaConfere) {
        return resposta
          .status(401)
          .send({ codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'Login ou senha incorretos.' });
      }

      // Senha certa mas sem alçada: a mensagem pode ser específica, porque a
      // identidade já foi provada — não há o que enumerar aqui.
      if (!ehPapelAutorizador(usuario.papel)) {
        return resposta.status(403).send({
          codigo: 'AUTORIZADOR_SEM_PERMISSAO',
          mensagem: 'Esta pessoa não tem perfil de gerente para autorizar a operação.',
        });
      }

      const tokenAutorizacao = app.jwt.sign(
        { sub: usuario.id, nome: usuario.nome, papel: usuario.papel, tipo: 'AUTORIZACAO' },
        { expiresIn: VALIDADE_AUTORIZACAO },
      );

      return {
        tokenAutorizacao,
        operador: { id: usuario.id, nome: usuario.nome, papel: usuario.papel },
      };
    },
  );

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

    /*
     * Token de liberação de desconto → identidade de quem liberou.
     *
     * Token ausente ou inválido vira "sem autorização", não erro imediato: a
     * regra de alçada em `@pdv/shared` é quem decide se o desconto passava sem
     * gerente. Assim uma autorização forjada cai exatamente onde deveria —
     * DESCONTO_ACIMA_DA_ALCADA —, sem inventar um caminho de erro paralelo.
     */
    const autorizadorDe = (token: string | undefined): string | undefined =>
      token ? (identificarAutorizador(token, { aceitarExpirado: true }) ?? undefined) : undefined;

    const { tokenAutorizacao, itens, ...dadosVenda } = entrada.data;
    const venda = {
      ...dadosVenda,
      autorizadoPorId: autorizadorDe(tokenAutorizacao),
      itens: itens.map(({ tokenAutorizacao: tokenDoItem, ...item }) => ({
        ...item,
        autorizadoPorId: autorizadorDe(tokenDoItem),
      })),
    };

    try {
      const resultado = await registrarVenda(prisma, venda, {
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

  // --- Histórico de vendas ---------------------------------------------------

  const esquemaListarVendas = z.object({
    /** Sessão de caixa a listar. Sem isso o operador veria vendas de qualquer turno. */
    sessaoCaixaId: z.string().uuid().optional(),
    /** Busca por nome do cliente. Vendas sem cliente identificado não aparecem numa busca. */
    cliente: z.string().min(1).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    porPagina: z.coerce.number().int().min(1).max(100).default(20),
  });

  /**
   * Lista vendas para o operador localizar uma sem precisar do comprovante
   * físico em mãos — cobre o caso de cliente sem nota, ou nota rasgada/perdida.
   *
   * Paginação por OFFSET, não por chave: aqui é aceitável porque o volume por
   * sessão de caixa é baixo (vendas de um turno, não o catálogo inteiro) e
   * vendas nunca são editadas — só inseridas em ordem, então não há o risco
   * de deslocamento de página que a paginação por chave do catálogo evita.
   *
   * `temDevolucao` é calculado aqui para o operador ver de relance, na lista,
   * quais vendas já tiveram alguma devolução — sem precisar abrir cada uma.
   */
  app.get('/vendas', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const entrada = esquemaListarVendas.safeParse(requisicao.query);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    const { sessaoCaixaId, cliente, pagina, porPagina } = entrada.data;

    const filtro = {
      ...(sessaoCaixaId ? { sessaoCaixaId } : {}),
      ...(cliente ? { cliente: { nome: { contains: cliente, mode: 'insensitive' as const } } } : {}),
    };

    const [vendas, total] = await Promise.all([
      prisma.venda.findMany({
        where: filtro,
        orderBy: { registradaEm: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          numero: true,
          totalCentavos: true,
          registradaEm: true,
          operador: { select: { nome: true } },
          cliente: { select: { nome: true } },
          _count: { select: { cancelamentos: true } },
        },
      }),
      prisma.venda.count({ where: filtro }),
    ]);

    return {
      itens: vendas.map((venda) => ({
        id: venda.id,
        numero: venda.numero,
        totalCentavos: venda.totalCentavos,
        registradaEm: venda.registradaEm,
        operador: venda.operador.nome,
        cliente: venda.cliente?.nome ?? null,
        temDevolucao: venda._count.cancelamentos > 0,
      })),
      total,
      pagina,
      porPagina,
      totalPaginas: Math.max(1, Math.ceil(total / porPagina)),
    };
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
      const { tokenAutorizacao, ...dadosDevolucao } = entrada.data;
      const autorizadoPorId = identificarAutorizador(tokenAutorizacao);
      if (autorizadoPorId === null) {
        return resposta.status(403).send({
          codigo: 'AUTORIZADOR_SEM_PERMISSAO',
          mensagem: 'Autorização de gerente inválida ou expirada. Peça a liberação novamente.',
        });
      }

      try {
        const resultado = await registrarDevolucao(
          prisma,
          { vendaId: parametros.data.id, ...dadosDevolucao, autorizadoPorId },
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
        produtoId: true,
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

    /*
     * Saldo por variante, da view `EstoqueAtual` (soma do livro-razao).
     *
     * Consulta separada, restrita aos ids desta pagina, em vez de JOIN no
     * findMany: mantem a paginacao por chave tipada no Prisma e o custo
     * limitado ao tamanho da pagina.
     *
     * O saldo e do INSTANTE da sincronizacao. O caixa usa isso para sinalizar
     * combinacao esgotada, nunca para bloquear venda — o estoque real vive no
     * servidor, e travar a venda por um numero possivelmente defasado seria
     * pior do que vender uma peca que estava na arara.
     */
    const saldos =
      pagina.length === 0
        ? []
        : await prisma.$queryRaw<{ varianteId: string; saldo: number }[]>`
            SELECT "varianteId", "saldo" FROM "EstoqueAtual"
            WHERE "varianteId" IN (${Prisma.join(pagina.map((v) => v.id))})
          `;
    const saldoPorVariante = new Map(saldos.map((linha) => [linha.varianteId, linha.saldo]));

    return {
      itens: pagina.map((variante) => ({
        id: variante.id,
        // O caixa agrupa as variacoes pelo produto para montar a grade de
        // tamanho/cor. Agrupar por nome seria fragil: dois produtos distintos
        // podem ter o mesmo nome, e ai as grades se misturariam.
        produtoId: variante.produtoId,
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
        saldoEstoque: saldoPorVariante.get(variante.id) ?? 0,
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
      const { tokenAutorizacao, ...dadosMovimento } = entrada.data;
      const autorizadoPorId = identificarAutorizador(tokenAutorizacao);
      if (autorizadoPorId === null) {
        return resposta.status(403).send({
          codigo: 'AUTORIZADOR_SEM_PERMISSAO',
          mensagem: 'Autorização de gerente inválida ou expirada. Peça a liberação novamente.',
        });
      }

      try {
        const movimento = await registrarMovimentoManual(
          prisma,
          { sessaoCaixaId: parametros.data.id, ...dadosMovimento, autorizadoPorId },
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

  /**
   * Relatório Z: o documento do fim do turno.
   *
   * `exigirOperador`, não gerente: é o caixa DELA, e ela já vê o esperado e o
   * contado no fechamento. O que estava faltando era a quebra por forma de
   * pagamento, sem a qual não dá para conciliar o extrato da maquininha.
   *
   * Vale com a sessão ainda aberta — conferir o turno no meio do dia é rotina,
   * e é o que permite descobrir a divergência antes de a gaveta fechar.
   */
  app.get('/sessoes-caixa/:id/relatorio', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
    if (!parametros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: parametros.error.issues });
    }
    try {
      return await gerarRelatorioFechamento(prisma, parametros.data.id);
    } catch (erro) {
      return tratarErroCaixa(erro, resposta);
    }
  });

  /**
   * Entrada de mercadoria no estoque.
   *
   * O estoque é livro-razão: isto LANÇA movimentos, nunca escreve um saldo.
   *
   * `documento` (a chave ou o número da nota) torna a operação idempotente por
   * recusa: um segundo envio do mesmo documento devolve 409 em vez de dobrar o
   * estoque. Clicar duas vezes achando que não foi é o erro mais provável
   * aqui, e ele custa uma conferência de arara inteira para descobrir.
   */
  const STATUS_ESTOQUE: Readonly<Record<string, number>> = {
    DOCUMENTO_JA_LANCADO: 409,
  };

  /**
   * `statusExtra` existe por causa de `VARIANTE_INEXISTENTE`, que significa
   * coisas diferentes conforme a rota.
   *
   * Em `/estoque/entrada` o id vem no CORPO, entre vários itens: a requisição
   * é sobre a entrada, não sobre a variante, e um id inválido ali é entrada
   * recusada por regra — 422. Em `/variantes/:id/...` a variante é o recurso
   * endereçado, e não existir é 404.
   */
  function tratarErroEstoque(
    erro: unknown,
    resposta: FastifyReply,
    statusExtra: Readonly<Record<string, number>> = {},
  ): FastifyReply | never {
    if (erro instanceof ErroEstoque) {
      const status = statusExtra[erro.codigo] ?? STATUS_ESTOQUE[erro.codigo] ?? 422;
      return resposta.status(status).send({ codigo: erro.codigo, mensagem: erro.message });
    }
    throw erro;
  }

  /** Nas rotas endereçadas por `:id`, a variante ausente é recurso não encontrado. */
  const VARIANTE_COMO_RECURSO = { VARIANTE_INEXISTENTE: 404 } as const;

  app.post('/estoque/entrada', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const entrada = esquemaEntradaEstoque.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta
        .status(400)
        .send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    try {
      const resultado = await registrarEntradaEstoque(prisma, entrada.data, {
        operadorId: requisicao.user.sub,
      });
      return resposta.status(201).send(resultado);
    } catch (erro) {
      return tratarErroEstoque(erro, resposta);
    }
  });

  /**
   * Ajuste de inventário: corrige o saldo para a quantidade contada na arara.
   *
   * Exige GERENTE. Não é dinheiro saindo da gaveta, mas é o caminho pelo qual
   * peça sumida vira "erro de estoque" — corrigir o número sem deixar rastro é
   * como furto interno desaparece. Sempre auditado, inclusive quando a
   * contagem bate.
   */
  app.post(
    '/variantes/:id/inventario',
    { preHandler: exigirAdministrador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      const entrada = esquemaAjusteInventario.safeParse(requisicao.body);
      if (!parametros.success || !entrada.success) {
        return resposta.status(400).send({
          codigo: 'ENTRADA_INVALIDA',
          erros: [
            ...(parametros.success ? [] : parametros.error.issues),
            ...(entrada.success ? [] : entrada.error.issues),
          ],
        });
      }
      try {
        return await ajustarInventario(
          prisma,
          { varianteId: parametros.data.id, ...entrada.data },
          { operadorId: requisicao.user.sub },
        );
      } catch (erro) {
        return tratarErroEstoque(erro, resposta, VARIANTE_COMO_RECURSO);
      }
    },
  );

  /**
   * Extrato de uma variação: cada movimento que compõe o saldo atual.
   *
   * `exigirOperador`: conferir de onde veio o saldo é trabalho de balcão — a
   * pergunta "vendi ou sumiu?" aparece com a cliente esperando.
   */
  app.get(
    '/variantes/:id/movimentacao',
    { preHandler: exigirOperador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      const consulta = esquemaHistoricoMovimentacao.safeParse(requisicao.query);
      if (!parametros.success || !consulta.success) {
        return resposta.status(400).send({
          codigo: 'ENTRADA_INVALIDA',
          erros: [
            ...(parametros.success ? [] : parametros.error.issues),
            ...(consulta.success ? [] : consulta.error.issues),
          ],
        });
      }
      try {
        return await historicoMovimentacao(prisma, parametros.data.id, consulta.data.limite);
      } catch (erro) {
        return tratarErroEstoque(erro, resposta, VARIANTE_COMO_RECURSO);
      }
    },
  );

  // --- Catálogo: cadastro ----------------------------------------------------

  const STATUS_CATALOGO: Readonly<Record<string, number>> = {
    PRODUTO_INEXISTENTE: 404,
    VARIANTE_INEXISTENTE: 404,
    CATEGORIA_INEXISTENTE: 404,
    SKU_EM_USO: 409,
    CODIGO_BARRAS_EM_USO: 409,
    CATEGORIA_EM_USO: 409,
  };

  function tratarErroCatalogo(erro: unknown, resposta: FastifyReply): FastifyReply | never {
    if (erro instanceof ErroCatalogo) {
      return resposta
        .status(STATUS_CATALOGO[erro.codigo] ?? 422)
        .send({ codigo: erro.codigo, mensagem: erro.message });
    }
    throw erro;
  }

  /**
   * Cadastro de catálogo: LER é de operador, ESCREVER é de gerente.
   *
   * A operadora consulta ficha de produto no balcão o tempo todo. Mudar preço,
   * criar SKU ou desativar peça é decisão de quem responde pela margem.
   */
  app.get('/produtos', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const filtros = esquemaListarProdutos.safeParse(requisicao.query);
    if (!filtros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: filtros.error.issues });
    }
    return listarProdutos(prisma, filtros.data);
  });

  app.get('/produtos/:id', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
    if (!parametros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: parametros.error.issues });
    }
    try {
      return await obterProduto(prisma, parametros.data.id);
    } catch (erro) {
      return tratarErroCatalogo(erro, resposta);
    }
  });

  app.post('/produtos', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const entrada = esquemaCriarProduto.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    try {
      const produto = await criarProduto(prisma, entrada.data, {
        operadorId: requisicao.user.sub,
      });
      return resposta.status(201).send(produto);
    } catch (erro) {
      return tratarErroCatalogo(erro, resposta);
    }
  });

  app.patch('/produtos/:id', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
    const entrada = esquemaAtualizarProduto.safeParse(requisicao.body);
    if (!parametros.success || !entrada.success) {
      return resposta.status(400).send({
        codigo: 'ENTRADA_INVALIDA',
        erros: [
          ...(parametros.success ? [] : parametros.error.issues),
          ...(entrada.success ? [] : entrada.error.issues),
        ],
      });
    }
    try {
      return await atualizarProduto(prisma, parametros.data.id, entrada.data, {
        operadorId: requisicao.user.sub,
      });
    } catch (erro) {
      return tratarErroCatalogo(erro, resposta);
    }
  });

  app.post(
    '/produtos/:id/variantes',
    { preHandler: exigirAdministrador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      const entrada = esquemaVarianteNova.safeParse(requisicao.body);
      if (!parametros.success || !entrada.success) {
        return resposta.status(400).send({
          codigo: 'ENTRADA_INVALIDA',
          erros: [
            ...(parametros.success ? [] : parametros.error.issues),
            ...(entrada.success ? [] : entrada.error.issues),
          ],
        });
      }
      try {
        const variante = await criarVariante(prisma, parametros.data.id, entrada.data, {
          operadorId: requisicao.user.sub,
        });
        return resposta.status(201).send(variante);
      } catch (erro) {
        return tratarErroCatalogo(erro, resposta);
      }
    },
  );

  app.patch('/variantes/:id', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
    const entrada = esquemaAtualizarVariante.safeParse(requisicao.body);
    if (!parametros.success || !entrada.success) {
      return resposta.status(400).send({
        codigo: 'ENTRADA_INVALIDA',
        erros: [
          ...(parametros.success ? [] : parametros.error.issues),
          ...(entrada.success ? [] : entrada.error.issues),
        ],
      });
    }
    try {
      return await atualizarVariante(prisma, parametros.data.id, entrada.data, {
        operadorId: requisicao.user.sub,
      });
    } catch (erro) {
      return tratarErroCatalogo(erro, resposta);
    }
  });

  app.get('/categorias', { preHandler: exigirOperador }, async () => listarCategorias(prisma));

  app.post('/categorias', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const entrada = esquemaCriarCategoria.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    try {
      return resposta.status(201).send(await criarCategoria(prisma, entrada.data.nome));
    } catch (erro) {
      return tratarErroCatalogo(erro, resposta);
    }
  });

  // --- Auditoria -------------------------------------------------------------

  /**
   * Consulta do registro de auditoria. Só gerente.
   *
   * O sistema gravava em oito pontos e nada lia. Auditoria que ninguém
   * consulta não dissuade ninguém — o registro existe para "quem autorizou
   * isso?" ter resposta fora do banco.
   */
  app.get('/auditoria', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const filtros = z
      .object({
        acao: z.string().trim().min(1).optional(),
        usuarioId: z.string().uuid().optional(),
        de: z.string().optional(),
        ate: z.string().optional(),
        pagina: z.coerce.number().int().min(1).default(1),
        porPagina: z.coerce.number().int().min(1).max(100).default(30),
      })
      .safeParse(requisicao.query);
    if (!filtros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: filtros.error.issues });
    }
    try {
      return await consultarAuditoria(prisma, filtros.data);
    } catch (erro) {
      if (erro instanceof ErroAuditoria) {
        return resposta.status(400).send({ codigo: erro.codigo, mensagem: erro.message });
      }
      throw erro;
    }
  });

  /** Ações existentes, para montar o filtro da tela. */
  app.get('/auditoria/acoes', { preHandler: exigirAdministrador }, async () => listarAcoes(prisma));

  // --- Clientes e crediário --------------------------------------------------

  const STATUS_CLIENTE: Readonly<Record<string, number>> = {
    CLIENTE_INEXISTENTE: 404,
    PARCELA_INEXISTENTE: 404,
    CPF_JA_CADASTRADO: 409,
    PARCELA_JA_PAGA: 409,
  };

  function tratarErroCliente(erro: unknown, resposta: FastifyReply): FastifyReply | never {
    if (erro instanceof ErroCliente) {
      return resposta
        .status(STATUS_CLIENTE[erro.codigo] ?? 422)
        .send({ codigo: erro.codigo, mensagem: erro.message });
    }
    throw erro;
  }

  app.get('/clientes', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const filtros = esquemaBuscarClientes.safeParse(requisicao.query);
    if (!filtros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: filtros.error.issues });
    }
    return buscarClientes(prisma, filtros.data);
  });

  app.post('/clientes', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const entrada = esquemaCriarCliente.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    try {
      return resposta.status(201).send(await criarCliente(prisma, entrada.data));
    } catch (erro) {
      return tratarErroCliente(erro, resposta);
    }
  });

  /** Ficha da cliente: limite, saldo devedor e parcelas em aberto. */
  app.get('/clientes/:id', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
    if (!parametros.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: parametros.error.issues });
    }
    try {
      return await obterCliente(prisma, parametros.data.id);
    } catch (erro) {
      return tratarErroCliente(erro, resposta);
    }
  });

  /**
   * Recebe (parte de) uma parcela do crediário.
   *
   * É LANÇAMENTO, não edição: cria um `RecebimentoParcela` e o status vem da
   * soma. Pagamento parcial existe de verdade, e nada some por clique errado.
   */
  app.post('/parcelas/:id/receber', { preHandler: exigirOperador }, async (requisicao, resposta) => {
    const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
    const entrada = esquemaReceberParcela.safeParse(requisicao.body);
    if (!parametros.success || !entrada.success) {
      return resposta.status(400).send({
        codigo: 'ENTRADA_INVALIDA',
        erros: [
          ...(parametros.success ? [] : parametros.error.issues),
          ...(entrada.success ? [] : entrada.error.issues),
        ],
      });
    }
    try {
      const resultado = await receberParcela(
        prisma,
        { parcelaId: parametros.data.id, ...entrada.data },
        { operadorId: requisicao.user.sub },
      );
      return resposta.status(201).send(resultado);
    } catch (erro) {
      return tratarErroCliente(erro, resposta);
    }
  });

  // --- Relatórios ------------------------------------------------------------

  /**
   * Vendas do período.
   *
   * O recorte é por DIA DA LOJA, no fuso do servidor. Com corte em UTC, no
   * Brasil toda venda depois das 21h cairia no dia seguinte e o relatório do
   * dia fecharia errado sem ninguém entender por quê.
   *
   * Exige GERENTE: faturamento, ticket médio e ranking de produto são dado de
   * dono, não de turno. A operadora precisa do caixa dela — que ela vê no
   * fechamento — não do resultado da loja.
   */
  app.get('/relatorios/vendas', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const filtros = z
      .object({ de: z.string(), ate: z.string() })
      .safeParse(requisicao.query);
    if (!filtros.success) {
      return resposta
        .status(400)
        .send({ codigo: 'ENTRADA_INVALIDA', mensagem: 'Informe o período: de e ate.' });
    }
    try {
      return await gerarRelatorioVendas(prisma, filtros.data);
    } catch (erro) {
      if (erro instanceof ErroRelatorio) {
        return resposta.status(400).send({ codigo: erro.codigo, mensagem: erro.message });
      }
      throw erro;
    }
  });

  // --- Usuários e configuração da loja ---------------------------------------

  const STATUS_ADMIN: Readonly<Record<string, number>> = {
    USUARIO_INEXISTENTE: 404,
    LOGIN_EM_USO: 409,
    ULTIMO_ADMINISTRADOR: 409,
    NAO_PODE_SE_DESATIVAR: 409,
    NAO_PODE_MUDAR_PROPRIO_PAPEL: 409,
  };

  function tratarErroAdmin(erro: unknown, resposta: FastifyReply): FastifyReply | never {
    if (erro instanceof ErroAdministracao) {
      return resposta
        .status(STATUS_ADMIN[erro.codigo] ?? 422)
        .send({ codigo: erro.codigo, mensagem: erro.message });
    }
    throw erro;
  }

  /**
   * Administrar usuário exige GERENTE ou ADMIN.
   *
   * Sem isso, um operador criaria a si mesmo como gerente e a alçada de
   * desconto e a autorização de sangria deixariam de significar qualquer
   * coisa.
   */
  async function exigirAdministrador(
    requisicao: FastifyRequest,
    resposta: FastifyReply,
  ): Promise<void> {
    await requisicao.jwtVerify();
    // A checagem de sessão é repetida aqui em vez de delegada a
    // `exigirOperador` porque um hook precisa responder no máximo uma vez:
    // encadear os dois faria a rota enviar 401 e 403 para a mesma requisição.
    if (!ehTokenDeSessao(requisicao.user)) {
      await resposta
        .status(401)
        .send({ codigo: 'TOKEN_INVALIDO', mensagem: 'Faça login novamente para continuar.' });
      return;
    }
    if (!podeAdministrar(requisicao.user.papel)) {
      await resposta
        .status(403)
        .send({ codigo: 'SEM_PERMISSAO', mensagem: 'Só gerente ou administrador faz isso.' });
    }
  }

  app.get('/usuarios', { preHandler: exigirAdministrador }, async () => listarUsuarios(prisma));

  app.post('/usuarios', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const entrada = esquemaCriarUsuario.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    try {
      return resposta.status(201).send(await criarUsuario(prisma, entrada.data));
    } catch (erro) {
      return tratarErroAdmin(erro, resposta);
    }
  });

  app.patch('/usuarios/:id', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
    const entrada = esquemaAtualizarUsuario.safeParse(requisicao.body);
    if (!parametros.success || !entrada.success) {
      return resposta.status(400).send({
        codigo: 'ENTRADA_INVALIDA',
        erros: [
          ...(parametros.success ? [] : parametros.error.issues),
          ...(entrada.success ? [] : entrada.error.issues),
        ],
      });
    }
    try {
      return await atualizarUsuario(prisma, parametros.data.id, entrada.data, {
        autorId: requisicao.user.sub,
      });
    } catch (erro) {
      return tratarErroAdmin(erro, resposta);
    }
  });

  app.post(
    '/usuarios/:id/senha',
    { preHandler: exigirAdministrador },
    async (requisicao, resposta) => {
      const parametros = z.object({ id: z.string().uuid() }).safeParse(requisicao.params);
      const entrada = esquemaTrocarSenha.safeParse(requisicao.body);
      if (!parametros.success || !entrada.success) {
        return resposta.status(400).send({
          codigo: 'ENTRADA_INVALIDA',
          erros: [
            ...(parametros.success ? [] : parametros.error.issues),
            ...(entrada.success ? [] : entrada.error.issues),
          ],
        });
      }
      try {
        return await trocarSenha(prisma, parametros.data.id, entrada.data.senha);
      } catch (erro) {
        return tratarErroAdmin(erro, resposta);
      }
    },
  );

  /**
   * A configuração da loja é LIDA por qualquer operador — o comprovante
   * precisa dela a cada venda — mas só gerente escreve.
   */
  app.get('/configuracao', { preHandler: exigirOperador }, async () =>
    obterConfiguracaoLoja(prisma),
  );

  app.put('/configuracao', { preHandler: exigirAdministrador }, async (requisicao, resposta) => {
    const entrada = esquemaConfiguracaoLoja.safeParse(requisicao.body);
    if (!entrada.success) {
      return resposta.status(400).send({ codigo: 'ENTRADA_INVALIDA', erros: entrada.error.issues });
    }
    return salvarConfiguracaoLoja(prisma, entrada.data);
  });

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
