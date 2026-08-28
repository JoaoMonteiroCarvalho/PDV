/**
 * Fila de sincronização de vendas.
 *
 * Regra que governa este arquivo: **a venda já aconteceu**. Ela foi impressa,
 * o dinheiro entrou na gaveta e a cliente saiu. A fila não decide se a venda
 * vale — ela só garante que o servidor um dia fique sabendo. Por isso:
 *
 *   - nada é removido da fila por erro; só por confirmação do servidor;
 *   - erro permanente vira pendência VISÍVEL, nunca descarte silencioso;
 *   - 200 e 201 são o mesmo sucesso (200 = o servidor já tinha a venda).
 */

import type { BancoLocal, EstadoFila, VendaEnfileirada } from '../banco/local.js';
import {
  BACKOFF_PADRAO,
  calcularEspera,
  classificarFalha,
  type OpcoesBackoff,
} from './backoff.js';

export interface ResultadoEnvio {
  /** Status HTTP, ou null quando não houve resposta (offline, timeout). */
  readonly status: number | null;
  readonly mensagem?: string | undefined;
}

export interface OpcoesFila {
  readonly backoff?: OpcoesBackoff;
  readonly agora?: () => number;
  readonly aleatorio?: () => number;
}

export class FilaSincronizacao {
  private readonly backoff: OpcoesBackoff;
  private readonly agora: () => number;
  private readonly aleatorio: () => number;

  constructor(
    private readonly banco: BancoLocal,
    opcoes: OpcoesFila = {},
  ) {
    this.backoff = opcoes.backoff ?? BACKOFF_PADRAO;
    this.agora = opcoes.agora ?? (() => Date.now());
    this.aleatorio = opcoes.aleatorio ?? Math.random;
  }

  /**
   * Põe uma venda fechada na fila.
   *
   * Idempotente do lado do caixa também: se a mesma venda for enfileirada duas
   * vezes (duplo clique em "Finalizar"), a segunda não sobrescreve o estado da
   * primeira — que pode já estar em retentativa.
   */
  async enfileirar(venda: {
    id: string;
    corpo: unknown;
    totalCentavos: number;
  }): Promise<void> {
    const existente = await this.banco.fila.get(venda.id);
    if (existente) return;

    const registro: VendaEnfileirada = {
      id: venda.id,
      corpo: venda.corpo,
      totalCentavos: venda.totalCentavos,
      criadaEm: new Date(this.agora()).toISOString(),
      estado: 'PENDENTE',
      tentativas: 0,
      proximaTentativaEm: this.agora(),
      ultimoErro: null,
    };
    await this.banco.fila.add(registro);
  }

  /** Vendas prontas para enviar agora, mais antigas primeiro. */
  async prontasParaEnvio(limite = 10): Promise<VendaEnfileirada[]> {
    const instante = this.agora();
    const candidatas = await this.banco.fila
      .where('estado')
      .anyOf(['PENDENTE', 'AGUARDANDO_RETENTATIVA'] satisfies EstadoFila[])
      .toArray();

    return candidatas
      .filter((venda) => venda.proximaTentativaEm <= instante)
      .sort((a, b) => a.criadaEm.localeCompare(b.criadaEm))
      .slice(0, limite);
  }

  /**
   * Registra o desfecho de uma tentativa de envio.
   *
   * 200 e 201 são tratados igual de propósito: 200 significa que o servidor já
   * tinha essa venda (idempotência). Do ponto de vista da fila, os dois querem
   * dizer "chegou, pode sair da fila".
   */
  async registrarResultado(vendaId: string, resultado: ResultadoEnvio): Promise<EstadoFila | 'SINCRONIZADA'> {
    const venda = await this.banco.fila.get(vendaId);
    if (!venda) return 'SINCRONIZADA';

    if (resultado.status === 200 || resultado.status === 201) {
      await this.banco.fila.delete(vendaId);
      return 'SINCRONIZADA';
    }

    const tentativas = venda.tentativas + 1;

    if (classificarFalha(resultado.status) === 'PERMANENTE') {
      // Não some da fila. Vira pendência para alguém olhar — a venda existe
      // no mundo real e o sistema precisa admitir que não conseguiu registrá-la.
      await this.banco.fila.update(vendaId, {
        estado: 'BLOQUEADA' satisfies EstadoFila,
        tentativas,
        ultimoErro: resultado.mensagem ?? `HTTP ${resultado.status}`,
      });
      return 'BLOQUEADA';
    }

    await this.banco.fila.update(vendaId, {
      estado: 'AGUARDANDO_RETENTATIVA' satisfies EstadoFila,
      tentativas,
      proximaTentativaEm:
        this.agora() + calcularEspera(tentativas, this.backoff, this.aleatorio),
      ultimoErro: resultado.mensagem ?? (resultado.status ? `HTTP ${resultado.status}` : 'Sem conexão'),
    });
    return 'AGUARDANDO_RETENTATIVA';
  }

  /** Contagens para o indicador de status na tela do caixa. */
  async resumo(): Promise<{ pendentes: number; bloqueadas: number; total: number }> {
    const todas = await this.banco.fila.toArray();
    return {
      pendentes: todas.filter((venda) => venda.estado !== 'BLOQUEADA').length,
      bloqueadas: todas.filter((venda) => venda.estado === 'BLOQUEADA').length,
      total: todas.length,
    };
  }

  async bloqueadas(): Promise<VendaEnfileirada[]> {
    return this.banco.fila.where('estado').equals('BLOQUEADA').toArray();
  }

  /**
   * Devolve uma venda bloqueada para a fila, após intervenção humana.
   * Some do fluxo automático de propósito: exige decisão de gente.
   */
  async reabilitar(vendaId: string): Promise<void> {
    await this.banco.fila.update(vendaId, {
      estado: 'PENDENTE' satisfies EstadoFila,
      proximaTentativaEm: this.agora(),
      ultimoErro: null,
    });
  }
}
