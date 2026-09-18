/**
 * Devolução — de item e quantidade parcial.
 *
 * Cobre o caso real de moda íntima que motivou o schema de devolução no
 * backend: cliente compra várias peças iguais e devolve só uma.
 *
 * Fluxo em três passos, e cada um só aparece depois do anterior estar
 * resolvido — a tela nunca mostra formulário de devolução para uma venda que
 * ainda não foi encontrada:
 *
 *   1. Localizar a venda (por número, ou pelo código curto impresso quando
 *      ela ainda não sincronizou e não tem número).
 *   2. Marcar quanto de cada item volta.
 *   3. Autorização de gerente + motivo + forma de estorno.
 *
 * Autorização usa exatamente o componente de `TelaMovimentoCaixa`
 * (`entrarSemTrocarSessao`): devolução mexe em dinheiro fora do fluxo normal
 * de venda, mesma disciplina de sangria/suprimento — gerente identificada,
 * sem alçada por valor pequeno.
 */

import { formatarBRL, centavos } from '@pdv/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  clienteApi,
  type DisponivelParaDevolucao,
  type ItemDisponivelParaDevolucao,
  type AutorizacaoGerente,
  type Operador,
} from '../api/cliente.js';
import {
  ajustarQuantidade,
  itensParaEnviar,
  podeConfirmarDevolucao,
  quantidadeDisponivel,
  totalADevolverCentavos,
} from '../caixa/devolucao.js';
import { ehPapelAutorizador } from '../caixa/movimento.js';
import { Botao, Campo, Cartao, Erro, Selo, cx } from '../componentes/base.js';

type FormaEstorno = 'DINHEIRO' | 'PIX' | 'CARTAO' | 'VALE_TROCA';

const FORMAS_DE_ESTORNO: { valor: FormaEstorno; rotulo: string }[] = [
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'CARTAO', rotulo: 'Cartão' },
  { valor: 'VALE_TROCA', rotulo: 'Vale-troca' },
];

interface VendaLocalizada {
  readonly id: string;
  readonly numero: number | null;
}

