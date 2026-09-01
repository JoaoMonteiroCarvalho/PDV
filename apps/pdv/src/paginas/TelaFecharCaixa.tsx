/**
 * Fechamento de caixa — conferência ÀS CEGAS.
 *
 * A regra que define esta tela: **o valor esperado não aparece antes de a
 * operadora dizer quanto contou**. Só depois de confirmar é que o sistema
 * revela esperado, contado e diferença.
 *
 * Isso não é rigor gratuito. Com o esperado na tela, conferir vira copiar: a
 * operadora bate o olho no número, digita ele, e a divergência some — junto
 * com a única chance de a loja descobrir um erro de troco, uma venda lançada
 * errada ou um desvio. A conferência às cegas é o controle inteiro; sem ela a
 * tela não serve para nada além de encerrar a sessão.
 *
 * Fechar é irreversível: não há reabrir sessão. Por isso a confirmação diz o
 * que muda, e o resultado fica na tela depois, para a operadora anotar.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clienteApi } from '../api/cliente.js';
import {
  DENOMINACOES,
  classificarDivergencia,
  contagemVazia,
  somarContagem,
  totalDePecas,
  type ContagemPorDenominacao,
} from '../caixa/cedulas.js';
import { Botao, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import { useEstadoSincronizacao } from '../componentes/IndicadorConexao.js';
import { useCaixa } from '../estado/caixaStore.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';

type Resultado = {
  readonly valorEsperadoCentavos: number;
  readonly valorContadoCentavos: number;
  readonly diferencaCentavos: number;
};

export function TelaFecharCaixa() {
  const navegar = useNavigate();
  const sessao = useCaixa((estado) => estado.sessao);
  const encerrar = useCaixa((estado) => estado.encerrar);
  const sincronizacao = useEstadoSincronizacao();

  const [contagem, setContagem] = useState<ContagemPorDenominacao>({});
  const [totalDigitado, setTotalDigitado] = useState(0);
  const [usarDetalhe, setUsarDetalhe] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const somaDetalhada = useMemo(() => somarContagem(contagem), [contagem]);
  const valorContado = usarDetalhe ? somaDetalhada : totalDigitado;
  const contouAlgo = usarDetalhe ? !contagemVazia(contagem) : totalDigitado > 0;

  const pendentes = sincronizacao?.pendentes ?? 0;
  const bloqueadas = sincronizacao?.bloqueadas ?? 0;

  /*
   * O resultado vem ANTES da checagem de sessão, e a ordem importa: fechar
   * chama `encerrar()`, que zera a sessão local. Com as duas invertidas, a
   * tela caía em "não há caixa aberto" no instante do fechamento e a operadora
   * nunca via a diferença — justamente o único produto desta tela.
   */
  if (resultado) return <Conferencia resultado={resultado} aoSair={() => navegar('/caixa')} />;

  if (!sessao) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="font-titulo text-[22px]">Não há caixa aberto</h1>
        <p className="mt-3 text-[15px] text-ink-soft">
          Este terminal não tem sessão de caixa para fechar.
        </p>
        <Botao variante="neutro" className="mt-6" onClick={() => navegar('/caixa')}>
          Ir para o caixa
        </Botao>
      </div>
    );
  }

  async function fechar() {
    setErro(null);
    setEnviando(true);
    try {
      const retorno = await clienteApi.fecharSessao(sessao!.id, valorContado);
      setResultado(retorno);
      // A sessão morreu no servidor; o estado local precisa acompanhar, senão
      // o guard de rota deixaria a operadora voltar a vender sem caixa.
      encerrar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível fechar o caixa.');
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="font-titulo text-[24px]">Fechamento de caixa</h1>
      <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
        Conte o dinheiro da gaveta e informe o valor.{' '}
        <strong className="font-medium text-ink">
          O sistema só mostra o esperado depois que você confirmar
        </strong>{' '}
        — é assim que a conferência serve para achar erro.
      </p>

      {pendentes > 0 && (
        <FilaPendente
          pendentes={pendentes}
          aoEnviarAgora={() => void motorSincronizacao.enviarPendentes()}
        />
      )}

      {bloqueadas > 0 && <FilaBloqueada bloqueadas={bloqueadas} />}

      <Cartao className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-titulo text-[16px] font-medium">O que você contou</h2>
          <div className="flex gap-1 rounded-[10px] bg-sunken p-1">
            <Alternativa ativa={usarDetalhe} onClick={() => setUsarDetalhe(true)}>
              Por cédula
            </Alternativa>
            <Alternativa ativa={!usarDetalhe} onClick={() => setUsarDetalhe(false)}>
              Total direto
            </Alternativa>
          </div>
        </div>

        {usarDetalhe ? (
          <GradeDeCedulas contagem={contagem} aoMudar={setContagem} />
        ) : (
          <div className="mt-5 max-w-xs">
            <CampoDinheiro
              rotulo="Total contado na gaveta"
              destaque
              valorCentavos={totalDigitado}
              aoMudar={setTotalDigitado}
            />
          </div>
        )}

        <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
          <span className="text-[14px] text-ink-soft">
            Total contado
            {usarDetalhe && somaDetalhada > 0 && (
              <span className="num ml-2 text-[13px] text-ink-faint">
                {totalDePecas(contagem)} peças
              </span>
            )}
          </span>
          <span
            data-testid="total-contado"
            className="num font-titulo text-[30px] font-semibold text-ink"
          >
            {formatarBRL(centavos(valorContado))}
          </span>
        </div>
      </Cartao>

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Botao
          variante="primario"
          tamanho="grande"
          disabled={!contouAlgo || pendentes > 0 || enviando}
          onClick={() => setConfirmando(true)}
        >
          Conferir e fechar
        </Botao>
        <Botao variante="neutro" tamanho="grande" onClick={() => navegar('/caixa')}>
          Cancelar
        </Botao>
      </div>

      {!contouAlgo && (
        <p className="mt-3 text-[13px] text-ink-faint">
          Informe o valor contado para poder fechar.
        </p>
      )}

      {confirmando && (
        <ConfirmacaoFinal
          valorContado={valorContado}
          enviando={enviando}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={() => void fechar()}
        />
      )}
    </div>
  );
}

