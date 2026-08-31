/**
 * Caixa: configuração do terminal, abertura e resumo.
 *
 * Três estados, decididos por dados e não por navegação implícita:
 *
 *   1. terminal não configurado  → pede o ID (uma vez por computador)
 *   2. sem sessão aberta         → abertura, com fundo de troco
 *   3. sessão aberta             → resumo e acessos a sangria/fechamento
 *
 * Abrir o caixa leva DIRETO para a venda, porque é isso que a operadora quer
 * fazer em seguida. Já entrar por "Caixa" no menu mostra o resumo e fica.
 * Na versão anterior, sem rotas, os dois caminhos se confundiam e a tela de
 * resumo era inalcançável — ela se auto-substituía no mesmo instante.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import { Botao, Campo, Cartao, Erro } from '../componentes/base.js';
import { definirTerminal, terminalConfigurado, useCaixa } from '../estado/caixaStore.js';

export function TelaCaixa() {
  const [terminal, setTerminal] = useState<string | null>(() => terminalConfigurado());
  const sessao = useCaixa((estado) => estado.sessao);
  const jaConsultou = useCaixa((estado) => estado.jaConsultou);

  if (!terminal) {
    return <ConfigurarTerminal aoConfigurar={setTerminal} />;
  }
  if (!jaConsultou) {
    return <Centralizado>Verificando o caixa…</Centralizado>;
  }
  return sessao ? <CaixaAberto /> : <AbrirCaixa />;
}

function Centralizado({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center text-[14px] text-ink-faint">{children}</div>;
}

function Moldura({ titulo, descricao, children }: { titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center px-6 py-10">
      <Cartao className="w-full max-w-[460px] p-9">
        <h1 className="text-[26px]">{titulo}</h1>
        <p className="mt-1.5 mb-7 text-[15px] leading-relaxed text-ink-soft">{descricao}</p>
        {children}
      </Cartao>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConfigurarTerminal({ aoConfigurar }: { aoConfigurar: (id: string) => void }) {
  const [valor, setValor] = useState('');
  const sincronizar = useCaixa((estado) => estado.sincronizar);

  function salvar() {
    const id = valor.trim();
    if (!id) return;
    definirTerminal(id);
    aoConfigurar(id);
    void sincronizar();
  }

  return (
    <Moldura
      titulo="Configurar terminal"
      descricao="Este computador ainda não está associado a um caixa da loja. O gerente encontra o identificador no cadastro de terminais. Isso é feito uma única vez."
    >
      <div className="flex flex-col gap-5">
        <Campo
          rotulo="Identificador do terminal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && salvar()}
          autoFocus
        />
        <Botao variante="primario" tamanho="grande" disabled={!valor.trim()} onClick={salvar}>
          Salvar terminal
        </Botao>
      </div>
    </Moldura>
  );
}

// ---------------------------------------------------------------------------

function AbrirCaixa() {
  const [fundo, setFundo] = useState(0);
  const abrir = useCaixa((estado) => estado.abrir);
  const erro = useCaixa((estado) => estado.erro);
  const carregando = useCaixa((estado) => estado.carregando);
  const navegar = useNavigate();

  async function confirmar() {
    try {
      await abrir(fundo);
      // Quem abre o caixa quer vender em seguida.
      navegar('/venda', { replace: true });
    } catch {
      // O store guardou a mensagem; ela aparece abaixo, junto da ação.
    }
  }

  return (
    <Moldura
      titulo="Abertura de caixa"
      descricao="Conte o dinheiro que está na gaveta agora e informe o valor. É a partir dele que a conferência do fechamento vai bater no fim do expediente."
    >
      <div className="flex flex-col gap-6">
        <CampoDinheiro
          rotulo="Fundo de troco"
          valorCentavos={fundo}
          aoMudar={setFundo}
          destaque
          autoFocus
          ajuda="Digite só os números: 20000 vira R$ 200,00."
          onKeyDown={(e) => e.key === 'Enter' && void confirmar()}
        />

        {erro && <Erro>{erro}</Erro>}

        <Botao variante="primario" tamanho="grande" disabled={carregando} onClick={() => void confirmar()}>
          {carregando ? 'Abrindo…' : 'Abrir caixa e começar a vender'}
        </Botao>

        {/*
          Abrir com gaveta vazia é legítimo (loja que guarda o troco no cofre),
          então não bloqueamos — só avisamos, porque quase sempre é engano.
        */}
        {fundo === 0 && (
          <p className="-mt-2 text-[13px] text-alerta">
            O fundo está zerado. Se a gaveta tem troco, informe o valor antes de abrir.
          </p>
        )}
      </div>
    </Moldura>
  );
}

// ---------------------------------------------------------------------------

function CaixaAberto() {
  const sessao = useCaixa((estado) => estado.sessao)!;
  const navegar = useNavigate();

  const abertaEm = new Date(sessao.abertaEm);

  return (
    <Moldura
      titulo="Caixa aberto"
      descricao="O caixa está operando. O saldo esperado considera o fundo inicial, as vendas em dinheiro e os movimentos manuais."
    >
      <div className="flex flex-col gap-6">
        <dl className="grid gap-3 rounded-[12px] bg-sunken px-5 py-4">
          <Linha rotulo="Fundo de troco" valor={formatarBRL(centavos(sessao.fundoTrocoCentavos))} />
          <Linha
            rotulo="Saldo esperado"
            valor={formatarBRL(centavos(sessao.saldoEsperadoCentavos))}
            forte
          />
          <Linha
            rotulo="Aberto desde"
            valor={abertaEm.toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          />
        </dl>

        <Botao variante="primario" tamanho="grande" onClick={() => navegar('/venda')}>
          Voltar para a venda
        </Botao>

        {/*
          Empilhados, não lado a lado: em duas colunas o rótulo "Sangria e
          suprimento" quebrava em duas linhas. Empilhar também aumenta o alvo
          de clique, o que ajuda quem opera com pressa.
        */}
        <div className="flex flex-col gap-2">
          <Botao onClick={() => navegar('/caixa/movimento')}>Sangria e suprimento</Botao>
          <Botao variante="perigo" onClick={() => navegar('/caixa/fechar')}>
            Fechar caixa
          </Botao>
        </div>
      </div>
    </Moldura>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[14px] text-ink-soft">{rotulo}</dt>
      <dd className={`num ${forte ? 'text-[20px] font-semibold' : 'text-[15px]'}`}>{valor}</dd>
    </div>
  );
}
