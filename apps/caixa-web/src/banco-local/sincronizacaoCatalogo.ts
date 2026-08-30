import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { api } from '@/servicos/api.js';
import { bancoLocal, type ItemCatalogoLocal } from './db.js';

interface PaginaCatalogo {
  readonly itens: ItemCatalogoLocal[];
  readonly proximoDesde: string | null;
  readonly proximoUltimoId: string | null;
  readonly temMais: boolean;
}

/**
 * Busca o catálogo do servidor, página por página, e grava no Dexie.
 *
 * Isto é o que faz o caixa continuar vendendo sem rede: depois de rodar uma
 * vez, `useCatalogoLocal` lê do IndexedDB, nunca da API diretamente. O
 * `/catalogo` do servidor é feito para paginação incremental (por
 * `atualizadoEm`), mas aqui sempre busca tudo, do zero — o catálogo desta
 * loja é pequeno o bastante pra isso não pesar, e evita a complexidade de
 * guardar marca d'água entre sessões por enquanto.
 */
export async function sincronizarCatalogo(): Promise<number> {
  const itens: ItemCatalogoLocal[] = [];
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

  const ativos = itens.filter((item) => item.ativo);

  // Troca o conteúdo inteiro da tabela numa transação: nunca deixa o caixa
  // ver um catálogo pela metade (metade da sincronização antiga, metade da
  // nova) se a página fechar no meio do processo.
  await bancoLocal.transaction('rw', bancoLocal.catalogo, async () => {
    await bancoLocal.catalogo.clear();
    await bancoLocal.catalogo.bulkPut(ativos);
  });

  return ativos.length;
}

/**
 * Dispara a sincronização quando há sessão de caixa aberta, e refaz a cada
 * poucos minutos para preço/estoque não ficarem velhos ao longo do turno.
 * Falha de rede aqui não trava nada — o caixa continua vendendo com o que
 * já tinha sincronizado antes.
 */
export function useSincronizacaoCatalogo(habilitado: boolean) {
  return useQuery({
    queryKey: ['sincronizacao-catalogo'],
    queryFn: sincronizarCatalogo,
    enabled: habilitado,
    refetchInterval: 5 * 60_000,
    retry: 3,
  });
}

/** Lê o catálogo do IndexedDB, reativo — é o que a tela de venda usa pra buscar/bipar. */
export function useCatalogoLocal(): ItemCatalogoLocal[] {
  return useLiveQuery(() => bancoLocal.catalogo.toArray(), [], []);
}
