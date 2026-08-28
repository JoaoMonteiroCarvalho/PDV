/**
 * Devolução de item, com quantidade parcial.
 *
 * Fluxo: operador digita o NÚMERO da venda (o que está impresso no
 * comprovante, não o UUID interno) → escolhe quais itens e quantas unidades
 * devolver → confirma com login/senha de um GERENTE, sem alçada de valor —
 * mesma disciplina de sangria/suprimento.
 *
 * A venda original nunca é alterada: o servidor cria um documento novo
 * (Cancelamento) e o banco impede fisicamente qualquer UPDATE na Venda.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { clienteApi, ErroApi, type ItemDisponivelParaDevolucao } from '../api/cliente.js';

type FormaEstorno = 'DINHEIRO' | 'PIX' | 'CARTAO' | 'VALE_TROCA';

const NOME_DA_FORMA: Record<FormaEstorno, string> = {
  DINHEIRO: 'Dinheiro (sai da gaveta agora)',
  PIX: 'PIX (sai da gaveta agora)',
  CARTAO: 'Cartão (estornar na maquininha)',
  VALE_TROCA: 'Vale-troca (crédito futuro)',
};

interface Props {
  readonly aoVoltar: () => void;
}

export function TelaDevolucao({ aoVoltar }: Props) {
  const [venda, setVenda] = useState<{ id: string; numero: number; totalCentavos: number } | null>(null);

  return (
    <div className="tela-caixa">
      <div className="cartao-caixa cartao-caixa-largo">
        <div className="cabecalho-devolucao">
          <h1>Devolução</h1>
          <button onClick={aoVoltar}>Voltar</button>
        </div>

        {!venda ? (
          <BuscaVenda aoEncontrar={setVenda} />
        ) : (
          <FormularioDevolucao venda={venda} aoConcluir={aoVoltar} aoCancelar={() => setVenda(null)} />
        )}
      </div>
    </div>
  );
}

function BuscaVenda({
  aoEncontrar,
}: {
  aoEncontrar: (venda: { id: string; numero: number; totalCentavos: number }) => void;
}) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  /**
   * Aceita o número sequencial ("42") ou o código curto do UUID ("ABC12345")
   * impresso no comprovante. O número só existe depois que a venda
   * sincroniza com o servidor; enquanto está na fila offline, só o código
   * está disponível — por isso os dois caminhos precisam funcionar.
   */
  async function buscar() {
    setErro(null);
    const valor = texto.trim();
    const ehCodigoHex = /^[0-9a-fA-F]{8}$/.test(valor);
    const numeroInteiro = Number.parseInt(valor, 10);
    const ehNumero = /^\d+$/.test(valor) && numeroInteiro > 0;

    if (!ehCodigoHex && !ehNumero) {
      setErro('Digite o número da venda ou o código de 8 caracteres impresso no comprovante.');
      return;
    }

    setBuscando(true);
    try {
      const venda = ehNumero
        ? await clienteApi.buscarVendaPorNumero(numeroInteiro)
        : await clienteApi.buscarVendaPorCodigo(valor);
      aoEncontrar(venda);
    } catch (falha) {
      if (falha instanceof ErroApi && falha.status === 404) {
        setErro('Nenhuma venda encontrada com esse identificador.');
      } else if (falha instanceof ErroApi && falha.status === 409) {
        setErro(falha.message);
      } else {
        setErro('Não foi possível buscar a venda.');
      }
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="busca-venda">
      <label>
        Número ou código da venda (impresso no comprovante)
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: 42 ou ABC12345"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void buscar()}
        />
      </label>
      {erro && <p className="erro">{erro}</p>}
      <button className="acao-principal" disabled={buscando || !texto} onClick={() => void buscar()}>
        {buscando ? 'Buscando…' : 'Buscar venda'}
      </button>
    </div>
  );
}