export function TelaDevolucao() {
  const navegar = useNavigate();
  const [venda, setVenda] = useState<VendaLocalizada | null>(null);
  const [disponivel, setDisponivel] = useState<DisponivelParaDevolucao | null>(null);
  const [concluida, setConcluida] = useState<{ totalCentavos: number } | null>(null);

  if (concluida) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <Selo tom="ok">Devolução registrada</Selo>
        <p className="num mt-4 font-titulo text-[36px] font-semibold">
          {formatarBRL(centavos(concluida.totalCentavos))}
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
          O estorno ficou registrado com quem autorizou. O estoque já voltou para a peça devolvida.
        </p>
        <div className="mt-8 flex justify-center gap-2">
          <Botao variante="primario" tamanho="grande" onClick={() => navegar('/venda')}>
            Voltar à venda
          </Botao>
          <Botao
            variante="neutro"
            tamanho="grande"
            onClick={() => {
              setConcluida(null);
              setVenda(null);
              setDisponivel(null);
            }}
          >
            Outra devolução
          </Botao>
        </div>
      </div>
    );
  }

  if (!venda || !disponivel) {
    return (
      <div className="mx-auto max-w-lg px-6 py-6">
        <h1 className="font-titulo text-[24px]">Devolução</h1>
        <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
          Localize a venda pelo número impresso no comprovante, ou pelo código curto de 8 caracteres
          quando ela ainda não tiver sincronizado.
        </p>

        <LocalizarVenda
          aoEncontrar={(v, d) => {
            setVenda(v);
            setDisponivel(d);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-titulo text-[24px]">
          {venda.numero !== null ? `Devolução — Venda #${venda.numero}` : 'Devolução'}
        </h1>
        <Botao
          variante="discreto"
          className="h-8 px-3 text-[13px]"
          onClick={() => {
            setVenda(null);
            setDisponivel(null);
          }}
        >
          Trocar venda
        </Botao>
      </div>

      <FormularioDevolucao
        vendaId={disponivel.vendaId}
        itens={disponivel.itens}
        aoConcluir={(totalCentavos) => setConcluida({ totalCentavos })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passo 1 — localizar a venda
// ---------------------------------------------------------------------------

function LocalizarVenda({
  aoEncontrar,
}: {
  aoEncontrar: (venda: VendaLocalizada, disponivel: DisponivelParaDevolucao) => void;
}) {
  const [termo, setTermo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * Um código de 8 caracteres hexadecimais é o código curto (venda ainda sem
   * número sequencial); qualquer outra coisa é tratada como número. É a
   * mesma distinção que o comprovante imprime: número OU código, nunca os
   * dois juntos, então a tela também escolhe um caminho só.
   */
  const ehCodigoCurto = /^[0-9a-fA-F]{8}$/.test(termo.trim());

  async function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    const valor = termo.trim();
    if (valor.length === 0) return;

    setErro(null);
    setBuscando(true);
    try {
      const resumo = ehCodigoCurto
        ? await clienteApi.buscarVendaPorCodigo(valor)
        : await clienteApi.buscarVendaPorNumero(Number(valor));

      const disponivel = await clienteApi.buscarDisponivelParaDevolucao(resumo.id);
      aoEncontrar({ id: resumo.id, numero: resumo.numero }, disponivel);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível localizar a venda.');
    } finally {
      setBuscando(false);
    }
  }

  return (
    <Cartao className="mt-6 p-5">
      <form onSubmit={(evento) => void buscar(evento)} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Campo
            rotulo="Número ou código da venda"
            placeholder="Ex.: 42 ou ABC12345"
            value={termo}
            onChange={(evento) => setTermo(evento.target.value)}
            autoFocus
            autoComplete="off"
          />
        </div>
        <Botao type="submit" variante="primario" disabled={buscando || termo.trim() === ''}>
          {buscando ? 'Buscando…' : 'Buscar venda'}
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

// ---------------------------------------------------------------------------
// Passos 2 e 3 — itens, motivo, gerente
// ---------------------------------------------------------------------------

function FormularioDevolucao({
  vendaId,
  itens,
  aoConcluir,
}: {
  vendaId: string;
  itens: readonly ItemDisponivelParaDevolucao[];
  aoConcluir: (totalCentavos: number) => void;
}) {
  const [marcados, setMarcados] = useState<Map<string, number>>(new Map());
  const [motivo, setMotivo] = useState('');
  const [formaEstorno, setFormaEstorno] = useState<FormaEstorno>('DINHEIRO');
  const [autorizacao, setAutorizacao] = useState<AutorizacaoGerente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const totalCentavos = useMemo(() => totalADevolverCentavos(itens, marcados), [itens, marcados]);
  const podeConfirmar = podeConfirmarDevolucao({
    totalCentavos,
    motivo,
    gerenteId: autorizacao?.operador.id ?? null,
  });

  function mudarQuantidade(item: ItemDisponivelParaDevolucao, delta: number) {
    setMarcados((atual) => {
      const proximo = new Map(atual);
      const valor = ajustarQuantidade(item, atual.get(item.itemVendaId) ?? 0, delta);
      proximo.set(item.itemVendaId, valor);
      return proximo;
    });
  }

  async function confirmar() {
    if (!autorizacao || !podeConfirmar) return;
    setErro(null);
    setEnviando(true);
    try {
      const resultado = await clienteApi.registrarDevolucao(vendaId, {
        motivo: motivo.trim(),
        formaEstorno,
        itens: itensParaEnviar(marcados),
        tokenAutorizacao: autorizacao.tokenAutorizacao,
      });
      aoConcluir(resultado.totalCentavos);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível registrar a devolução.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Cartao className="mt-6 p-5">
        <h2 className="font-titulo text-[16px] font-medium">O que volta</h2>
        <ul className="mt-3 divide-y divide-line">
          {itens.map((item) => (
            <LinhaItem
              key={item.itemVendaId}
              item={item}
              quantidadeMarcada={marcados.get(item.itemVendaId) ?? 0}
              aoMudar={(delta) => mudarQuantidade(item, delta)}
            />
          ))}
        </ul>

        <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
          <span className="text-[14px] text-ink-soft">Total a devolver</span>
          <span className="num font-titulo text-[22px] font-semibold text-ink">
            {formatarBRL(centavos(totalCentavos))}
          </span>
        </div>
      </Cartao>

      <Cartao className="mt-5 p-5">
        <h2 className="font-titulo text-[16px] font-medium">Motivo e forma de estorno</h2>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-soft">Motivo da devolução</span>
          <input
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            placeholder="Ex.: peça com defeito"
            className="h-12 rounded-[8px] border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent"
          />
        </label>

        <div className="mt-4">
          <span className="text-[13px] text-ink-soft">Como o dinheiro volta para a cliente</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FORMAS_DE_ESTORNO.map((opcao) => (
              <button
                key={opcao.valor}
                type="button"
                aria-pressed={formaEstorno === opcao.valor}
                onClick={() => setFormaEstorno(opcao.valor)}
                className={cx(
                  'rounded-[8px] border px-3 py-2.5 text-[14px] font-medium transition-colors duration-200',
                  formaEstorno === opcao.valor
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line hover:bg-sunken',
                )}
              >
                {opcao.rotulo}
              </button>
            ))}
          </div>
        </div>
      </Cartao>

      <AutorizacaoGerenteDevolucao
        autorizacao={autorizacao}
        aoAutenticar={setAutorizacao}
        aoSair={() => setAutorizacao(null)}
      />

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Botao
          variante="primario"
          tamanho="grande"
          disabled={!podeConfirmar || enviando}
          onClick={() => void confirmar()}
        >
          {enviando ? 'Registrando…' : 'Confirmar devolução'}
        </Botao>
      </div>
    </>
  );
}

function LinhaItem({
  item,
  quantidadeMarcada,
  aoMudar,
}: {
  item: ItemDisponivelParaDevolucao;
  quantidadeMarcada: number;
  aoMudar: (delta: number) => void;
}) {
  const disponivel = quantidadeDisponivel(item);

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-ink">{item.descricao}</p>
        <p className="num text-[12px] text-ink-faint">
          {item.sku} · vendido {item.quantidadeVendida}
          {item.quantidadeJaDevolvida > 0 && <> · já devolvido {item.quantidadeJaDevolvida}</>} ·
          disponível {disponivel}
        </p>
      </div>

      {disponivel === 0 ? (
        <Selo tom="neutro">Tudo devolvido</Selo>
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => aoMudar(-1)}
            disabled={quantidadeMarcada === 0}
            aria-label={`Diminuir quantidade de ${item.descricao}`}
            className="h-8 w-8 rounded-[8px] bg-sunken text-[16px] text-ink-soft transition-colors hover:bg-line hover:text-ink disabled:opacity-40"
          >
            −
          </button>
          <span className="num w-7 text-center text-[15px] font-medium">{quantidadeMarcada}</span>
          <button
            type="button"
            onClick={() => aoMudar(1)}
            disabled={quantidadeMarcada >= disponivel}
            aria-label={`Aumentar quantidade de ${item.descricao}`}
            className="h-8 w-8 rounded-[8px] bg-sunken text-[16px] text-ink-soft transition-colors hover:bg-line hover:text-ink disabled:opacity-40"
          >
            +
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Idêntica em espírito ao componente de `TelaMovimentoCaixa`: a operadora
 * continua logada, a gerente só prova identidade para esta operação
 * (`entrarSemTrocarSessao`).
 */
function AutorizacaoGerenteDevolucao({
  autorizacao,
  aoAutenticar,
  aoSair,
}: {
  autorizacao: AutorizacaoGerente | null;
  aoAutenticar: (autorizacao: AutorizacaoGerente) => void;
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
      const { operador, tokenAutorizacao } = await clienteApi.entrarSemTrocarSessao(
        login.trim(),
        senha,
      );
      if (!ehPapelAutorizador(operador.papel)) {
        setErro(`${operador.nome} não tem perfil de gerente e não pode autorizar.`);
        return;
      }
      aoAutenticar({ operador, tokenAutorizacao });
      setLogin('');
      setSenha('');
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível autenticar.');
    } finally {
      setVerificando(false);
    }
  }

  if (autorizacao) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[8px] border border-ok/30 bg-ok/5 px-4 py-3">
        <Selo tom="ok">Autorizado</Selo>
        <span className="flex-1 text-[14px] text-ink">{autorizacao.operador.nome}</span>
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
        Devolução mexe em dinheiro fora do fluxo normal de venda — sempre com gerente identificada,
        sem exceção por valor pequeno.
      </p>

      <form onSubmit={(evento) => void autenticar(evento)} className="mt-4 flex flex-wrap gap-3">
        <div className="min-w-[10rem] flex-1">
          <Campo
            rotulo="Login do gerente"
            name="gerente-login"
            autoComplete="off"
            value={login}
            onChange={(evento) => setLogin(evento.target.value)}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Campo
            rotulo="Senha do gerente"
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
