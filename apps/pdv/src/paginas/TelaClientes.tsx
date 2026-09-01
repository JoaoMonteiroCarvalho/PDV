/**
 * Clientes e fiado.
 *
 * Duas coisas: quem são as clientes com cadastro, e quanto cada uma deve.
 *
 * O crediário é dívida de gente real com a loja, e a tela é organizada em
 * volta disso: o saldo devedor e as parcelas vencidas vêm primeiro, porque é
 * o que a operadora precisa ver quando a cliente chega no balcão querendo
 * levar mais uma peça.
 *
 * Diferente das outras telas, esta depende de REDE. O cadastro de clientes não
 * é replicado no caixa: são dados pessoais, e guardar CPF de toda a base numa
 * réplica local em cada terminal é risco sem contrapartida — consultar fiado é
 * raro comparado a vender.
 */

import { formatarBRL, centavos, cpfValido, formatarCpf, mascararCpf } from '@pdv/shared';
import { useCallback, useEffect, useState } from 'react';
import { clienteApi, type ClienteDetalhe, type ClienteResumo, type ParcelaEmAberto } from '../api/cliente.js';
import { Botao, Campo, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import { CampoDinheiro } from '../componentes/CampoDinheiro.js';
import { useCaixa } from '../estado/caixaStore.js';

export function TelaClientes() {
  const [busca, setBusca] = useState('');
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [cadastrando, setCadastrando] = useState(false);

  const recarregar = useCallback(async (consulta: string) => {
    setCarregando(true);
    try {
      setClientes(await clienteApi.buscarClientes(consulta));
      setErro(null);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível buscar as clientes.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const temporizador = setTimeout(() => void recarregar(busca), 200);
    return () => clearTimeout(temporizador);
  }, [busca, recarregar]);

  if (selecionada) {
    return (
      <FichaDaCliente
        clienteId={selecionada}
        aoVoltar={() => {
          setSelecionada(null);
          void recarregar(busca);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-[24px]">Clientes</h1>
          <p className="mt-1 text-[13px] text-ink-faint">
            Cadastro e fiado. Toque numa cliente para ver o que ela deve.
          </p>
        </div>
        <Botao variante="primario" onClick={() => setCadastrando(true)}>
          Cadastrar cliente
        </Botao>
      </div>

      <div className="mt-5 max-w-md">
        <Campo
          rotulo="Buscar"
          placeholder="nome ou CPF"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          autoComplete="off"
        />
      </div>

      {erro && (
        <div className="mt-5">
          <Erro aoTentarNovamente={() => void recarregar(busca)}>{erro}</Erro>
        </div>
      )}

      {!erro && clientes.length === 0 && !carregando && (
        <p className="py-14 text-center text-[14px] text-ink-faint">
          {busca.trim() ? `Nenhuma cliente para “${busca.trim()}”.` : 'Nenhuma cliente cadastrada ainda.'}
        </p>
      )}

      {clientes.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-card border border-line">
          {clientes.map((cliente) => (
            <li key={cliente.id}>
              <button
                type="button"
                onClick={() => setSelecionada(cliente.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-ink">{cliente.nome}</p>
                  <p className="num truncate text-[12px] text-ink-faint">
                    {cliente.cpf ? formatarCpf(cliente.cpf) : 'sem CPF'}
                    {cliente.telefone && ` · ${cliente.telefone}`}
                  </p>
                </div>
                {cliente.limiteCrediarioCentavos > 0 ? (
                  <Selo tom="accent">
                    limite {formatarBRL(centavos(cliente.limiteCrediarioCentavos))}
                  </Selo>
                ) : (
                  <Selo tom="neutro">sem fiado</Selo>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {cadastrando && (
        <ModalCadastro
          aoFechar={() => setCadastrando(false)}
          aoCriar={(cliente) => {
            setCadastrando(false);
            setSelecionada(cliente.id);
          }}
        />
      )}
    </div>
  );
}

/**
 * Cadastro.
 *
 * O CPF é OPCIONAL: a loja atende quem não quer informar, e exigi-lo perderia
 * venda. Mas se for informado, tem que ser válido — é ele que liga a dívida a
 * uma pessoa, e um CPF errado é fiado que a loja não consegue cobrar.
 */
function ModalCadastro({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  aoCriar: (cliente: ClienteResumo) => void;
}) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [limite, setLimite] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cpfInformado = cpf.trim().length > 0;
  const cpfRuim = cpfInformado && !cpfValido(cpf);
  const podeSalvar = nome.trim().length >= 2 && !cpfRuim;

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const cliente = await clienteApi.criarCliente({
        nome: nome.trim(),
        cpf: cpfInformado ? cpf : undefined,
        telefone: telefone.trim() || undefined,
        limiteCrediarioCentavos: limite,
      });
      aoCriar(cliente);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível cadastrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-cadastro"
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"
      onClick={(evento) => {
        if (evento.target === evento.currentTarget && !enviando) aoFechar();
      }}
    >
      <form
        onSubmit={(evento) => void salvar(evento)}
        className="elevado w-full max-w-[460px] rounded-card border border-line bg-surface p-6"
      >
        <h2 id="titulo-cadastro" className="font-titulo text-[18px] font-medium">
          Cadastrar cliente
        </h2>

        <div className="mt-5 space-y-4">
          <Campo
            rotulo="Nome"
            name="nome"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            autoComplete="off"
          />

          <Campo
            rotulo="CPF (opcional)"
            name="cpf"
            inputMode="numeric"
            value={cpf}
            onChange={(evento) => setCpf(mascararCpf(evento.target.value))}
            erro={cpfRuim ? 'CPF inválido. Confira os números com a cliente.' : undefined}
            numerico
            autoComplete="off"
          />

          <Campo
            rotulo="Telefone (opcional)"
            name="telefone"
            value={telefone}
            onChange={(evento) => setTelefone(evento.target.value)}
            autoComplete="off"
          />

          <CampoDinheiro
            rotulo="Limite de fiado"
            valorCentavos={limite}
            aoMudar={setLimite}
            ajuda="Zero significa que esta cliente não compra fiado."
          />
        </div>

        {erro && (
          <div className="mt-4">
            <Erro>{erro}</Erro>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Botao type="button" variante="discreto" className="flex-1" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao type="submit" variante="primario" className="flex-[2]" disabled={!podeSalvar || enviando}>
            {enviando ? 'Salvando…' : 'Cadastrar'}
          </Botao>
        </div>
      </form>
    </div>
  );
}

function FichaDaCliente({ clienteId, aoVoltar }: { clienteId: string; aoVoltar: () => void }) {
  const [cliente, setCliente] = useState<ClienteDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recebendo, setRecebendo] = useState<ParcelaEmAberto | null>(null);

  const carregar = useCallback(async () => {
    try {
      setCliente(await clienteApi.obterCliente(clienteId));
      setErro(null);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível carregar a ficha.');
    }
  }, [clienteId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Erro aoTentarNovamente={() => void carregar()}>{erro}</Erro>
        <Botao variante="neutro" className="mt-4" onClick={aoVoltar}>
          Voltar
        </Botao>
      </div>
    );
  }

  if (!cliente) {
    return <div className="grid h-full place-items-center text-[14px] text-ink-faint">Carregando…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <button
        type="button"
        onClick={aoVoltar}
        className="text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        ← Clientes
      </button>

      <h1 className="mt-3 font-titulo text-[26px]">{cliente.nome}</h1>
      <p className="num mt-1 text-[13px] text-ink-faint">
        {cliente.cpf ? formatarCpf(cliente.cpf) : 'sem CPF'}
        {cliente.telefone && ` · ${cliente.telefone}`}
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Cartao className="p-4">
          <dt className="text-[13px] text-ink-soft">Deve</dt>
          <dd
            data-testid="saldo-devedor"
            className={cx(
              'num mt-1 font-titulo text-[24px] font-semibold',
              cliente.saldoDevedorCentavos > 0 ? 'text-alerta' : 'text-ok',
            )}
          >
            {formatarBRL(centavos(cliente.saldoDevedorCentavos))}
          </dd>
        </Cartao>
        <Cartao className="p-4">
          <dt className="text-[13px] text-ink-soft">Limite</dt>
          <dd className="num mt-1 font-titulo text-[24px]">
            {formatarBRL(centavos(cliente.limiteCrediarioCentavos))}
          </dd>
        </Cartao>
        <Cartao className="p-4">
          <dt className="text-[13px] text-ink-soft">Pode levar</dt>
          <dd
            data-testid="limite-disponivel"
            className="num mt-1 font-titulo text-[24px] font-semibold"
          >
            {formatarBRL(centavos(cliente.limiteDisponivelCentavos))}
          </dd>
        </Cartao>
      </dl>

      <h2 className="mt-8 font-titulo text-[18px]">Parcelas em aberto</h2>
      {cliente.parcelasEmAberto.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-ink-faint">
          Nada em aberto. Esta cliente não deve nada à loja.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line">
          {cliente.parcelasEmAberto.map((parcela) => (
            <LinhaParcela
              key={parcela.id}
              parcela={parcela}
              aoReceber={() => setRecebendo(parcela)}
            />
          ))}
        </ul>
      )}

      {recebendo && (
        <ModalRecebimento
          parcela={recebendo}
          aoFechar={() => setRecebendo(null)}
          aoReceber={() => {
            setRecebendo(null);
            void carregar();
          }}
        />
      )}
    </div>
  );
}

function LinhaParcela({
  parcela,
  aoReceber,
}: {
  parcela: ParcelaEmAberto;
  aoReceber: () => void;
}) {
  const restante = parcela.valorCentavos - parcela.recebidoCentavos;
  const vencimento = new Date(parcela.vencimento);
  // Comparação por dia: uma parcela que vence hoje não está vencida.
  const hoje = new Date();
  const vencida = vencimento < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-[10rem] flex-1">
        <p className="num text-[14px] text-ink">
          Parcela {parcela.numero}/{parcela.totalParcelas} · venda {parcela.vendaNumero}
        </p>
        <p className="num text-[12px] text-ink-faint">
          vence {vencimento.toLocaleDateString('pt-BR')}
          {parcela.recebidoCentavos > 0 &&
            ` · já pagou ${formatarBRL(centavos(parcela.recebidoCentavos))}`}
        </p>
      </div>

      {vencida && <Selo tom="perigo">vencida</Selo>}

      <span className="num text-[16px] font-medium">{formatarBRL(centavos(restante))}</span>
      <Botao variante="neutro" onClick={aoReceber}>
        Receber
      </Botao>
    </li>
  );
}

/**
 * Recebimento.
 *
 * Aceita valor PARCIAL: a cliente paga metade hoje e metade na semana que vem,
 * e o sistema precisa saber disso. Só "paga ou não paga" obrigaria a operadora
 * a escolher entre mentir e recusar o dinheiro.
 */
function ModalRecebimento({
  parcela,
  aoFechar,
  aoReceber,
}: {
  parcela: ParcelaEmAberto;
  aoFechar: () => void;
  aoReceber: () => void;
}) {
  const sessao = useCaixa((estado) => estado.sessao);
  const restante = parcela.valorCentavos - parcela.recebidoCentavos;

  const [valor, setValor] = useState(restante);
  const [forma, setForma] = useState<'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO'>('DINHEIRO');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const acimaDoRestante = valor > restante;
  const podeReceber = sessao !== null && valor > 0 && !acimaDoRestante;

  async function receber() {
    if (!sessao) return;
    setErro(null);
    setEnviando(true);
    try {
      await clienteApi.receberParcela(parcela.id, {
        sessaoCaixaId: sessao.id,
        valorCentavos: valor,
        forma,
      });
      aoReceber();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível registrar o recebimento.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-receber"
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"
      onClick={(evento) => {
        if (evento.target === evento.currentTarget && !enviando) aoFechar();
      }}
    >
      <div className="elevado w-full max-w-[440px] rounded-card border border-line bg-surface p-6">
        <h2 id="titulo-receber" className="font-titulo text-[18px] font-medium">
          Receber parcela {parcela.numero}/{parcela.totalParcelas}
        </h2>
        <p className="num mt-1 text-[13px] text-ink-faint">
          Faltam {formatarBRL(centavos(restante))}
        </p>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => setForma(opcao)}
              aria-pressed={forma === opcao}
              className={cx(
                'h-11 rounded-[12px] text-[13px] font-medium transition-colors duration-200',
                forma === opcao
                  ? 'bg-accent text-accent-ink'
                  : 'bg-sunken text-ink-soft hover:bg-line hover:text-ink',
              )}
            >
              {opcao === 'DEBITO' ? 'Débito' : opcao === 'CREDITO' ? 'Crédito' : opcao === 'PIX' ? 'Pix' : 'Dinheiro'}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <CampoDinheiro
            rotulo="Valor recebido"
            destaque
            valorCentavos={valor}
            aoMudar={setValor}
            erro={acimaDoRestante ? 'Maior do que falta nesta parcela.' : undefined}
            ajuda={!acimaDoRestante && valor < restante ? 'Pagamento parcial — o resto continua em aberto.' : undefined}
          />
        </div>

        {!sessao && (
          <p className="mt-4 text-[13px] leading-relaxed text-alerta">
            Não há caixa aberto. O dinheiro do fiado entra na gaveta e precisa bater no fechamento,
            então o recebimento só acontece com o caixa aberto.
          </p>
        )}

        {erro && (
          <div className="mt-4">
            <Erro>{erro}</Erro>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Botao variante="discreto" className="flex-1" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            className="flex-[2]"
            disabled={!podeReceber || enviando}
            onClick={() => void receber()}
          >
            {enviando ? 'Registrando…' : 'Registrar recebimento'}
          </Botao>
        </div>
      </div>
    </div>
  );
}
