/**
 * Cliente HTTP da API.
 *
 * Devolve o status em vez de lançar em erro de servidor: a fila de
 * sincronização precisa do código HTTP para decidir entre retentar e bloquear.
 * Uma exceção genérica apagaria justamente essa informação.
 */

import type { PaginaCatalogo } from '../catalogo/sincronizacao.js';

const BASE = '/api';
export const CHAVE_TOKEN = 'pdv.token';
export const CHAVE_OPERADOR = 'pdv.operador';

export interface Operador {
  id: string;
  nome: string;
  papel: 'OPERADOR' | 'GERENTE' | 'ADMIN';
  limiteDescontoBps: number;
}

/**
 * Gerente que liberou uma operação, com a prova assinada dessa liberação.
 *
 * As telas guardam isto junto: o nome, para mostrar quem autorizou, e o token,
 * que é o que o servidor de fato aceita. Guardar só o id não autoriza nada.
 */
export interface AutorizacaoGerente {
  readonly operador: Operador;
  readonly tokenAutorizacao: string;
}

export interface RespostaEnvio {
  status: number | null;
  mensagem?: string | undefined;
  corpo?: unknown;
}

export interface SessaoCaixaAberta {
  id: string;
  terminalId: string;
  fundoTrocoCentavos: number;
  abertaEm: string;
  saldoEsperadoCentavos: number;
}

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export class ClienteApi {
  constructor(private token: string | null = localStorage.getItem(CHAVE_TOKEN)) {}

  definirToken(token: string | null): void {
    this.token = token;
    if (token) localStorage.setItem(CHAVE_TOKEN, token);
    else localStorage.removeItem(CHAVE_TOKEN);
  }

  temToken(): boolean {
    return this.token !== null;
  }

  private cabecalhos(): HeadersInit {
    const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) cabecalhos.Authorization = `Bearer ${this.token}`;
    return cabecalhos;
  }

  async entrar(login: string, senha: string): Promise<{ token: string; operador: Operador }> {
    const resposta = await fetch(`${BASE}/sessao/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, senha }),
    });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.mensagem ?? 'Não foi possível entrar.');
    }
    const dados = (await resposta.json()) as { token: string; operador: Operador };
    this.definirToken(dados.token);
    localStorage.setItem(CHAVE_OPERADOR, JSON.stringify(dados.operador));
    return dados;
  }

  /**
   * Autentica um gerente SEM substituir a sessão do operador logado no caixa.
   *
   * Usado na liberação de sangria/suprimento e devolução: o operador continua
   * sendo quem está vendendo, o gerente só prova identidade para autorizar
   * aquela operação pontual. Trocar o token aqui deslogaria o operador no meio
   * do expediente.
   *
   * Devolve um `tokenAutorizacao` assinado pelo servidor, de vida curta, que a
   * operação seguinte precisa enviar. O id do gerente sozinho não autoriza
   * nada: o servidor lê quem autorizou da assinatura do token.
   */
  async entrarSemTrocarSessao(
    login: string,
    senha: string,
  ): Promise<{ operador: Operador; tokenAutorizacao: string }> {
    const resposta = await fetch(`${BASE}/sessao/autorizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, senha }),
    });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new ErroApi(resposta.status, corpo.codigo ?? 'CREDENCIAIS_INVALIDAS', corpo.mensagem ?? 'Não foi possível autenticar o gerente.');
    }
    return (await resposta.json()) as { operador: Operador; tokenAutorizacao: string };
  }

  sair(): void {
    this.definirToken(null);
    localStorage.removeItem(CHAVE_OPERADOR);
  }

  operadorSalvo(): Operador | null {
    const bruto = localStorage.getItem(CHAVE_OPERADOR);
    if (!bruto) return null;
    try {
      return JSON.parse(bruto) as Operador;
    } catch {
      return null;
    }
  }

  async buscarPaginaCatalogo(parametros: {
    desde?: string | undefined;
    ultimoId?: string | undefined;
    limite: number;
  }): Promise<PaginaCatalogo> {
    const consulta = new URLSearchParams({ limite: String(parametros.limite) });
    if (parametros.desde) consulta.set('desde', parametros.desde);
    if (parametros.ultimoId) consulta.set('ultimoId', parametros.ultimoId);

    const resposta = await fetch(`${BASE}/catalogo?${consulta}`, { headers: this.cabecalhos() });
    if (!resposta.ok) {
      throw new Error(`Falha ao sincronizar catálogo (HTTP ${resposta.status})`);
    }
    return (await resposta.json()) as PaginaCatalogo;
  }

  /**
   * Envia uma venda da fila.
   *
   * NÃO lança em erro HTTP: devolve o status para a fila classificar. `status:
   * null` significa que não houve resposta — offline, DNS, timeout.
   */
  async enviarVenda(corpo: unknown): Promise<RespostaEnvio> {
    try {
      const resposta = await fetch(`${BASE}/vendas`, {
        method: 'POST',
        headers: this.cabecalhos(),
        body: JSON.stringify(corpo),
      });

      const dados = await resposta.json().catch(() => undefined);
      return {
        status: resposta.status,
        mensagem: (dados as { mensagem?: string } | undefined)?.mensagem,
        corpo: dados,
      };
    } catch {
      // fetch só rejeita quando não houve resposta alguma.
      return { status: null, mensagem: 'Sem conexão' };
    }
  }

  // --- Sessão de caixa -------------------------------------------------------

  private async json<T>(resposta: Response): Promise<T> {
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      throw new ErroApi(
        resposta.status,
        (dados as { codigo?: string }).codigo ?? 'ERRO_DESCONHECIDO',
        (dados as { mensagem?: string }).mensagem ?? `Erro HTTP ${resposta.status}`,
      );
    }
    return dados as T;
  }

  /** Sessão aberta do terminal, ou null se não houver — usado ao abrir a tela do caixa. */
  async buscarSessaoAberta(terminalId: string): Promise<SessaoCaixaAberta | null> {
    const resposta = await fetch(`${BASE}/sessoes-caixa/aberta?terminalId=${terminalId}`, {
      headers: this.cabecalhos(),
    });
    if (resposta.status === 404) return null;
    return this.json<SessaoCaixaAberta>(resposta);
  }

  async abrirSessao(terminalId: string, fundoTrocoCentavos: number): Promise<{ id: string }> {
    const resposta = await fetch(`${BASE}/sessoes-caixa`, {
      method: 'POST',
      headers: this.cabecalhos(),
      body: JSON.stringify({ terminalId, fundoTrocoCentavos }),
    });
    return this.json<{ id: string }>(resposta);
  }

  async registrarMovimentoCaixa(
    sessaoCaixaId: string,
    dados: { tipo: 'SANGRIA' | 'SUPRIMENTO'; valorCentavos: number; observacao?: string | undefined; tokenAutorizacao: string },
  ): Promise<{ id: string }> {
    const resposta = await fetch(`${BASE}/sessoes-caixa/${sessaoCaixaId}/movimentos`, {
      method: 'POST',
      headers: this.cabecalhos(),
      body: JSON.stringify(dados),
    });
    return this.json<{ id: string }>(resposta);
  }

  async fecharSessao(
    sessaoCaixaId: string,
    valorContadoCentavos: number,
  ): Promise<{ valorEsperadoCentavos: number; valorContadoCentavos: number; diferencaCentavos: number }> {
    const resposta = await fetch(`${BASE}/sessoes-caixa/${sessaoCaixaId}/fechar`, {
      method: 'POST',
      headers: this.cabecalhos(),
      body: JSON.stringify({ valorContadoCentavos }),
    });
    return this.json(resposta);
  }

  // --- Usuários e configuração da loja --------------------------------------------

  async listarUsuarios(): Promise<UsuarioAdmin[]> {
    return this.json(await fetch(`${BASE}/usuarios`, { headers: this.cabecalhos() }));
  }

  async criarUsuario(dados: {
    nome: string;
    login: string;
    senha: string;
    papel: PapelUsuario;
    limiteDescontoBps: number;
  }): Promise<UsuarioAdmin> {
    return this.json(
      await fetch(`${BASE}/usuarios`, {
        method: 'POST',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  async atualizarUsuario(
    id: string,
    dados: { nome?: string; papel?: PapelUsuario; limiteDescontoBps?: number; ativo?: boolean },
  ): Promise<UsuarioAdmin> {
    return this.json(
      await fetch(`${BASE}/usuarios/${id}`, {
        method: 'PATCH',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  async trocarSenhaDe(id: string, senha: string): Promise<{ id: string }> {
    return this.json(
      await fetch(`${BASE}/usuarios/${id}/senha`, {
        method: 'POST',
        headers: this.cabecalhos(),
        body: JSON.stringify({ senha }),
      }),
    );
  }

  async obterConfiguracaoLoja(): Promise<ConfiguracaoLoja> {
    return this.json(await fetch(`${BASE}/configuracao`, { headers: this.cabecalhos() }));
  }

  async salvarConfiguracaoLoja(dados: ConfiguracaoLojaEntrada): Promise<ConfiguracaoLoja> {
    return this.json(
      await fetch(`${BASE}/configuracao`, {
        method: 'PUT',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  // --- Relatórios ----------------------------------------------------------------

  /** Vendas do período. As datas vão como `YYYY-MM-DD` — dia da loja, não instante. */
  async relatorioVendas(de: string, ate: string): Promise<RelatorioVendas> {
    const resposta = await fetch(`${BASE}/relatorios/vendas?de=${de}&ate=${ate}`, {
      headers: this.cabecalhos(),
    });
    return this.json(resposta);
  }

  // --- Clientes e crediário ------------------------------------------------------

  async buscarClientes(busca: string): Promise<ClienteResumo[]> {
    const consulta = new URLSearchParams({ limite: '30' });
    if (busca.trim()) consulta.set('busca', busca.trim());
    const resposta = await fetch(`${BASE}/clientes?${consulta}`, { headers: this.cabecalhos() });
    return this.json(resposta);
  }

  async criarCliente(dados: {
    nome: string;
    cpf?: string | undefined;
    telefone?: string | undefined;
    limiteCrediarioCentavos: number;
  }): Promise<ClienteResumo> {
    const resposta = await fetch(`${BASE}/clientes`, {
      method: 'POST',
      headers: this.cabecalhos(),
      body: JSON.stringify(dados),
    });
    return this.json(resposta);
  }

  /** Ficha completa: limite, saldo devedor e parcelas em aberto. */
  async obterCliente(clienteId: string): Promise<ClienteDetalhe> {
    const resposta = await fetch(`${BASE}/clientes/${clienteId}`, { headers: this.cabecalhos() });
    return this.json(resposta);
  }

  async receberParcela(
    parcelaId: string,
    dados: { sessaoCaixaId: string; valorCentavos: number; forma: 'DINHEIRO' | 'DEBITO' | 'CREDITO' | 'PIX' },
  ): Promise<{ recebidoCentavos: number; restanteCentavos: number; status: 'ABERTA' | 'PAGA' }> {
    const resposta = await fetch(`${BASE}/parcelas/${parcelaId}/receber`, {
      method: 'POST',
      headers: this.cabecalhos(),
      body: JSON.stringify(dados),
    });
    return this.json(resposta);
  }

  // --- Estoque -----------------------------------------------------------------

  /**
   * Dá entrada de mercadoria.
   *
   * `documento` (número ou chave da nota) torna a operação idempotente por
   * recusa: um segundo envio do mesmo documento volta 409 em vez de dobrar o
   * estoque.
   */
  async registrarEntradaEstoque(dados: {
    itens: { varianteId: string; quantidade: number; custoUnitarioCentavos: number }[];
    documento?: string | undefined;
    observacao?: string | undefined;
  }): Promise<{ movimentos: number; pecas: number }> {
    const resposta = await fetch(`${BASE}/estoque/entrada`, {
      method: 'POST',
      headers: this.cabecalhos(),
      body: JSON.stringify(dados),
    });
    return this.json(resposta);
  }

  /** Corrige o saldo para a quantidade contada na arara. Só gerente. */
  async ajustarInventario(
    varianteId: string,
    dados: { quantidadeContada: number; observacao: string },
  ): Promise<ResultadoAjusteInventario> {
    return this.json(
      await fetch(`${BASE}/variantes/${varianteId}/inventario`, {
        method: 'POST',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  /** Extrato de uma variação: cada movimento que compõe o saldo atual. */
  async historicoMovimentacao(varianteId: string, limite = 50): Promise<HistoricoMovimentacao> {
    return this.json(
      await fetch(`${BASE}/variantes/${varianteId}/movimentacao?limite=${limite}`, {
        headers: this.cabecalhos(),
      }),
    );
  }

  // --- Cadastro de catálogo ------------------------------------------------------

  async listarProdutos(filtros: {
    busca?: string | undefined;
    categoriaId?: string | undefined;
    incluirInativos?: boolean | undefined;
    pagina?: number | undefined;
  }): Promise<ListaProdutos> {
    const consulta = new URLSearchParams();
    if (filtros.busca) consulta.set('busca', filtros.busca);
    if (filtros.categoriaId) consulta.set('categoriaId', filtros.categoriaId);
    if (filtros.incluirInativos) consulta.set('incluirInativos', 'true');
    if (filtros.pagina) consulta.set('pagina', String(filtros.pagina));
    return this.json(await fetch(`${BASE}/produtos?${consulta}`, { headers: this.cabecalhos() }));
  }

  async obterProduto(produtoId: string): Promise<ProdutoDetalhe> {
    return this.json(await fetch(`${BASE}/produtos/${produtoId}`, { headers: this.cabecalhos() }));
  }

  async criarProduto(dados: ProdutoEntrada): Promise<{ id: string; nome: string }> {
    return this.json(
      await fetch(`${BASE}/produtos`, {
        method: 'POST',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  async atualizarProduto(
    produtoId: string,
    dados: Partial<Omit<ProdutoEntrada, 'variantes'>> & { ativo?: boolean },
  ): Promise<{ id: string; nome: string; ativo: boolean }> {
    return this.json(
      await fetch(`${BASE}/produtos/${produtoId}`, {
        method: 'PATCH',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  async criarVariante(produtoId: string, dados: VarianteEntrada): Promise<{ id: string; sku: string }> {
    return this.json(
      await fetch(`${BASE}/produtos/${produtoId}/variantes`, {
        method: 'POST',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  /** `codigoBarras: null` REMOVE o código; ausente deixa como está. */
  async atualizarVariante(
    varianteId: string,
    dados: Partial<Omit<VarianteEntrada, 'codigoBarras'>> & {
      ativo?: boolean;
      codigoBarras?: string | null;
    },
  ): Promise<VarianteDetalhe> {
    return this.json(
      await fetch(`${BASE}/variantes/${varianteId}`, {
        method: 'PATCH',
        headers: this.cabecalhos(),
        body: JSON.stringify(dados),
      }),
    );
  }

  async listarCategorias(): Promise<CategoriaResumo[]> {
    return this.json(await fetch(`${BASE}/categorias`, { headers: this.cabecalhos() }));
  }

  async criarCategoria(nome: string): Promise<CategoriaResumo> {
    return this.json(
      await fetch(`${BASE}/categorias`, {
        method: 'POST',
        headers: this.cabecalhos(),
        body: JSON.stringify({ nome }),
      }),
    );
  }

  // --- Relatório Z e auditoria ---------------------------------------------------

  /** Relatório do turno, com quebra por forma de pagamento. */
  async relatorioFechamento(sessaoCaixaId: string): Promise<RelatorioFechamento> {
    return this.json(
      await fetch(`${BASE}/sessoes-caixa/${sessaoCaixaId}/relatorio`, {
        headers: this.cabecalhos(),
      }),
    );
  }

  async consultarAuditoria(filtros: {
    acao?: string | undefined;
    de?: string | undefined;
    ate?: string | undefined;
    pagina?: number | undefined;
  }): Promise<ListaAuditoria> {
    const consulta = new URLSearchParams();
    if (filtros.acao) consulta.set('acao', filtros.acao);
    if (filtros.de) consulta.set('de', filtros.de);
    if (filtros.ate) consulta.set('ate', filtros.ate);
    if (filtros.pagina) consulta.set('pagina', String(filtros.pagina));
    return this.json(await fetch(`${BASE}/auditoria?${consulta}`, { headers: this.cabecalhos() }));
  }

  async listarAcoesAuditoria(): Promise<string[]> {
    return this.json(await fetch(`${BASE}/auditoria/acoes`, { headers: this.cabecalhos() }));
  }

  // --- Histórico de vendas -----------------------------------------------------

  /**
   * Lista vendas para o operador localizar uma sem precisar do comprovante
   * físico em mãos. Filtra por sessão de caixa por padrão — sem isso, o
   * operador veria vendas de qualquer turno.
   */
  async listarVendas(filtros: {
    sessaoCaixaId?: string | undefined;
    cliente?: string | undefined;
    pagina?: number | undefined;
    porPagina?: number | undefined;
  }): Promise<ListaVendas> {
    const consulta = new URLSearchParams();
    if (filtros.sessaoCaixaId) consulta.set('sessaoCaixaId', filtros.sessaoCaixaId);
    if (filtros.cliente) consulta.set('cliente', filtros.cliente);
    if (filtros.pagina) consulta.set('pagina', String(filtros.pagina));
    if (filtros.porPagina) consulta.set('porPagina', String(filtros.porPagina));

    const resposta = await fetch(`${BASE}/vendas?${consulta}`, { headers: this.cabecalhos() });
    return this.json(resposta);
  }

  // --- Devolução / cancelamento ----------------------------------------------

  /** Localiza a venda pelo número impresso no comprovante — não pelo UUID interno. */
  async buscarVendaPorNumero(
    numero: number,
  ): Promise<{ id: string; numero: number; totalCentavos: number; registradaEm: string }> {
    const resposta = await fetch(`${BASE}/vendas/por-numero/${numero}`, { headers: this.cabecalhos() });
    return this.json(resposta);
  }

  /** Localiza pelo código curto do UUID impresso no comprovante — funciona mesmo antes da venda sincronizar. */
  async buscarVendaPorCodigo(
    codigo: string,
  ): Promise<{ id: string; numero: number; totalCentavos: number; registradaEm: string }> {
    const resposta = await fetch(`${BASE}/vendas/por-codigo/${codigo}`, { headers: this.cabecalhos() });
    return this.json(resposta);
  }

  async buscarDisponivelParaDevolucao(vendaId: string): Promise<DisponivelParaDevolucao> {
    const resposta = await fetch(`${BASE}/vendas/${vendaId}/disponivel-para-devolucao`, {
      headers: this.cabecalhos(),
    });
    return this.json(resposta);
  }

  async registrarDevolucao(
    vendaId: string,
    dados: {
      motivo: string;
      formaEstorno: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'VALE_TROCA';
      itens: { itemVendaId: string; quantidade: number }[];
      tokenAutorizacao: string;
    },
  ): Promise<{ cancelamentoId: string; totalCentavos: number }> {
    const resposta = await fetch(`${BASE}/vendas/${vendaId}/devolucao`, {
      method: 'POST',
      headers: this.cabecalhos(),
      body: JSON.stringify(dados),
    });
    return this.json(resposta);
  }
}

export interface CategoriaResumo {
  id: string;
  nome: string;
  ativo: boolean;
  _count?: { produtos: number };
}

export interface VarianteEntrada {
  sku: string;
  codigoBarras?: string | undefined;
  tamanho?: string | undefined;
  cor?: string | undefined;
  precoCentavos: number;
  custoCentavos: number;
}

export interface ProdutoEntrada {
  nome: string;
  descricao?: string | undefined;
  marca?: string | undefined;
  categoriaId?: string | undefined;
  ncm?: string | undefined;
  variantes: VarianteEntrada[];
}

export interface VarianteDetalhe {
  id: string;
  sku: string;
  codigoBarras: string | null;
  tamanho: string | null;
  cor: string | null;
  precoCentavos: number;
  custoCentavos: number;
  ativo: boolean;
  /** Saldo do livro-razão no instante da consulta. */
  saldoEstoque?: number;
}

export interface ProdutoDetalhe {
  id: string;
  nome: string;
  descricao: string | null;
  marca: string | null;
  ativo: boolean;
  ncm: string | null;
  cest: string | null;
  origem: number | null;
  situacaoTributaria: string | null;
  categoria: { id: string; nome: string } | null;
  variantes: VarianteDetalhe[];
}

export interface ProdutoResumo {
  id: string;
  nome: string;
  marca: string | null;
  ativo: boolean;
  categoria: { id: string; nome: string } | null;
  quantidadeVariantes: number;
}

export interface ListaProdutos {
  itens: ProdutoResumo[];
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
}

export interface ResultadoAjusteInventario {
  saldoAnterior: number;
  saldoNovo: number;
  diferenca: number;
  ajustado: boolean;
}

export interface MovimentoEstoqueLinha {
  id: string;
  tipo: string;
  quantidade: number;
  /** Saldo logo APÓS este movimento — reconstruído de trás para frente. */
  saldoDepois: number;
  criadoEm: string;
  observacao: string | null;
  documentoTipo: string | null;
  documentoId: string | null;
  usuario: string | null;
  vendaNumero: number | null;
}

export interface HistoricoMovimentacao {
  variante: {
    id: string;
    sku: string;
    tamanho: string | null;
    cor: string | null;
    produto: string;
  };
  saldoAtual: number;
  movimentos: MovimentoEstoqueLinha[];
}

export interface RelatorioFechamento {
  sessaoId: string;
  terminal: string;
  operador: string;
  abertaEm: string;
  fechadaEm: string | null;
  status: 'ABERTA' | 'FECHADA';
  vendas: { quantidade: number; totalCentavos: number };
  porForma: { forma: string; quantidade: number; totalCentavos: number }[];
  gaveta: {
    fundoTrocoCentavos: number;
    vendasEmDinheiroCentavos: number;
    recebimentosCrediarioCentavos: number;
    suprimentosCentavos: number;
    sangriasCentavos: number;
    devolucoesCentavos: number;
    esperadoCentavos: number;
    contadoCentavos: number | null;
    diferencaCentavos: number | null;
  };
  movimentos: {
    tipo: string;
    valorCentavos: number;
    observacao: string | null;
    criadoEm: string;
    usuario: string;
    autorizadoPor: string | null;
  }[];
}

export interface RegistroAuditoria {
  id: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  valorAntes: unknown;
  valorDepois: unknown;
  criadoEm: string;
  usuario: string;
  autorizadoPor: string | null;
}

export interface ListaAuditoria {
  itens: RegistroAuditoria[];
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
}

export type PapelUsuario = 'OPERADOR' | 'GERENTE' | 'ADMIN';

export interface UsuarioAdmin {
  id: string;
  nome: string;
  login: string;
  papel: PapelUsuario;
  limiteDescontoBps: number;
  ativo: boolean;
  criadoEm: string;
}

export interface ConfiguracaoLoja {
  id: string;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  cnpj: string | null;
  /** Linha extra definida pela loja. As regras legais NÃO vêm daqui. */
  politicaTrocaExtra: string | null;
}

export interface ConfiguracaoLojaEntrada {
  nome: string;
  endereco?: string | undefined;
  telefone?: string | undefined;
  cnpj?: string | undefined;
  politicaTrocaExtra?: string | undefined;
}

export interface RelatorioVendas {
  de: string;
  ate: string;
  resumo: {
    quantidadeVendas: number;
    totalCentavos: number;
    descontoCentavos: number;
    ticketMedioCentavos: number;
    pecasVendidas: number;
  };
  porDia: { dia: string; quantidade: number; totalCentavos: number }[];
  porForma: { forma: string; quantidade: number; totalCentavos: number }[];
  maisVendidos: { descricao: string; sku: string; quantidade: number; totalCentavos: number }[];
}

export interface ClienteResumo {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  limiteCrediarioCentavos: number;
}

export interface ParcelaEmAberto {
  id: string;
  numero: number;
  totalParcelas: number;
  valorCentavos: number;
  recebidoCentavos: number;
  vencimento: string;
  vendaNumero: number;
}

export interface ClienteDetalhe extends ClienteResumo {
  observacao: string | null;
  ativo: boolean;
  /** O que FALTA receber — é isso que consome o limite. */
  saldoDevedorCentavos: number;
  limiteDisponivelCentavos: number;
  parcelasEmAberto: ParcelaEmAberto[];
}

export interface ItemDisponivelParaDevolucao {
  itemVendaId: string;
  varianteId: string;
  descricao: string;
  sku: string;
  quantidadeVendida: number;
  quantidadeJaDevolvida: number;
  precoUnitarioLiquidoCentavos: number;
}

export interface DisponivelParaDevolucao {
  vendaId: string;
  itens: ItemDisponivelParaDevolucao[];
}

export interface VendaResumo {
  id: string;
  numero: number;
  totalCentavos: number;
  registradaEm: string;
  operador: string;
  cliente: string | null;
  temDevolucao: boolean;
}

export interface ListaVendas {
  itens: VendaResumo[];
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
}

export const clienteApi = new ClienteApi();
