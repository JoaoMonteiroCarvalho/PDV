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
   * Usado na liberação de sangria/suprimento: o operador continua sendo quem
   * está vendendo, o gerente só prova identidade para autorizar aquela
   * operação pontual. Trocar o token aqui deslogaria o operador no meio do
   * expediente.
   */
  async entrarSemTrocarSessao(login: string, senha: string): Promise<{ operador: Operador }> {
    const resposta = await fetch(`${BASE}/sessao/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, senha }),
    });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new ErroApi(resposta.status, corpo.codigo ?? 'CREDENCIAIS_INVALIDAS', corpo.mensagem ?? 'Não foi possível autenticar o gerente.');
    }
    const dados = (await resposta.json()) as { operador: Operador };
    return { operador: dados.operador };
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
    dados: { tipo: 'SANGRIA' | 'SUPRIMENTO'; valorCentavos: number; observacao?: string | undefined; autorizadoPorId: string },
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
      autorizadoPorId: string;
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
