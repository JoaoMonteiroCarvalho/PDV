/**
 * Sangria e suprimento.
 *
 * Dinheiro entrando ou saindo da gaveta FORA de uma venda. É o ponto clássico
 * de fraude interna no varejo, e por isso a regra aqui não tem alçada: toda
 * operação exige gerente identificada, por menor que seja o valor. Desconto
 * tem limite de operador; isto não tem.
 *
 * A gerente entra sem derrubar a sessão da operadora
 * (`entrarSemTrocarSessao`): quem está vendendo continua sendo quem está
 * vendendo, a gerente só prova identidade para aquela operação. Trocar o token
 * aqui deslogaria a operadora no meio do expediente.
 *
 * O SALDO DA GAVETA só aparece depois que a gerente se identifica, e essa é a
 * contrapartida da conferência às cegas do fechamento: o número existe e é
 * útil para decidir quanto levar ao cofre, mas não pode ficar na tela da
 * operadora, a um clique do botão de fechar o caixa.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clienteApi, type Operador } from '../api/cliente.js';
import {
  efeitoNoSaldo,
  ehPapelAutorizador,
  impedimentosDoMovimento,
  type TipoMovimento,
} from '../caixa/movimento.js';
import { Botao, Campo, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import { useCaixa } from '../estado/caixaStore.js';

export function TelaMovimentoCaixa() {
  const navegar = useNavigate();
  const sessao = useCaixa((estado) => estado.sessao);
  const sincronizarCaixa = useCaixa((estado) => estado.sincronizar);

  const [tipo, setTipo] = useState<TipoMovimento>('SANGRIA');
  const [valorCentavos, setValorCentavos] = useState(0);
  const [observacao, setObservacao] = useState('');
  const [gerente, setGerente] = useState<Operador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [registrado, setRegistrado] = useState<{ tipo: TipoMovimento; valorCentavos: number } | null>(
    null,
  );

  if (registrado) {
    return (
      <Registrado
        movimento={registrado}
        aoSair={() => navegar('/caixa')}
        aoNovo={() => {
          setRegistrado(null);
          setValorCentavos(0);
          setObservacao('');
          // A gerente permanece identificada: ela costuma fazer dois
          // movimentos seguidos, e pedir a senha de novo só atrasa.
        }}
      />
    );
  }

  if (!sessao) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="font-titulo text-[22px]">Não há caixa aberto</h1>
        <p className="mt-3 text-[15px] text-ink-soft">
          Sangria e suprimento acontecem dentro de uma sessão de caixa.
        </p>
        <Botao variante="neutro" className="mt-6" onClick={() => navegar('/caixa')}>
          Ir para o caixa
        </Botao>
      </div>
    );
  }

  // O saldo só é conhecido pela tela depois que a gerente entra.
  const saldoEsperado = gerente ? sessao.saldoEsperadoCentavos : null;
  const impedimentos = impedimentosDoMovimento({
    tipo,
    valorCentavos,
    observacao,
    saldoEsperadoCentavos: saldoEsperado,
    gerenteAutenticada: gerente !== null,
  });

  async function registrar() {
    if (!gerente || !sessao) return;
    setErro(null);
    setEnviando(true);
    try {
      await clienteApi.registrarMovimentoCaixa(sessao.id, {
        tipo,
        valorCentavos,
        observacao: observacao.trim() || undefined,
        autorizadoPorId: gerente.id,
      });
      // O saldo da gaveta mudou: sem isto, um segundo movimento seria
      // validado contra um número velho.
      await sincronizarCaixa();
      setRegistrado({ tipo, valorCentavos });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível registrar o movimento.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 className="font-titulo text-[24px]">Sangria e suprimento</h1>
      <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
        Dinheiro que entra ou sai da gaveta fora de uma venda.{' '}
        <strong className="font-medium text-ink">Sempre com gerente identificada</strong> — não há
        exceção por valor pequeno.
      </p>

      <Cartao className="mt-6 p-5">
        <div className="grid grid-cols-2 gap-2">
          <BotaoTipo ativo={tipo === 'SANGRIA'} onClick={() => setTipo('SANGRIA')}>
            Sangria
            <span className="block text-[12px] font-normal opacity-75">tira da gaveta</span>
          </BotaoTipo>
          <BotaoTipo ativo={tipo === 'SUPRIMENTO'} onClick={() => setTipo('SUPRIMENTO')}>
            Suprimento
            <span className="block text-[12px] font-normal opacity-75">põe na gaveta</span>
          </BotaoTipo>
        </div>

        <div className="mt-5 max-w-xs">
          <CampoDinheiro
            rotulo={tipo === 'SANGRIA' ? 'Valor retirado' : 'Valor colocado'}
            destaque
            valorCentavos={valorCentavos}
            aoMudar={setValorCentavos}
          />
        </div>

        <label className="mt-5 flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-soft">
            {tipo === 'SANGRIA' ? 'Para onde foi' : 'De onde veio'}
            {tipo === 'SANGRIA' && <span className="text-perigo"> *</span>}
          </span>
          <input
            value={observacao}
            onChange={(evento) => setObservacao(evento.target.value)}
            placeholder={tipo === 'SANGRIA' ? 'cofre, depósito, pagamento de entrega…' : 'reforço de troco…'}
            className="h-12 rounded-[12px] border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent"
          />
        </label>
      </Cartao>

      <AutorizacaoGerente
        gerente={gerente}
        aoAutenticar={setGerente}
        aoSair={() => setGerente(null)}
      />

      {gerente && saldoEsperado !== null && (
        <ResumoDoEfeito
          tipo={tipo}
          valorCentavos={valorCentavos}
          saldoAtualCentavos={saldoEsperado}
        />
      )}

      {impedimentos.length > 0 && (
        <ul className="mt-5 space-y-1.5">
          {impedimentos.map((texto) => (
            <li key={texto} className="flex gap-2 text-[13px] text-ink-soft">
              <span aria-hidden className="text-ink-faint">
                •
              </span>
              {texto}
            </li>
          ))}
        </ul>
      )}

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Botao
          variante="primario"
          tamanho="grande"
          disabled={impedimentos.length > 0 || enviando}
          onClick={() => void registrar()}
        >
          {enviando ? 'Registrando…' : tipo === 'SANGRIA' ? 'Registrar sangria' : 'Registrar suprimento'}
        </Botao>
        <Botao variante="neutro" tamanho="grande" onClick={() => navegar('/caixa')}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

function BotaoTipo({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cx(
        'rounded-[12px] border px-4 py-3 text-left text-[15px] font-medium transition-colors duration-200',
        ativo ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-sunken',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Identificação da gerente.
 *
 * Usa `entrarSemTrocarSessao`: a operadora continua logada. O token da gerente
 * é descartado — só o `id` dela é usado, e o servidor revalida o papel.
 */
