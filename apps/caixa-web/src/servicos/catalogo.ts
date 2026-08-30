import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

export interface ItemCatalogo {
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

interface PaginaCatalogo {
  readonly itens: ItemCatalogo[];
  readonly proximoDesde: string | null;
  readonly proximoUltimoId: string | null;
  readonly temMais: boolean;
}

/**
 * Busca o catálogo inteiro, página por página.
 *
 * `/catalogo` na API é feito para SINCRONIZAÇÃO incremental (Fase 4, com
 * Dexie e fila offline), não para busca — não existe endpoint de busca por
 * nome ou código no backend hoje. Enquanto o Dexie não entra, buscamos tudo
 * uma vez (a loja tem catálogo pequeno) e filtramos no cliente. A Fase 4
 * troca a origem do dado para IndexedDB; a lógica de busca em si não muda.
 */
async function buscarCatalogoCompleto(): Promise<ItemCatalogo[]> {
  const itens: ItemCatalogo[] = [];
  let desde: string | undefined;
  let ultimoId: string | undefined;

  for (let pagina = 0; pagina < 200; pagina += 1) {
    const parametros = new URLSearchParams({ limite: '500' });
    if (desde) parametros.set('desde', desde);
    if (ultimoId) parametros.set('ultimoId', ultimoId);

    const resposta = await api<PaginaCatalogo>(`/catalogo?${parametros.toString()}`);
    itens.push(...resposta.itens);
    if (!resposta.temMais) break;
    desde = resposta.proximoDesde ?? undefined;
    ultimoId = resposta.proximoUltimoId ?? undefined;
  }

  return itens.filter((item) => item.ativo);
}

export function useCatalogo() {
  return useQuery({
    queryKey: ['catalogo'],
    queryFn: buscarCatalogoCompleto,
    staleTime: 5 * 60_000,
  });
}
