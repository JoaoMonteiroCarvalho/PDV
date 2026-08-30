import { useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { bancoLocal } from '@/banco-local/db.js';
import { useSaudeServidor } from '@/servicos/saude.js';
import { Badge } from '@/components/ui/Badge.js';

/**
 * Estado de conexão, sempre visível — nunca escondido atrás de um menu.
 * O operador precisa saber, olhando pra tela, se está vendendo offline,
 * antes de descobrir isso por um erro estranho.
 */
export function IndicadorConexao() {
  const { data, isError, isFetching } = useSaudeServidor();
  // TanStack Query mantém o último `data` bem-sucedido mesmo quando um
  // refetch seguinte FALHA — `data` sozinho não muda pra `undefined` só
  // porque a rede caiu agora. Sem checar `isError` explicitamente, o
  // indicador continuava dizendo "Online" com a rede genuinamente fora,
  // porque `data` ainda carregava o `true` da última consulta boa.
  const online = data === true && !isError;
  const queryClient = useQueryClient();

  // O ping periódico roda a cada 10s (servicos/saude.ts) — sem isto, o
  // indicador ficaria mostrando "Online" por até 10s depois da rede cair de
  // verdade, porque ainda não teria chegado a vez do próximo ping. Os
  // eventos nativos do navegador cobrem o caso comum (rede caiu de fato) na
  // hora; o ping continua sendo a fonte de verdade para o caso de rede
  // "mentirosa" (Wi-Fi conectado sem saída pra internet).
  useEffect(() => {
    function reavaliar() {
      void queryClient.invalidateQueries({ queryKey: ['saude-servidor'] });
    }
    window.addEventListener('online', reavaliar);
    window.addEventListener('offline', reavaliar);
    return () => {
      window.removeEventListener('online', reavaliar);
      window.removeEventListener('offline', reavaliar);
    };
  }, [queryClient]);

  const contagem = useLiveQuery(
    async () => {
      const [pendentes, enviando, erro] = await Promise.all([
        bancoLocal.filaVendas.where('status').equals('pendente').count(),
        bancoLocal.filaVendas.where('status').equals('enviando').count(),
        bancoLocal.filaVendas.where('status').equals('erro').count(),
      ]);
      return { pendentes: pendentes + erro, sincronizando: enviando > 0 };
    },
    [],
    { pendentes: 0, sincronizando: false },
  );

  if (contagem.sincronizando) {
    return <Badge tom="alerta">Sincronizando…</Badge>;
  }

  if (!online) {
    return (
      <Badge tom="perigo">
        Offline{contagem.pendentes > 0 && ` · ${contagem.pendentes} pendente(s)`}
      </Badge>
    );
  }

  if (contagem.pendentes > 0) {
    return <Badge tom="alerta">{contagem.pendentes} venda(s) pendente(s)</Badge>;
  }

  return <Badge tom={isFetching ? 'neutro' : 'sucesso'}>Online</Badge>;
}
