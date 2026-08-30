import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { useNavegacao } from '@/estado/useNavegacao.js';
import type { SessaoCaixaAberta } from '@/servicos/caixa.js';
import { ModalMovimentoCaixa } from './ModalMovimentoCaixa.js';
import { TelaFecharCaixa } from './TelaFecharCaixa.js';

type Painel = 'menu' | 'sangria' | 'suprimento' | 'fechar';

interface Props {
  readonly sessao: SessaoCaixaAberta;
}

/**
 * Hub de sangria, suprimento e fechamento.
 *
 * Deliberadamente NÃO mostra `saldoEsperadoCentavos` em lugar nenhum desta
 * tela — só o fundo de troco (conhecido desde a abertura). Mostrar o
 * esperado aqui, antes do operador chegar na tela de fechamento, já teria
 * revelado o número que a conferência cega existe pra esconder.
 */
export function TelaGestaoCaixa({ sessao }: Props) {
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const [painel, setPainel] = useState<Painel>('menu');

  if (painel === 'fechar') {
    return (
      <TelaFecharCaixa
        sessaoCaixaId={sessao.id}
        aoVoltar={() => setPainel('menu')}
        aoConcluir={irParaVenda}
      />
    );
  }

  return (
    <div className="grid min-h-full place-items-center">
      <div className="w-[calc(100%-2rem)] max-w-sm space-y-6 rounded-lg border border-borda bg-superficie p-8">
        <header className="space-y-1">
          <h1 className="text-valor">Caixa</h1>
          <p className="text-rotulo text-texto-secundario">
            Aberto às {new Date(sessao.abertaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{' '}
            · fundo de troco {formatarBRL(centavos(sessao.fundoTrocoCentavos))}
          </p>
        </header>

        <div className="space-y-3">
          <Button variante="secundaria" tamanho="grande" className="w-full" onClick={() => setPainel('sangria')}>
            Sangria
          </Button>
          <Button variante="secundaria" tamanho="grande" className="w-full" onClick={() => setPainel('suprimento')}>
            Suprimento
          </Button>
          <Button variante="perigo" tamanho="grande" className="w-full" onClick={() => setPainel('fechar')}>
            Fechar caixa
          </Button>
        </div>

        <Button variante="fantasma" className="w-full" onClick={irParaVenda}>
          Voltar pra venda
        </Button>
      </div>

      {(painel === 'sangria' || painel === 'suprimento') && (
        <ModalMovimentoCaixa
          sessaoCaixaId={sessao.id}
          tipo={painel === 'sangria' ? 'SANGRIA' : 'SUPRIMENTO'}
          aoConcluir={() => setPainel('menu')}
          aoFechar={() => setPainel('menu')}
        />
      )}
    </div>
  );
}
