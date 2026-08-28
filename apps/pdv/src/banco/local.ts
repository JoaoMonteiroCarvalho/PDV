/**
 * Banco local do caixa (IndexedDB via Dexie).
 *
 * Este arquivo é a razão de o caixa continuar vendendo com a internet caída.
 * Três responsabilidades:
 *
 *   1. `catalogo`  — réplica local dos produtos, para buscar e precificar
 *                    sem rede. Com +10 mil SKUs, os índices aqui são o que
 *                    separa uma busca instantânea de uma trava de 2 segundos.
 *   2. `fila`      — vendas já fechadas esperando para subir ao servidor.
 *   3. `metadados` — marca d'água da sincronização, sessão de caixa, token.
 *
 * Nada aqui depende de rede. Nada aqui é fonte de verdade contábil: o servidor
 * é. Mas enquanto ele não responde, isto é o que a loja tem.
 */

import Dexie, { type EntityTable } from 'dexie';

export interface ItemCatalogo {
  id: string;
  sku: string;
  codigoBarras: string | null;
  nome: string;
  marca: string | null;
  categoria: string | null;
  tamanho: string | null;
  cor: string | null;
  precoCentavos: number;
  ativo: boolean;
  atualizadoEm: string;
  /**
   * Tokens de busca pré-calculados na gravação, não na consulta.
   * Buscar "renda preto" em 10 mil registros varrendo strings a cada tecla
   * digitada trava a tela; com índice multiEntry, é uma busca por prefixo.
   */
  termos: string[];
}

/** Estado de um item na fila de sincronização. */
export type EstadoFila =
  | 'PENDENTE'
  /** Erro transitório (rede, 5xx). Vai tentar de novo. */
  | 'AGUARDANDO_RETENTATIVA'
  /**
   * O servidor recusou por regra de negócio (4xx). Retentar não vai adiantar —
   * a venda existe no mundo real e precisa de intervenção humana. Nunca
   * descartar em silêncio.
   */
  | 'BLOQUEADA';

export interface VendaEnfileirada {
  /** UUID da venda, gerado no caixa. É a chave de idempotência do servidor. */
  id: string;
  /** Corpo exato que será enviado ao POST /vendas. */
  corpo: unknown;
  /** Total, só para exibir na lista de pendências sem desserializar o corpo. */
  totalCentavos: number;
  criadaEm: string;
  estado: EstadoFila;
  tentativas: number;
  /** Timestamp (ms) a partir do qual pode tentar de novo. */
  proximaTentativaEm: number;
  ultimoErro: string | null;
}

export interface Metadado {
  chave: string;
  valor: unknown;
}

export class BancoLocal extends Dexie {
  catalogo!: EntityTable<ItemCatalogo, 'id'>;
  fila!: EntityTable<VendaEnfileirada, 'id'>;
  metadados!: EntityTable<Metadado, 'chave'>;

  constructor(nome = 'pdv-caixa') {
    super(nome);
    this.version(1).stores({
      // `*termos` é multiEntry: um índice por token, que sustenta busca por
      // prefixo. `codigoBarras` indexado para a leitura do scanner ser O(log n).
      catalogo: 'id, sku, codigoBarras, nome, ativo, atualizadoEm, *termos',
      // Índice composto: a fila pergunta "o que está pendente e já pode tentar?"
      fila: 'id, estado, proximaTentativaEm, [estado+proximaTentativaEm], criadaEm',
      metadados: 'chave',
    });
  }
}

export const bancoLocal = new BancoLocal();

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/** Remove acento e caixa: "Biquíni" e "biquini" precisam encontrar um ao outro. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas de acento separadas pelo NFD
    .toLowerCase()
    .trim();
}

/**
 * Tokens de busca de um item. Inclui nome, marca, categoria, tamanho, cor e
 * SKU — a operadora procura por qualquer um deles no balcão.
 */
export function montarTermos(
  item: Pick<ItemCatalogo, 'nome' | 'marca' | 'categoria' | 'tamanho' | 'cor' | 'sku'>,
): string[] {
  const bruto = [item.nome, item.marca, item.categoria, item.tamanho, item.cor, item.sku]
    .filter((valor): valor is string => typeof valor === 'string' && valor.length > 0)
    .join(' ');

  const tokens = normalizar(bruto)
    .split(/[\s\-/]+/)
    .filter((token) => token.length > 0);

  return [...new Set(tokens)];
}
