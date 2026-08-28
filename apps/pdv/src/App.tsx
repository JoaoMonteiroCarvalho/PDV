import { centavos, deReais, formatarBRL, type PagamentoEntrada } from '@pdv/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clienteApi, type Operador, type SessaoCaixaAberta } from './api/cliente.js';
import { TelaCaixa } from './caixa/TelaCaixa.js';
import { TelaDevolucao } from './devolucao/TelaDevolucao.js';
import { bancoLocal, type ItemCatalogo } from './banco/local.js';
import { buscarProdutos } from './catalogo/sincronizacao.js';
import { imprimirComprovante } from './impressao/imprimir.js';
import { MotorSincronizacao, type EstadoSincronizacao } from './sincronizacao/motor.js';
import {
  CARRINHO_VAZIO,
  adicionar,
  alterarQuantidade,
  calcular,
  calcularTroco,
  definirDescontoDoTotal,
  fecharVenda,
  remover,
  saldoAPagar,
  totalDePecas,
  type EstadoCarrinho,
} from './venda/carrinho.js';

const motor = new MotorSincronizacao(bancoLocal, clienteApi);

const LOJA = { nome: 'LOJA — MODA ÍNTIMA', telefone: '(00) 0000-0000' };

export function App() {
  const [operador, setOperador] = useState<Operador | null>(() => clienteApi.operadorSalvo());
  const [sessaoCaixa, setSessaoCaixa] = useState<SessaoCaixaAberta | null>(null);
  // Distingue "acabei de entrar, pule pra venda se já houver sessão" de
  // "cliquei em Caixa de propósito, quero ver a tela de gestão". Sem isso,
  // TelaCaixa detectaria a sessão existente e pularia de volta pra venda no
  // mesmo instante da montagem — o botão "Caixa" nunca abriria nada.
  const [navegandoParaCaixa, setNavegandoParaCaixa] = useState(false);

  if (!operador || !clienteApi.temToken()) {
    return <TelaLogin aoEntrar={setOperador} />;
  }

  if (!sessaoCaixa || navegandoParaCaixa) {
    return (
      <TelaCaixa
        permanecerSeAberta={navegandoParaCaixa}
        onSessaoPronta={(sessao) => {
          setSessaoCaixa(sessao);
          setNavegandoParaCaixa(false);
        }}
      />
    );
  }

  return (
    <TelaVenda
      operador={operador}
      sessaoCaixaId={sessaoCaixa.id}
      aoSair={() => {
        clienteApi.sair();
        setOperador(null);
        setSessaoCaixa(null);
      }}
      aoIrParaCaixa={() => setNavegandoParaCaixa(true)}
    />
  );
}

// ---------------------------------------------------------------------------

