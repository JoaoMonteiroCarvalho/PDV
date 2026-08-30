import type { ReactNode } from 'react';
import { useNavegacao } from '@/estado/useNavegacao.js';
import { useSessao } from '@/estado/useSessao.js';
import { useSessaoCaixaAberta } from '@/servicos/caixa.js';
import { Cabecalho } from '@/telas/Cabecalho.js';
import { TelaAberturaCaixa } from '@/telas/TelaAberturaCaixa.js';
import { TelaConfigurarTerminal } from '@/telas/TelaConfigurarTerminal.js';
import { TelaLogin } from '@/telas/TelaLogin.js';
import { TelaGestaoCaixa } from '@/telas/caixa/TelaGestaoCaixa.js';
import { TelaCrediario } from '@/telas/crediario/TelaCrediario.js';
import { TelaDevolucao } from '@/telas/devolucao/TelaDevolucao.js';
import { TelaEquipe } from '@/telas/equipe/TelaEquipe.js';
import { TelaHistorico } from '@/telas/historico/TelaHistorico.js';
import { TelaProdutos } from '@/telas/produtos/TelaProdutos.js';
import { TelaRelatorios } from '@/telas/relatorios/TelaRelatorios.js';
import { TelaVenda } from '@/telas/venda/TelaVenda.js';

/**
 * Decide qual tela mostrar, na ordem que faz sentido operacionalmente:
 *
 *   1. sem login          -> TelaLogin
 *   2. sem terminal        -> TelaConfigurarTerminal (uma vez por computador)
 *   3. sem caixa aberto    -> TelaAberturaCaixa
 *   4. tudo certo          -> tela de venda (placeholder até a Fase 2)
 *
 * É condicional, não rota separada por passo: o operador não precisa
 * "navegar" por essas etapas, elas são pré-requisito pra chegar na venda.
 */
export function PortaDeEntrada() {
  const token = useSessao((estado) => estado.token);
  const terminalId = useSessao((estado) => estado.terminalId);

  if (!token) return <TelaLogin />;
  if (!terminalId) return <ConteudoAutenticado><TelaConfigurarTerminal /></ConteudoAutenticado>;

  return (
    <ConteudoAutenticado>
      <ConteudoComTerminal terminalId={terminalId} />
    </ConteudoAutenticado>
  );
}

function ConteudoAutenticado({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <Cabecalho />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function ConteudoComTerminal({ terminalId }: { terminalId: string }) {
  const { data: sessao, isLoading, isError } = useSessaoCaixaAberta(terminalId);
  const tela = useNavegacao((estado) => estado.tela);

  if (isLoading) {
    return (
      <div className="grid min-h-full place-items-center">
        <p className="text-corpo text-texto-secundario">Verificando sessão de caixa…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid min-h-full place-items-center">
        <p role="alert" className="text-corpo text-perigo">
          Não foi possível falar com o servidor. Verifique a conexão e recarregue a página.
        </p>
      </div>
    );
  }

  if (!sessao) return <TelaAberturaCaixa />;
  if (tela === 'gestao-caixa') return <TelaGestaoCaixa sessao={sessao} />;
  if (tela === 'produtos') return <TelaProdutos />;
  if (tela === 'devolucao') return <TelaDevolucao />;
  if (tela === 'historico') return <TelaHistorico />;
  if (tela === 'relatorios') return <TelaRelatorios />;
  if (tela === 'crediario') return <TelaCrediario />;
  if (tela === 'equipe') return <TelaEquipe />;
  return <TelaVenda />;
}
