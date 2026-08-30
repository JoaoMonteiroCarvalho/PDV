import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { useNavegacao } from '@/estado/useNavegacao.js';
import { useSessao } from '@/estado/useSessao.js';
import { useSessaoCaixaAberta } from '@/servicos/caixa.js';
import { IndicadorConexao } from './IndicadorConexao.js';
import { ModalTrocarOperador } from './ModalTrocarOperador.js';

/** Barra fixa no topo, sempre visível depois do login. */
export function Cabecalho() {
  const operador = useSessao((estado) => estado.operador);
  const terminalId = useSessao((estado) => estado.terminalId);
  const sair = useSessao((estado) => estado.sair);
  const [modalAberto, setModalAberto] = useState(false);

  // Mesma queryKey já usada em PortaDeEntrada/TelaVenda — o TanStack Query
  // deduplica, não dispara uma segunda requisição por causa disto.
  const { data: sessaoCaixa } = useSessaoCaixaAberta(terminalId);
  const tela = useNavegacao((estado) => estado.tela);
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const irParaGestaoCaixa = useNavegacao((estado) => estado.irParaGestaoCaixa);
  const irParaProdutos = useNavegacao((estado) => estado.irParaProdutos);
  const irParaDevolucao = useNavegacao((estado) => estado.irParaDevolucao);
  const irParaHistorico = useNavegacao((estado) => estado.irParaHistorico);

  if (!operador) return null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-borda bg-superficie px-5">
      <span className="text-corpo font-semibold">PDV</span>

      <div className="flex items-center gap-4">
        <IndicadorConexao />
        <span className="text-rotulo text-texto-secundario">
          {operador.nome} <span className="text-texto-secundario/70">· {operador.papel}</span>
        </span>
        {sessaoCaixa && tela === 'venda' && (
          <>
            <Button variante="secundaria" onClick={irParaGestaoCaixa}>
              Caixa
            </Button>
            <Button variante="secundaria" onClick={irParaProdutos}>
              Produtos
            </Button>
            <Button variante="secundaria" onClick={irParaDevolucao}>
              Devolução
            </Button>
            <Button variante="secundaria" onClick={irParaHistorico}>
              Histórico
            </Button>
          </>
        )}
        {sessaoCaixa && tela !== 'venda' && (
          <Button variante="secundaria" onClick={irParaVenda}>
            Voltar pra venda
          </Button>
        )}
        <Button variante="secundaria" onClick={() => setModalAberto(true)}>
          Trocar operador
        </Button>
        <Button variante="fantasma" onClick={sair}>
          Sair
        </Button>
      </div>

      <ModalTrocarOperador aberto={modalAberto} aoFechar={() => setModalAberto(false)} />
    </header>
  );
}