function Alternativa({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cx(
        'rounded-[8px] px-3 py-1.5 text-[13px] transition-colors duration-200',
        ativa ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function GradeDeCedulas({
  contagem,
  aoMudar,
}: {
  contagem: ContagemPorDenominacao;
  aoMudar: (proxima: ContagemPorDenominacao) => void;
}) {
  return (
    <div className="mt-5 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
      {DENOMINACOES.map((denominacao) => {
        const quantidade = contagem[denominacao.valorCentavos] ?? 0;
        const subtotal = quantidade > 0 ? denominacao.valorCentavos * quantidade : 0;

        return (
          <label
            key={denominacao.valorCentavos}
            className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2"
          >
            <span className="w-[92px] shrink-0 text-[13px] text-ink-soft">
              {denominacao.rotulo}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              aria-label={`Quantidade de ${denominacao.rotulo}`}
              value={quantidade === 0 ? '' : quantidade}
              placeholder="0"
              onChange={(evento) => {
                const bruto = Number.parseInt(evento.target.value, 10);
                aoMudar({
                  ...contagem,
                  [denominacao.valorCentavos]: Number.isFinite(bruto) && bruto > 0 ? bruto : 0,
                });
              }}
              className="num w-14 rounded-[8px] border border-line bg-surface px-2 py-1 text-right text-[14px] focus:border-accent"
            />
            <span className="num flex-1 text-right text-[12px] text-ink-faint">
              {subtotal > 0 ? formatarBRL(centavos(subtotal)) : ''}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Vendas ainda na fila BLOQUEIAM o fechamento.
 *
 * O valor esperado vem do servidor. Se há venda que não subiu, o servidor não
 * sabe dela, o esperado sai menor do que a gaveta e a conferência acusa uma
 * "sobra" que não existe — pior ainda, esse número falso fica gravado. Esperar
 * a fila esvaziar custa segundos; desfazer um fechamento errado não custa nada
 * porque não é possível.
 */
function FilaPendente({
  pendentes,
  aoEnviarAgora,
}: {
  pendentes: number;
  aoEnviarAgora: () => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[12px] border border-alerta/40 bg-alerta/5 px-4 py-3">
      <div className="min-w-[16rem] flex-1 text-[14px] leading-relaxed text-ink">
        <strong className="font-medium">
          {pendentes} {pendentes === 1 ? 'venda ainda não subiu' : 'vendas ainda não subiram'} ao
          servidor.
        </strong>{' '}
        O valor esperado não inclui {pendentes === 1 ? 'ela' : 'elas'}, e a conferência acusaria uma
        sobra que não existe.
      </div>
      <Botao variante="neutro" onClick={aoEnviarAgora}>
        Enviar agora
      </Botao>
    </div>
  );
}

/**
 * Bloqueada é outro caso: o servidor RECUSOU por regra de negócio, e esperar
 * não resolve. A loja precisa fechar o dia de qualquer forma, então isto
 * avisa sem travar — mas deixa claro que o número vai sair torto e que aquilo
 * exige gente.
 */
function FilaBloqueada({ bloqueadas }: { bloqueadas: number }) {
  return (
    <div className="mt-3 rounded-[12px] border border-perigo/30 bg-perigo/5 px-4 py-3 text-[14px] leading-relaxed text-ink">
      <strong className="font-medium">
        {bloqueadas} {bloqueadas === 1 ? 'venda foi recusada' : 'vendas foram recusadas'} pelo
        servidor.
      </strong>{' '}
      Retentar não resolve — precisa de intervenção. O fechamento continua possível, mas a
      diferença vai refletir isso.
    </div>
  );
}

/** Fechar é irreversível: a confirmação diz exatamente o que vai acontecer. */
function ConfirmacaoFinal({
  valorContado,
  enviando,
  aoCancelar,
  aoConfirmar,
}: {
  valorContado: number;
  enviando: boolean;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-fechar"
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"
      onClick={(evento) => {
        if (evento.target === evento.currentTarget && !enviando) aoCancelar();
      }}
    >
      <div className="elevado w-full max-w-[460px] rounded-card border border-line bg-surface p-6">
        <h2 id="titulo-fechar" className="font-titulo text-[18px] font-medium">
          Fechar o caixa?
        </h2>

        <dl className="mt-4 space-y-2 rounded-[12px] bg-sunken px-4 py-3 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Você contou</dt>
            <dd className="num font-medium">{formatarBRL(centavos(valorContado))}</dd>
          </div>
        </dl>

        <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
          A sessão será encerrada e <strong className="font-medium text-ink">não pode ser
          reaberta</strong>. Nenhuma venda poderá ser lançada neste terminal até abrir um caixa
          novo. O valor esperado e a diferença aparecem na próxima tela.
        </p>

        <div className="mt-6 flex gap-2">
          <Botao variante="discreto" className="flex-1" onClick={aoCancelar} disabled={enviando}>
            Voltar e recontar
          </Botao>
          <Botao
            variante="primario"
            tamanho="grande"
            className="flex-[2]"
            onClick={aoConfirmar}
            disabled={enviando}
          >
            {enviando ? 'Fechando…' : 'Fechar caixa'}
          </Botao>
        </div>
      </div>
    </div>
  );
}

/** O resultado da conferência — a primeira vez que o esperado aparece. */
function Conferencia({ resultado, aoSair }: { resultado: Resultado; aoSair: () => void }) {
  const divergencia = classificarDivergencia(resultado.diferencaCentavos);

  const tom = {
    confere: { selo: 'ok' as const, titulo: 'Caixa fechado, conferindo certo' },
    sobra: { selo: 'alerta' as const, titulo: 'Caixa fechado, com sobra' },
    falta: { selo: 'perigo' as const, titulo: 'Caixa fechado, com falta' },
  }[divergencia.tipo];

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Selo tom={tom.selo}>{divergencia.tipo === 'confere' ? 'Sem divergência' : 'Divergência'}</Selo>
      <h1 className="mt-3 font-titulo text-[26px]">{tom.titulo}</h1>

      <dl className="mt-6 divide-y divide-line rounded-card border border-line">
        <Linha rotulo="Esperado pelo sistema" valor={resultado.valorEsperadoCentavos} />
        <Linha rotulo="Contado na gaveta" valor={resultado.valorContadoCentavos} />
        <div className="flex items-center justify-between px-5 py-4">
          <dt className="text-[15px] font-medium">
            {divergencia.tipo === 'confere'
              ? 'Diferença'
              : divergencia.tipo === 'sobra'
                ? 'Sobrou'
                : 'Faltou'}
          </dt>
          <dd
            data-testid="diferenca"
            className={cx(
              'num font-titulo text-[28px] font-semibold',
              divergencia.tipo === 'confere' && 'text-ok',
              divergencia.tipo === 'sobra' && 'text-alerta',
              divergencia.tipo === 'falta' && 'text-perigo',
            )}
          >
            {formatarBRL(centavos(divergencia.valorAbsolutoCentavos))}
          </dd>
        </div>
      </dl>

      {divergencia.tipo !== 'confere' && (
        <p className="mt-4 max-w-prose text-[14px] leading-relaxed text-ink-soft">
          A diferença ficou registrada com a sessão. Anote o que puder ter causado enquanto está
          fresco — troco entregue a mais, sangria não lançada, venda cancelada no papel.
        </p>
      )}

      <Botao variante="primario" tamanho="grande" className="mt-8" onClick={aoSair}>
        Concluir
      </Botao>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-[14px] text-ink-soft">{rotulo}</dt>
      <dd className="num text-[16px]">{formatarBRL(centavos(valor))}</dd>
    </div>
  );
}