function AutorizacaoGerente({
  gerente,
  aoAutenticar,
  aoSair,
}: {
  gerente: Operador | null;
  aoAutenticar: (operador: Operador) => void;
  aoSair: () => void;
}) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  async function autenticar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setVerificando(true);
    try {
      const { operador } = await clienteApi.entrarSemTrocarSessao(login.trim(), senha);
      if (!ehPapelAutorizador(operador.papel)) {
        // Credencial correta, papel errado: dizer isso é mais útil que
        // "credenciais inválidas", e não vaza nada que a pessoa não saiba.
        setErro(`${operador.nome} não tem perfil de gerente e não pode autorizar.`);
        return;
      }
      aoAutenticar(operador);
      setLogin('');
      setSenha('');
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível autenticar.');
    } finally {
      setVerificando(false);
    }
  }

  if (gerente) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[12px] border border-ok/30 bg-ok/5 px-4 py-3">
        <Selo tom="ok">Autorizado</Selo>
        <span className="flex-1 text-[14px] text-ink">{gerente.nome}</span>
        <Botao variante="discreto" onClick={aoSair} className="h-8 px-3 text-[13px]">
          Trocar
        </Botao>
      </div>
    );
  }

  return (
    <Cartao className="mt-5 p-5">
      <h2 className="font-titulo text-[16px] font-medium">Autorização da gerente</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
        A operadora continua logada — a gerente só confirma a identidade para esta operação.
      </p>

      <form onSubmit={(evento) => void autenticar(evento)} className="mt-4 flex flex-wrap gap-3">
        <div className="min-w-[10rem] flex-1">
          <Campo
            rotulo="Gerente"
            name="gerente-login"
            autoComplete="off"
            value={login}
            onChange={(evento) => setLogin(evento.target.value)}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Campo
            rotulo="Senha"
            name="gerente-senha"
            type="password"
            autoComplete="off"
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
          />
        </div>
        <Botao
          type="submit"
          variante="neutro"
          className="self-end"
          disabled={verificando || login.trim() === '' || senha === ''}
        >
          {verificando ? 'Verificando…' : 'Autorizar'}
        </Botao>
      </form>

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}
    </Cartao>
  );
}

/**
 * Ação financeira mostra exatamente o que muda — antes de mudar.
 *
 * É aqui que o saldo aparece, e só aqui: a gerente precisa dele para decidir
 * quanto levar ao cofre.
 */
function ResumoDoEfeito({
  tipo,
  valorCentavos,
  saldoAtualCentavos,
}: {
  tipo: TipoMovimento;
  valorCentavos: number;
  saldoAtualCentavos: number;
}) {
  const depois = saldoAtualCentavos + efeitoNoSaldo(tipo, valorCentavos);

  return (
    <dl
      data-testid="efeito-no-caixa"
      className="mt-5 divide-y divide-line rounded-[12px] border border-line"
    >
      <Linha rotulo="Na gaveta agora" valor={saldoAtualCentavos} />
      <Linha
        rotulo={tipo === 'SANGRIA' ? 'Sai' : 'Entra'}
        valor={valorCentavos}
        sinal={tipo === 'SANGRIA' ? '−' : '+'}
      />
      <Linha rotulo="Fica com" valor={depois} forte />
    </dl>
  );
}

function Linha({
  rotulo,
  valor,
  sinal,
  forte,
}: {
  rotulo: string;
  valor: number;
  sinal?: string;
  forte?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <dt className={cx('text-[14px]', forte ? 'font-medium text-ink' : 'text-ink-soft')}>
        {rotulo}
      </dt>
      <dd className={cx('num', forte ? 'text-[17px] font-semibold' : 'text-[15px]')}>
        {sinal}
        {formatarBRL(centavos(Math.abs(valor)))}
      </dd>
    </div>
  );
}

function Registrado({
  movimento,
  aoSair,
  aoNovo,
}: {
  movimento: { tipo: TipoMovimento; valorCentavos: number };
  aoSair: () => void;
  aoNovo: () => void;
}) {
  const nome = movimento.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento';

  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <Selo tom="ok">{nome} registrada</Selo>
      <p className="num mt-4 font-titulo text-[36px] font-semibold">
        {formatarBRL(centavos(movimento.valorCentavos))}
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
        O movimento ficou registrado com quem autorizou, e entra no saldo esperado do fechamento.
      </p>
      <div className="mt-8 flex justify-center gap-2">
        <Botao variante="primario" tamanho="grande" onClick={aoSair}>
          Voltar ao caixa
        </Botao>
        <Botao variante="neutro" tamanho="grande" onClick={aoNovo}>
          Outro movimento
        </Botao>
      </div>
    </div>
  );
}
