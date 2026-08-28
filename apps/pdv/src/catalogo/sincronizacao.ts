/**
 * Sincronização do catálogo para o IndexedDB do caixa.
 *
 * Roda na abertura do caixa e periodicamente. Depois da primeira carga, só
 * baixa o que mudou — com +10 mil SKUs, uma carga completa a cada 10 minutos
 * deixaria o caixa lento justamente na hora do movimento.
 *
 * O progresso é gravado a cada página. Se a rede cair no meio da carga
 * inicial, a próxima tentativa continua de onde parou em vez de recomeçar.
 */

import type { BancoLocal, ItemCatalogo } from '../banco/local.js';
import { montarTermos, normalizar } from '../banco/local.js';

export const CHAVE_MARCA_DAGUA = 'catalogo.marcaDagua';
export const CHAVE_ULTIMO_ID = 'catalogo.ultimoId';

export interface PaginaCatalogo {
  itens: Array<Omit<ItemCatalogo, 'termos'>>;
  proximoDesde: string | null;
  proximoUltimoId: string | null;
  temMais: boolean;
}

/** Busca uma página do catálogo no servidor. Injetável para teste. */
export type BuscarPagina = (parametros: {
  desde?: string | undefined;
  ultimoId?: string | undefined;
  limite: number;
}) => Promise<PaginaCatalogo>;

export interface ResultadoSincronizacao {
  readonly recebidos: number;
  readonly removidos: number;
  readonly paginas: number;
  readonly completa: boolean;
}

export class SincronizadorCatalogo {
  constructor(
    private readonly banco: BancoLocal,
    private readonly buscarPagina: BuscarPagina,
    private readonly tamanhoPagina = 500,
  ) {}

  private async lerMetadado(chave: string): Promise<string | undefined> {
    const registro = await this.banco.metadados.get(chave);
    return registro?.valor as string | undefined;
  }

  /**
   * Sincroniza até acabar. `maximoDePaginas` existe para a sincronização
   * periódica não monopolizar o caixa durante uma carga inicial gigante —
   * ela para, e a próxima rodada continua.
   */
  async sincronizar(maximoDePaginas = 100): Promise<ResultadoSincronizacao> {
    let desde = await this.lerMetadado(CHAVE_MARCA_DAGUA);
    let ultimoId = await this.lerMetadado(CHAVE_ULTIMO_ID);

    let recebidos = 0;
    let removidos = 0;
    let paginas = 0;
    let completa = false;

    for (; paginas < maximoDePaginas; ) {
      const pagina = await this.buscarPagina({ desde, ultimoId, limite: this.tamanhoPagina });
      paginas += 1;

      const ativos = pagina.itens.filter((item) => item.ativo);
      const inativos = pagina.itens.filter((item) => !item.ativo);

      if (ativos.length > 0) {
        // `termos` é calculado na gravação: a busca no balcão não pode pagar
        // o custo de normalizar 10 mil nomes a cada tecla digitada.
        await this.banco.catalogo.bulkPut(
          ativos.map((item) => ({ ...item, termos: montarTermos(item) })),
        );
        recebidos += ativos.length;
      }

      if (inativos.length > 0) {
        await this.banco.catalogo.bulkDelete(inativos.map((item) => item.id));
        removidos += inativos.length;
      }

      // Grava o progresso ANTES de pedir a próxima página: queda de rede no
      // meio da carga não obriga a recomeçar do zero.
      if (pagina.proximoDesde) {
        desde = pagina.proximoDesde;
        ultimoId = pagina.proximoUltimoId ?? undefined;
        await this.banco.metadados.put({ chave: CHAVE_MARCA_DAGUA, valor: desde });
        await this.banco.metadados.put({ chave: CHAVE_ULTIMO_ID, valor: ultimoId });
      }

      if (!pagina.temMais) {
        completa = true;
        break;
      }
    }

    return { recebidos, removidos, paginas, completa };
  }

  /** Quantos produtos o caixa tem disponíveis para vender agora. */
  async totalLocal(): Promise<number> {
    return this.banco.catalogo.count();
  }
}

// ---------------------------------------------------------------------------
// Busca local
// ---------------------------------------------------------------------------

/**
 * Busca do balcão.
 *
 * Prioridade: código de barras exato primeiro. Quando a operadora bipa, ela
 * quer aquele item, não uma lista de sugestões — e o leitor termina com Enter.
 * Só depois vem a busca por texto.
 */
export async function buscarProdutos(
  banco: BancoLocal,
  termo: string,
  limite = 30,
): Promise<ItemCatalogo[]> {
  const consulta = termo.trim();
  if (consulta.length === 0) return [];

  // Código de barras: só dígitos e tamanho de EAN.
  if (/^\d{8,14}$/.test(consulta)) {
    const porBarras = await banco.catalogo.where('codigoBarras').equals(consulta).toArray();
    if (porBarras.length > 0) return porBarras;
  }

  const porSku = await banco.catalogo.where('sku').equalsIgnoreCase(consulta).toArray();
  if (porSku.length > 0) return porSku;

  // Texto: todos os tokens digitados precisam casar (busca conjuntiva).
  // "renda preto" não pode trazer tudo que é renda mais tudo que é preto.
  const tokens = normalizar(consulta)
    .split(/[\s\-/]+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return [];

  const conjuntos = await Promise.all(
    tokens.map((token) =>
      banco.catalogo.where('termos').startsWithIgnoreCase(token).primaryKeys(),
    ),
  );

  let intersecao = new Set(conjuntos[0] as string[]);
  for (const conjunto of conjuntos.slice(1)) {
    const outro = new Set(conjunto as string[]);
    intersecao = new Set([...intersecao].filter((id) => outro.has(id)));
    if (intersecao.size === 0) return [];
  }

  const encontrados = await banco.catalogo.bulkGet([...intersecao].slice(0, limite));
  return encontrados.filter((item): item is ItemCatalogo => item !== undefined);
}
