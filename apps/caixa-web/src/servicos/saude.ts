import { useQuery } from '@tanstack/react-query';

/**
 * Ping real ao servidor, não `navigator.onLine`.
 *
 * `navigator.onLine` só diz se a placa de rede está ativa — um cabo ligado
 * num roteador sem internet, ou um Wi-Fi conectado a uma rede que não sai
 * pra fora, ainda reporta `true`. Quem decide "online" de verdade aqui é
 * conseguir falar com a API.
 */
export function useSaudeServidor() {
  return useQuery({
    queryKey: ['saude-servidor'],
    queryFn: async () => {
      const resposta = await fetch('/api/saude', { signal: AbortSignal.timeout(4000) });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      return true;
    },
    refetchInterval: 10_000,
    // Erro de rede não pode virar spam de retry — o indicador já reflete o
    // estado "offline" a cada tentativa que falha, sem esperar 3 retentativas.
    retry: false,
    staleTime: 0,
    // O PADRÃO do TanStack Query (`networkMode: 'online'`) PAUSA a query
    // assim que `navigator.onLine` vira `false`, sem sequer tentar o
    // fetch — o que classificaria como "não sei" (isPaused), nunca como
    // "offline" de verdade. Só essa query específica precisa ignorar isso:
    // o motivo dela existir é justamente NÃO confiar em `navigator.onLine`
    // (ver comentário no topo do arquivo) e tentar a rede de verdade.
    networkMode: 'always',
  });
}