function TelaLogin({ aoEntrar }: { aoEntrar: (operador: Operador) => void }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEntrando(true);
    try {
      const { operador } = await clienteApi.entrar(login, senha);
      aoEntrar(operador);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível entrar.');
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="tela-login">
      <form className="cartao-login" onSubmit={submeter}>
        <h1>PDV — Caixa</h1>
        <p className="subtitulo">Identifique-se para abrir o caixa</p>

        <label>
          Operador
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus autoComplete="username" />
        </label>
        <label>
          Senha
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        </label>

        {erro && <p className="erro">{erro}</p>}

        <button type="submit" disabled={entrando || !login || !senha}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TelaVenda({
  operador,
  sessaoCaixaId,
  aoSair,
  aoIrParaCaixa,
}: {
  operador: Operador;
  sessaoCaixaId: string;
  aoSair: () => void;
  aoIrParaCaixa: () => void;
}) {
  const [carrinho, setCarrinho] = useState<EstadoCarrinho>(CARRINHO_VAZIO);
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ItemCatalogo[]>([]);
  const [pagamentos, setPagamentos] = useState<PagamentoEntrada[]>([]);
  const [estadoSync, setEstadoSync] = useState<EstadoSincronizacao | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarDevolucao, setMostrarDevolucao] = useState(false);

  useEffect(() => {
    motor.iniciar();
    const cancelar = motor.aoMudar(setEstadoSync);
    return () => {
      cancelar();
      motor.parar();
    };
  }, []);

  // Busca a cada tecla, contra o IndexedDB — sem rede no caminho.
  useEffect(() => {
    let cancelado = false;
    if (termo.trim().length < 2) {
      setResultados([]);
      return;
    }
    void buscarProdutos(bancoLocal, termo).then((encontrados) => {
      if (!cancelado) setResultados(encontrados);
    });
    return () => {
      cancelado = true;
    };
  }, [termo]);

  const venda = useMemo(() => {
    try {
      return carrinho.itens.length > 0 ? calcular(carrinho) : null;
    } catch {
      return null;
    }
  }, [carrinho]);

  const saldo = venda ? saldoAPagar(venda, pagamentos) : centavos(0);
  const troco = venda ? calcularTroco(venda, pagamentos) : centavos(0);

  const adicionarProduto = useCallback((produto: ItemCatalogo) => {
    setCarrinho((atual) => adicionar(atual, produto));
    setTermo('');
    setResultados([]);
  }, []);

  function limparVenda() {
    setCarrinho(CARRINHO_VAZIO);
    setPagamentos([]);
    setErro(null);
  }

  async function finalizar() {
    setErro(null);
    if (!venda) return;

    try {
      // Fecha e valida ANTES de imprimir: comprovante na mão da cliente com
      // venda inválida é o pior desfecho possível.
      const fechada = fecharVenda(carrinho, {
        sessaoCaixaId,
        pagamentos,
      });

      // Grava local primeiro. A venda existe mesmo que a rede nunca volte.
      await motor.registrarVenda({
        id: fechada.id,
        corpo: fechada.corpo,
        totalCentavos: fechada.calculo.totalCentavos,
      });

      imprimirComprovante(fechada.calculo, {
        numero: null,
        vendaId: fechada.id,
        momento: new Date(),
        operador: operador.nome,
        itens: carrinho.itens.map((item, indice) => ({
          descricao: item.nome,
          tamanho: item.tamanho,
          cor: item.cor,
          quantidade: item.quantidade,
          precoUnitarioCentavos: item.precoUnitarioCentavos,
          totalCentavos: fechada.calculo.itens[indice]!.totalCentavos,
        })),
        pagamentos: pagamentos.map((pagamento) => ({
          forma: pagamento.forma,
          valorCentavos: pagamento.valorCentavos,
          trocoCentavos: pagamento.trocoCentavos,
        })),
      }, LOJA);

      setMensagem(`Venda de ${formatarBRL(fechada.calculo.totalCentavos)} finalizada.`);
      setTimeout(() => setMensagem(null), 4000);
      limparVenda();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível finalizar a venda.');
    }
  }

  if (mostrarDevolucao) {
    return <TelaDevolucao aoVoltar={() => setMostrarDevolucao(false)} />;
  }

  return (
    <div className="tela-venda">
      <BarraStatus
        estado={estadoSync}
        operador={operador}
        aoSair={aoSair}
        aoIrParaCaixa={aoIrParaCaixa}
        aoIrParaDevolucao={() => setMostrarDevolucao(true)}
      />

      <main className="corpo">
        <section className="painel-busca">
          <input
            className="campo-busca"
            placeholder="Bipe o código de barras ou digite o produto…"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            autoFocus
          />

          <ul className="resultados">
            {resultados.map((produto) => (
              <li key={produto.id}>
                <button onClick={() => adicionarProduto(produto)}>
                  <span className="nome">{produto.nome}</span>
                  <span className="variacao">
                    {[produto.tamanho, produto.cor].filter(Boolean).join(' · ')}
                  </span>
                  <span className="preco">{formatarBRL(centavos(produto.precoCentavos))}</span>
                </button>
              </li>
            ))}
            {termo.trim().length >= 2 && resultados.length === 0 && (
              <li className="vazio">Nenhum produto encontrado.</li>
            )}
          </ul>
        </section>

        <section className="painel-carrinho">
          <h2>Venda atual <small>{totalDePecas(carrinho)} peça(s)</small></h2>

          {carrinho.itens.length === 0 ? (
            <p className="vazio">Nenhum item. Bipe ou busque um produto para começar.</p>
          ) : (
            <ul className="itens">
              {carrinho.itens.map((item, indice) => (
                <li key={item.varianteId}>
                  <div className="descricao">
                    <strong>{item.nome}</strong>
                    <span>{[item.tamanho, item.cor].filter(Boolean).join(' · ')} · {item.sku}</span>
                  </div>
                  <div className="quantidade">
                    <button onClick={() => setCarrinho(alterarQuantidade(carrinho, item.varianteId, item.quantidade - 1))}>−</button>
                    <span>{item.quantidade}</span>
                    <button onClick={() => setCarrinho(alterarQuantidade(carrinho, item.varianteId, item.quantidade + 1))}>+</button>
                  </div>
                  <span className="valor">
                    {formatarBRL(venda?.itens[indice]?.totalCentavos ?? centavos(0))}
                  </span>
                  <button className="remover" onClick={() => setCarrinho(remover(carrinho, item.varianteId))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="painel-total">
          {venda && (
            <>
              <div className="linha"><span>Subtotal</span><span>{formatarBRL(venda.subtotalCentavos)}</span></div>
              <div className="linha">
                <span>Desconto</span>
                <CampoValor
                  valor={carrinho.descontoSobreTotalCentavos}
                  aoMudar={(valor) => setCarrinho(definirDescontoDoTotal(carrinho, valor))}
                />
              </div>
              <div className="linha total"><span>Total</span><span>{formatarBRL(venda.totalCentavos)}</span></div>

              <PainelPagamento
                pagamentos={pagamentos}
                saldo={saldo}
                troco={troco}
                aoAdicionar={(pagamento) => setPagamentos([...pagamentos, pagamento])}
                aoLimpar={() => setPagamentos([])}
              />

              {erro && <p className="erro">{erro}</p>}

              <button className="finalizar" disabled={saldo !== 0 || pagamentos.length === 0} onClick={() => void finalizar()}>
                Finalizar e imprimir
              </button>
              <button className="cancelar" onClick={limparVenda}>Cancelar venda</button>
            </>
          )}
          {mensagem && <p className="sucesso">{mensagem}</p>}
        </aside>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BarraStatus({
  estado,
  operador,
  aoSair,
  aoIrParaCaixa,
  aoIrParaDevolucao,
}: {
  estado: EstadoSincronizacao | null;
  operador: Operador;
  aoSair: () => void;
  aoIrParaCaixa: () => void;
  aoIrParaDevolucao: () => void;
}) {
  const online = estado?.online ?? true;
  const pendentes = estado?.pendentes ?? 0;
  const bloqueadas = estado?.bloqueadas ?? 0;

  return (
    <header className="barra-status">
      <span className="marca">PDV</span>

      <span className={`indicador ${online ? 'online' : 'offline'}`}>
        {online ? 'Online' : 'Offline — vendendo normalmente'}
      </span>

      {pendentes > 0 && (
        <span className="indicador pendente">
          {pendentes} venda(s) aguardando sincronização
        </span>
      )}
      {bloqueadas > 0 && (
        <span className="indicador bloqueado">
          {bloqueadas} venda(s) com problema — chame o gerente
        </span>
      )}

      <span className="preenche" />
      <span className="catalogo">{estado?.produtosLocais ?? 0} produtos no caixa</span>
      <span className="operador">{operador.nome}</span>
      <button className="caixa" onClick={aoIrParaCaixa}>Caixa</button>
      <button className="devolucao" onClick={aoIrParaDevolucao}>Devolução</button>
      <button className="sair" onClick={aoSair}>Sair</button>
    </header>
  );
}

/** Campo monetário: digita em reais, guarda em centavos. */
function CampoValor({
  valor,
  aoMudar,
}: {
  valor: number;
  aoMudar: (valor: ReturnType<typeof centavos>) => void;
}) {
  const [texto, setTexto] = useState(formatarBRL(centavos(valor), { simbolo: false }));

  return (
    <input
      className="campo-valor"
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        try {
          aoMudar(deReais(texto || '0'));
        } catch {
          // Entrada inválida volta ao valor anterior em vez de virar NaN.
          setTexto(formatarBRL(centavos(valor), { simbolo: false }));
        }
      }}
    />
  );
}

function PainelPagamento({
  pagamentos,
  saldo,
  troco,
  aoAdicionar,
  aoLimpar,
}: {
  pagamentos: readonly PagamentoEntrada[];
  saldo: number;
  troco: number;
  aoAdicionar: (pagamento: PagamentoEntrada) => void;
  aoLimpar: () => void;
}) {
  const [texto, setTexto] = useState('');

  function lancar(forma: PagamentoEntrada['forma']) {
    try {
      const valor = texto ? deReais(texto) : centavos(Math.max(0, saldo));
      if (valor <= 0) return;
      // Troco só existe em dinheiro; nas outras formas o excedente é recusado
      // pelo domínio, então nem oferecemos.
      const excedente = forma === 'DINHEIRO' ? Math.max(0, valor - Math.max(0, saldo)) : 0;
      aoAdicionar({ forma, valorCentavos: valor, trocoCentavos: centavos(excedente) });
      setTexto('');
    } catch {
      // valor digitado inválido: ignora o lançamento
    }
  }

  return (
    <div className="pagamentos">
      <h3>Pagamento</h3>

      {pagamentos.length > 0 && (
        <ul>
          {pagamentos.map((pagamento, indice) => (
            <li key={indice}>
              <span>{pagamento.forma}</span>
              <span>{formatarBRL(pagamento.valorCentavos)}</span>
            </li>
          ))}
        </ul>
      )}

      <input
        className="campo-valor"
        placeholder={`Falta ${formatarBRL(centavos(Math.max(0, saldo)), { simbolo: false })}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />

      <div className="formas">
        <button onClick={() => lancar('DINHEIRO')}>Dinheiro</button>
        <button onClick={() => lancar('DEBITO')}>Débito</button>
        <button onClick={() => lancar('CREDITO')}>Crédito</button>
        <button onClick={() => lancar('PIX')}>PIX</button>
      </div>

      {troco > 0 && <p className="troco">Troco: {formatarBRL(centavos(troco))}</p>}
      {pagamentos.length > 0 && <button className="limpar" onClick={aoLimpar}>Limpar pagamentos</button>}
    </div>
  );
}
