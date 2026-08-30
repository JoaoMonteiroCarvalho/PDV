import Dexie, { type Table } from 'dexie';
import type { RegistrarVendaEntrada } from '@/servicos/vendas.js';

/**
 * Banco local (IndexedDB via Dexie) — a base do offline-first.
 *
 * Duas tabelas com propósitos bem diferentes:
 *
 *   catalogo    — cópia do catálogo do servidor, para o caixa continuar
 *                 vendendo (bipando código, buscando por nome) mesmo sem
 *                 rede. Sincronizada ao abrir o caixa.
 *
 *   filaVendas  — TODA venda passa por aqui antes de qualquer chamada de
 *                 rede. Nunca é "enviar e esquecer": o registro só sai do
 *                 estado "pendente" quando o servidor confirma. Se a loja
 *                 cair no meio de uma venda, ela já está gravada aqui — o
 *                 motor de sincronização (servicos/motorSincronizacao.ts)
 *                 reenvia sozinho quando a rede volta.
 */

export interface ItemCatalogoLocal {
  readonly id: string;
  readonly sku: string;
  readonly codigoBarras: string;
  readonly nome: string;
  readonly marca: string | null;
  readonly categoria: string | null;
  readonly tamanho: string | null;
  readonly cor: string | null;
  readonly precoCentavos: number;
  readonly ativo: boolean;
}

export type StatusFilaVenda = 'pendente' | 'enviando' | 'erro' | 'sincronizada';

export interface VendaNaFila {
  readonly id: string;
  status: StatusFilaVenda;
  readonly payload: RegistrarVendaEntrada;
  tentativas: number;
  readonly criadaEm: string;
  ultimoErro?: string;
  /** Preenchido quando o servidor confirma — a venda pendente vira "#42". */
  numero?: number;
}

class BancoLocalPdv extends Dexie {
  catalogo!: Table<ItemCatalogoLocal, string>;
  filaVendas!: Table<VendaNaFila, string>;

  constructor() {
    super('pdv-caixa-web');
    this.version(1).stores({
      catalogo: 'id, codigoBarras, sku, nome',
      filaVendas: 'id, status, criadaEm',
    });
  }
}

export const bancoLocal = new BancoLocalPdv();