function FormularioDevolucao({
  venda,
  aoConcluir,
  aoCancelar,
}: {
  venda: { id: string; numero: number; totalCentavos: number };
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const [itens, setItens] = useState<ItemDisponivelParaDevolucao[] | null>(null);
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState('');
  const [formaEstorno, setFormaEstorno] = useState<FormaEstorno>('DINHEIRO');
  const [loginGerente, setLoginGerente] = useState('');
  const [senhaGerente, setSenhaGerente] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ totalCentavos: number } | null>(null);

  useEffect(() => {
    void clienteApi.buscarDisponivelParaDevolucao(venda.id).then((disponivel) => setItens(disponivel.itens));
  }, [venda.id]);

  function alterarQuantidade(itemVendaId: string, valor: number, maximo: number) {
    const limitado = Math.max(0, Math.min(valor, maximo));
    setQuantidades((atual) => ({ ...atual, [itemVendaId]: limitado }));
  }

  const itensSelecionados = Object.entries(quantidades).filter(([, quantidade]) => quantidade > 0);
  const totalEstimado = itensSelecionados.reduce((total, [itemVendaId, quantidade]) => {
    const item = itens?.find((i) => i.itemVendaId === itemVendaId);
    return total + (item ? item.precoUnitarioLiquidoCentavos * quantidade : 0);
  }, 0);

  async function confirmar() {
    setErro(null);
    if (itensSelecionados.length === 0) {
      setErro('Selecione ao menos um item para devolver.');
      return;
    }
    if (motivo.trim().length < 3) {
      setErro('Descreva o motivo da devolução.');
      return;
    }

    setEnviando(true);
    try {
      const { operador } = await clienteApi.entrarSemTrocarSessao(loginGerente, senhaGerente);
      const resposta = await clienteApi.registrarDevolucao(venda.id, {
        motivo,
        formaEstorno,
        itens: itensSelecionados.map(([itemVendaId, quantidade]) => ({ itemVendaId, quantidade })),
        autorizadoPorId: operador.id,
      });
      setResultado(resposta);
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível concluir a devolução.');
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <div className="resultado-devolucao">
        <p className="sucesso">
          Devolução de {formatarBRL(centavos(resultado.totalCentavos))} registrada com sucesso.
        </p>
        <button className="acao-principal" onClick={aoConcluir}>
          Ok
        </button>
      </div>
    );
  }

  return (
    <div className="formulario-devolucao">
      <p className="ajuda">
        Venda #{venda.numero} — total original {formatarBRL(centavos(venda.totalCentavos))}
      </p>

      {!itens ? (
        <p>Carregando itens…</p>
      ) : (
        <ul className="itens-devolucao">
          {itens.map((item) => {
            const disponivel = item.quantidadeVendida - item.quantidadeJaDevolvida;
            return (
              <li key={item.itemVendaId}>
                <div className="descricao">
                  <strong>{item.descricao}</strong>
                  <span>
                    {item.sku} · vendido {item.quantidadeVendida} · já devolvido {item.quantidadeJaDevolvida} ·
                    disponível {disponivel}
                  </span>
                </div>
                <div className="quantidade">
                  <button
                    disabled={disponivel === 0}
                    onClick={() =>
                      alterarQuantidade(item.itemVendaId, (quantidades[item.itemVendaId] ?? 0) - 1, disponivel)
                    }
                  >
                    −
                  </button>
                  <span>{quantidades[item.itemVendaId] ?? 0}</span>
                  <button
                    disabled={disponivel === 0}
                    onClick={() =>
                      alterarQuantidade(item.itemVendaId, (quantidades[item.itemVendaId] ?? 0) + 1, disponivel)
                    }
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {itensSelecionados.length > 0 && (
        <p className="total-devolucao">Total a devolver: {formatarBRL(centavos(totalEstimado))}</p>
      )}

      <label>
        Motivo
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: peça com defeito" />
      </label>

      <label>
        Forma de estorno
        <select value={formaEstorno} onChange={(e) => setFormaEstorno(e.target.value as FormaEstorno)}>
          {Object.entries(NOME_DA_FORMA).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
      </label>

      <p className="ajuda">Devolução exige identificação do gerente — sem exceção de valor.</p>
      <label>
        Login do gerente
        <input value={loginGerente} onChange={(e) => setLoginGerente(e.target.value)} />
      </label>
      <label>
        Senha do gerente
        <input type="password" value={senhaGerente} onChange={(e) => setSenhaGerente(e.target.value)} />
      </label>

      {erro && <p className="erro">{erro}</p>}

      <div className="acoes-formulario">
        <button onClick={aoCancelar}>Cancelar</button>
        <button
          className="acao-perigo"
          disabled={enviando || !loginGerente || !senhaGerente}
          onClick={() => void confirmar()}
        >
          {enviando ? 'Confirmando…' : 'Confirmar devolução'}
        </button>
      </div>
    </div>
  );
}
