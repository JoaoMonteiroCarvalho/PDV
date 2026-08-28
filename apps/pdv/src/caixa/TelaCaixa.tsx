/**
 * Abertura e fechamento de caixa.
 *
 * A venda exige uma SessaoCaixa aberta — sem ela não há onde lançar o
 * dinheiro. Este componente cobre o ciclo diário: abrir com fundo de troco,
 * sangria/suprimento durante o expediente, fechar conferindo o valor contado.
 *
 * Sangria e suprimento SEMPRE exigem gerente (sem alçada de valor, ao
 * contrário do desconto de venda) — a UI reflete isso pedindo login e senha
 * do gerente no próprio formulário, não um campo de texto livre.
 */

import { formatarBRL, deReais, centavos } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { clienteApi, ErroApi, type SessaoCaixaAberta } from '../api/cliente.js';

const CHAVE_TERMINAL = 'pdv.terminalId';

export function terminalConfigurado(): string | null {
  return localStorage.getItem(CHAVE_TERMINAL);
}

interface Props {
  readonly onSessaoPronta: (sessao: SessaoCaixaAberta) => void;
  /**
   * false (padrão): ao detectar sessão já aberta, pula direto para a venda —
   * é o comportamento desejado ao entrar no app.
   *
   * true: mostra a tela de gestão (sangria/suprimento/fechamento) mesmo com
   * sessão aberta, em vez de pular. Usado quando o operador navega para cá
   * DE PROPÓSITO a partir da venda (botão "Caixa"), para conferir o caixa —
   * sem isso, `onSessaoPronta` dispararia no mesmo instante da montagem e a
   * tela de gestão nunca chegaria a aparecer.
   */
  readonly permanecerSeAberta?: boolean;
}

export function TelaCaixa({ onSessaoPronta, permanecerSeAberta = false }: Props) {
  const [terminalId, setTerminalId] = useState(terminalConfigurado() ?? '');
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<SessaoCaixaAberta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalId) {
      setCarregando(false);
      return;
    }
    // Ao MONTAR, `permanecerSeAberta` decide se uma sessão já existente pula
    // direto para a venda ou fica visível aqui.
    void carregarSessao(terminalId, { avisarSeJaAberta: !permanecerSeAberta });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  async function carregarSessao(
    id: string,
    opcoes: { avisarSeJaAberta: boolean } = { avisarSeJaAberta: true },
  ) {
    setCarregando(true);
    setErro(null);
    try {
      const atual = await clienteApi.buscarSessaoAberta(id);
      if (atual) {
        setSessao(atual);
        if (opcoes.avisarSeJaAberta) onSessaoPronta(atual);
      } else {
        setSessao(null);
      }
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setCarregando(false);
    }
  }

  if (!terminalId) {
    return (
      <ConfigurarTerminal
        aoConfigurar={(id) => {
          localStorage.setItem(CHAVE_TERMINAL, id);
          setTerminalId(id);
        }}
      />
    );
  }

  if (carregando) {
    return <div className="tela-caixa"><p>Verificando sessão de caixa…</p></div>;
  }

  if (sessao) {
    return (
      <FecharCaixa
        sessao={sessao}
        aoFechar={() => {
          setSessao(null);
          void carregarSessao(terminalId);
        }}
      />
    );
  }

  return (
    <AbrirCaixa
      terminalId={terminalId}
      erro={erro}
      aoAbrir={async (fundoTrocoCentavos) => {
        setErro(null);
        try {
          await clienteApi.abrirSessao(terminalId, fundoTrocoCentavos);
          await carregarSessao(terminalId);
        } catch (falha) {
          setErro(mensagemDeErro(falha));
        }
      }}
    />
  );
}

function mensagemDeErro(falha: unknown): string {
  if (falha instanceof ErroApi) return falha.message;
  return falha instanceof Error ? falha.message : 'Ocorreu um erro inesperado.';
}

// ---------------------------------------------------------------------------

