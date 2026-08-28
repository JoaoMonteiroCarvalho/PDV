/**
 * Motor de sincronização em segundo plano.
 *
 * Duas tarefas independentes, de propósito:
 *   - subir vendas da fila (prioridade: é dinheiro esperando registro);
 *   - baixar mudanças do catálogo.
 *
 * Se o catálogo falhar, as vendas continuam subindo. Se as vendas falharem, o
 * catálogo continua atualizando. Amarrar as duas faria uma queda derrubar a
 * outra sem motivo.
 */

import type { BancoLocal } from '../banco/local.js';
import type { ClienteApi } from '../api/cliente.js';
import { SincronizadorCatalogo } from '../catalogo/sincronizacao.js';
import { FilaSincronizacao } from './fila.js';

export interface EstadoSincronizacao {
  readonly online: boolean;
  readonly pendentes: number;
  readonly bloqueadas: number;
  readonly sincronizando: boolean;
  readonly ultimaSincronizacao: Date | null;
  readonly produtosLocais: number;
}

export type OuvinteEstado = (estado: EstadoSincronizacao) => void;

export class MotorSincronizacao {
  private readonly fila: FilaSincronizacao;
  private readonly catalogo: SincronizadorCatalogo;
  private readonly ouvintes = new Set<OuvinteEstado>();
  private temporizadorVendas: ReturnType<typeof setInterval> | null = null;
  private temporizadorCatalogo: ReturnType<typeof setInterval> | null = null;
  private rodando = false;

  private estado: EstadoSincronizacao = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pendentes: 0,
    bloqueadas: 0,
    sincronizando: false,
    ultimaSincronizacao: null,
    produtosLocais: 0,
  };

  constructor(
    private readonly banco: BancoLocal,
    private readonly api: ClienteApi,
    private readonly intervaloCatalogoMs = 10 * 60_000,
    private readonly intervaloVendasMs = 15_000,
  ) {
    this.fila = new FilaSincronizacao(banco);
    this.catalogo = new SincronizadorCatalogo(banco, (parametros) =>
      api.buscarPaginaCatalogo(parametros),
    );
  }

  aoMudar(ouvinte: OuvinteEstado): () => void {
    this.ouvintes.add(ouvinte);
    ouvinte(this.estado);
    return () => this.ouvintes.delete(ouvinte);
  }

  private atualizar(parcial: Partial<EstadoSincronizacao>): void {
    this.estado = { ...this.estado, ...parcial };
    for (const ouvinte of this.ouvintes) ouvinte(this.estado);
  }

  obterFila(): FilaSincronizacao {
    return this.fila;
  }

  async atualizarContadores(): Promise<void> {
    const [resumo, produtos] = await Promise.all([
      this.fila.resumo(),
      this.catalogo.totalLocal(),
    ]);
    this.atualizar({
      pendentes: resumo.pendentes,
      bloqueadas: resumo.bloqueadas,
      produtosLocais: produtos,
    });
  }

  iniciar(): void {
    if (this.rodando) return;
    this.rodando = true;

    window.addEventListener('online', this.aoFicarOnline);
    window.addEventListener('offline', this.aoFicarOffline);

    void this.atualizarContadores();
    void this.enviarPendentes();
    void this.sincronizarCatalogo();

    this.temporizadorVendas = setInterval(() => void this.enviarPendentes(), this.intervaloVendasMs);
    this.temporizadorCatalogo = setInterval(
      () => void this.sincronizarCatalogo(),
      this.intervaloCatalogoMs,
    );
  }

  parar(): void {
    this.rodando = false;
    window.removeEventListener('online', this.aoFicarOnline);
    window.removeEventListener('offline', this.aoFicarOffline);
    if (this.temporizadorVendas) clearInterval(this.temporizadorVendas);
    if (this.temporizadorCatalogo) clearInterval(this.temporizadorCatalogo);
  }

  private readonly aoFicarOnline = (): void => {
    this.atualizar({ online: true });
    // A rede voltou: não espera o próximo tique para esvaziar a fila.
    void this.enviarPendentes();
    void this.sincronizarCatalogo();
  };

  private readonly aoFicarOffline = (): void => {
    this.atualizar({ online: false });
  };

  /** Envia as vendas prontas, uma a uma, respeitando o backoff de cada uma. */
  async enviarPendentes(): Promise<void> {
    if (!this.estado.online || this.estado.sincronizando) return;

    this.atualizar({ sincronizando: true });
    try {
      const prontas = await this.fila.prontasParaEnvio(10);
      for (const venda of prontas) {
        const resposta = await this.api.enviarVenda(venda.corpo);
        await this.fila.registrarResultado(venda.id, {
          status: resposta.status,
          mensagem: resposta.mensagem,
        });
      }
      if (prontas.length > 0) this.atualizar({ ultimaSincronizacao: new Date() });
    } finally {
      this.atualizar({ sincronizando: false });
      await this.atualizarContadores();
    }
  }

  async sincronizarCatalogo(): Promise<void> {
    if (!this.estado.online) return;
    try {
      await this.catalogo.sincronizar();
      this.atualizar({ ultimaSincronizacao: new Date() });
    } catch {
      // Catálogo desatualizado não impede vender: o caixa usa a réplica local.
      // Falhar em silêncio aqui é deliberado; o indicador de status já mostra
      // que a sincronização não completou.
    } finally {
      await this.atualizarContadores();
    }
  }

  /** Enfileira uma venda recém-fechada e tenta subir na hora. */
  async registrarVenda(venda: { id: string; corpo: unknown; totalCentavos: number }): Promise<void> {
    await this.fila.enfileirar(venda);
    await this.atualizarContadores();
    void this.enviarPendentes();
  }
}