function ConfigurarTerminal({ aoConfigurar }: { aoConfigurar: (terminalId: string) => void }) {
  const [terminalId, setTerminalId] = useState('');
  return (
    <div className="tela-caixa">
      <div className="cartao-caixa">
        <h1>Configurar terminal</h1>
        <p className="ajuda">
          Cole o ID do terminal (o gerente encontra em Terminal → configurações).
          Isso é feito uma única vez por computador.
        </p>
        <input value={terminalId} onChange={(e) => setTerminalId(e.target.value)} placeholder="ID do terminal" autoFocus />
        <button disabled={!terminalId} onClick={() => aoConfigurar(terminalId.trim())}>
          Salvar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AbrirCaixa({
  erro,
  aoAbrir,
}: {
  terminalId: string;
  erro: string | null;
  aoAbrir: (fundoTrocoCentavos: number) => Promise<void>;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function abrir() {
    setEnviando(true);
    try {
      await aoAbrir(deReais(texto || '0'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela-caixa">
      <div className="cartao-caixa">
        <h1>Abertura de caixa</h1>
        <label>
          Fundo de troco
          <input
            className="campo-valor-grande"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="0,00"
            autoFocus
          />
        </label>
        {erro && <p className="erro">{erro}</p>}
        <button className="acao-principal" disabled={enviando} onClick={() => void abrir()}>
          {enviando ? 'Abrindo…' : 'Abrir caixa'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FecharCaixa({
  sessao,
  aoFechar,
}: {
  sessao: SessaoCaixaAberta;
  aoFechar: () => void;
}) {
  const [mostrarFechamento, setMostrarFechamento] = useState(false);
  const [mostrarMovimento, setMostrarMovimento] = useState<'SANGRIA' | 'SUPRIMENTO' | null>(null);
  const [sessaoAtual, setSessaoAtual] = useState(sessao);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function atualizarSaldo() {
    const atual = await clienteApi.buscarSessaoAberta(sessaoAtual.terminalId);
    if (atual) setSessaoAtual(atual);
  }

  return (
    <div className="tela-caixa">
      <div className="cartao-caixa cartao-caixa-largo">
        <h1>Caixa aberto</h1>
        <div className="resumo-caixa">
          <div><span>Fundo de troco</span><strong>{formatarBRL(centavos(sessaoAtual.fundoTrocoCentavos))}</strong></div>
          <div><span>Saldo esperado</span><strong>{formatarBRL(centavos(sessaoAtual.saldoEsperadoCentavos))}</strong></div>
          <div><span>Aberto em</span><strong>{new Date(sessaoAtual.abertaEm).toLocaleString('pt-BR')}</strong></div>
        </div>

        {mensagem && <p className="sucesso">{mensagem}</p>}

        <div className="acoes-caixa">
          <button onClick={() => setMostrarMovimento('SANGRIA')}>Sangria</button>
          <button onClick={() => setMostrarMovimento('SUPRIMENTO')}>Suprimento</button>
          <button className="acao-perigo" onClick={() => setMostrarFechamento(true)}>Fechar caixa</button>
        </div>

        {mostrarMovimento && (
          <FormMovimentoManual
            tipo={mostrarMovimento}
            sessaoCaixaId={sessaoAtual.id}
            aoConcluir={async (texto) => {
              setMensagem(texto);
              setMostrarMovimento(null);
              await atualizarSaldo();
            }}
            aoCancelar={() => setMostrarMovimento(null)}
          />
        )}

        {mostrarFechamento && (
          <FormFechamento
            sessaoCaixaId={sessaoAtual.id}
            saldoEsperadoCentavos={sessaoAtual.saldoEsperadoCentavos}
            aoFechar={aoFechar}
            aoCancelar={() => setMostrarFechamento(false)}
          />
        )}
      </div>
    </div>
  );
}

function FormMovimentoManual({
  tipo,
  sessaoCaixaId,
  aoConcluir,
  aoCancelar,
}: {
  tipo: 'SANGRIA' | 'SUPRIMENTO';
  sessaoCaixaId: string;
  aoConcluir: (mensagem: string) => Promise<void>;
  aoCancelar: () => void;
}) {
  const [valor, setValor] = useState('');
  const [observacao, setObservacao] = useState('');
  const [loginGerente, setLoginGerente] = useState('');
  const [senhaGerente, setSenhaGerente] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro(null);
    setEnviando(true);
    try {
      // Sangria/suprimento não usam o token do operador logado: exigem que um
      // GERENTE se autentique na hora, provando presença física.
      const { operador } = await clienteApi.entrarSemTrocarSessao(loginGerente, senhaGerente);
      const valorCentavos = deReais(valor || '0');
      await clienteApi.registrarMovimentoCaixa(sessaoCaixaId, {
        tipo,
        valorCentavos,
        observacao: observacao || undefined,
        autorizadoPorId: operador.id,
      });
      await aoConcluir(
        `${tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'} de ${formatarBRL(centavos(valorCentavos))} registrada.`,
      );
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível concluir.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="painel-flutuante">
      <h2>{tipo === 'SANGRIA' ? 'Sangria (retirada)' : 'Suprimento (reforço)'}</h2>
      <label>Valor<input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" autoFocus /></label>
      <label>Observação<input value={observacao} onChange={(e) => setObservacao(e.target.value)} /></label>

      <p className="ajuda">Exige identificação do gerente — sem exceção de valor.</p>
      <label>Login do gerente<input value={loginGerente} onChange={(e) => setLoginGerente(e.target.value)} /></label>
      <label>Senha do gerente<input type="password" value={senhaGerente} onChange={(e) => setSenhaGerente(e.target.value)} /></label>

      {erro && <p className="erro">{erro}</p>}

      <div className="acoes-formulario">
        <button onClick={aoCancelar}>Cancelar</button>
        <button
          className="acao-principal"
          disabled={enviando || !valor || !loginGerente || !senhaGerente}
          onClick={() => void confirmar()}
        >
          {enviando ? 'Confirmando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}

function FormFechamento({
  sessaoCaixaId,
  saldoEsperadoCentavos,
  aoFechar,
  aoCancelar,
}: {
  sessaoCaixaId: string;
  saldoEsperadoCentavos: number;
  aoFechar: () => void;
  aoCancelar: () => void;
}) {
  const [valor, setValor] = useState('');
  const [resultado, setResultado] = useState<{ diferencaCentavos: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setErro(null);
    setEnviando(true);
    try {
      const valorContado = deReais(valor || '0');
      const dados = await clienteApi.fecharSessao(sessaoCaixaId, valorContado);
      setResultado(dados);
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível fechar o caixa.');
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    const diferenca = resultado.diferencaCentavos;
    return (
      <div className="painel-flutuante">
        <h2>Caixa fechado</h2>
        {diferenca === 0 ? (
          <p className="sucesso">A gaveta bateu certinho com o esperado.</p>
        ) : (
          <p className="erro">
            Divergência de {formatarBRL(centavos(Math.abs(diferenca)))} ({diferenca > 0 ? 'sobra' : 'falta'}).
            Registrado em auditoria.
          </p>
        )}
        <button className="acao-principal" onClick={aoFechar}>Ok</button>
      </div>
    );
  }

  return (
    <div className="painel-flutuante">
      <h2>Fechar caixa</h2>
      <p className="ajuda">Valor esperado na gaveta: {formatarBRL(centavos(saldoEsperadoCentavos))}</p>
      <label>Valor contado<input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" autoFocus /></label>
      {erro && <p className="erro">{erro}</p>}
      <div className="acoes-formulario">
        <button onClick={aoCancelar}>Cancelar</button>
        <button className="acao-perigo" disabled={enviando || !valor} onClick={() => void confirmar()}>
          {enviando ? 'Fechando…' : 'Confirmar fechamento'}
        </button>
      </div>
    </div>
  );
}
