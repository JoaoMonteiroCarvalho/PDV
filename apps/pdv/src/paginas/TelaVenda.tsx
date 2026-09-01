/**
 * Tela de venda — onde a loja passa o dia.
 *
 * Layout de duas colunas fixas: busca e resultados à esquerda, carrinho à
 * direita. O carrinho nunca some, nunca precisa ser aberto.
 *
 * SEM 3D aqui, deliberadamente. Esta é a tela de maior movimento do sistema, e
 * cada frame gasto girando um modelo é frame que não está respondendo ao
 * clique da operadora. O 3D vive no login, na consulta de produto e na
 * confirmação da venda.
 *
 * A busca aceita código bipado. O leitor da loja funciona como teclado: digita
 * o código e manda Enter. Sem esse caminho, o equipamento que a loja já tem
 * fica inútil.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bancoLocal, type ItemCatalogo } from '../banco/local.js';
import { buscarProdutos } from '../catalogo/sincronizacao.js';
import { agruparPorProduto } from '../catalogo/grade.js';
import { Botao, Campo, Erro, Selo } from '../componentes/base.js';
import { CardProduto, LegendaGrade } from '../venda/CardProduto.js';
import { PainelCarrinho } from '../venda/PainelCarrinho.js';
import { ModalFinalizacao, type PlanoCrediario } from '../venda/ModalFinalizacao.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { useCaixa } from '../estado/caixaStore.js';
import { useSessao } from '../estado/sessaoStore.js';
import { fecharVenda } from '../venda/carrinho.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';

/**
 * Espera antes de buscar. 180 ms é curto o bastante para parecer instantâneo
 * digitando e longo o bastante para não disparar uma consulta por tecla em
 * cima de 10 mil registros.
 */
const ESPERA_BUSCA_MS = 180;

export function TelaVenda() {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ItemCatalogo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [finalizando, setFinalizando] = useState(false);

  const campoBusca = useRef<HTMLInputElement>(null);
  const adicionarItem = useCarrinho((estado) => estado.adicionarItem);
  const limparVenda = useCarrinho((estado) => estado.limparVenda);
  const registrarSucesso = useCarrinho((estado) => estado.registrarSucesso);
  const carrinho = useCarrinho((estado) => estado.carrinho);
  const sessao = useCaixa((estado) => estado.sessao);
  const operadora = useSessao((estado) => estado.operadora);
  const navegar = useNavigate();

  // O foco começa na busca: a operadora bipa o primeiro item sem clicar.
  useEffect(() => {
    campoBusca.current?.focus();
  }, []);

  useEffect(() => {
    const consulta = termo.trim();
    if (consulta.length === 0) {
      setResultados([]);
      setErroBusca(null);
      return;
    }

    let cancelado = false;
    setBuscando(true);
    const temporizador = setTimeout(async () => {
      try {
        const encontrados = await buscarProdutos(bancoLocal, consulta, 60);
        if (!cancelado) {
          setResultados(encontrados);
          setErroBusca(null);
        }
      } catch (falha) {
        if (!cancelado) {
          setErroBusca(
            falha instanceof Error ? falha.message : 'Não foi possível buscar no catálogo local.',
          );
        }
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, ESPERA_BUSCA_MS);

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [termo]);

  const produtos = useMemo(() => agruparPorProduto(resultados), [resultados]);

  const adicionarELimparBusca = useCallback(
    (variante: ItemCatalogo) => {
      adicionarItem(variante);
      // Limpa e devolve o foco: a operadora bipa a próxima peça sem tocar no
      // mouse, mesmo tendo clicado na grade para escolher a variação.
      setTermo('');
      campoBusca.current?.focus();
    },
    [adicionarItem],
  );

  /**
   * Enter na busca com um único resultado adiciona direto.
   *
   * É o caminho do leitor de código de barras: bipar devolve exatamente um
   * item, e o scanner manda Enter no fim. Com vários resultados não adivinha
   * nada — mostra a grade e deixa a operadora escolher.
   *
   * A busca é REFEITA aqui em vez de usar `resultados`. O leitor digita o
   * código inteiro em poucos milissegundos e manda Enter na sequência, quase
   * sempre antes de o debounce de 180 ms disparar — usar o estado deixaria a
   * bipada cair no vazio, que é o modo mais fácil de tornar o scanner inútil.
   */
  async function aoSubmeterBusca(evento: React.FormEvent) {
    evento.preventDefault();
    const consulta = termo.trim();
    if (consulta.length === 0) return;

    try {
      const encontrados = await buscarProdutos(bancoLocal, consulta, 60);
      if (encontrados.length === 1) {
        adicionarELimparBusca(encontrados[0]!);
        return;
      }
      // Vários (ou nenhum): mostra o que achou e deixa a operadora decidir.
      setResultados(encontrados);
      setErroBusca(null);
    } catch (falha) {
      setErroBusca(
        falha instanceof Error ? falha.message : 'Não foi possível buscar no catálogo local.',
      );
    }
  }

  async function confirmarVenda(
    pagamentos: Parameters<typeof fecharVenda>[1]['pagamentos'],
    crediario: PlanoCrediario | null,
  ) {
    if (!sessao) {
      throw new Error('Caixa fechado. Abra o caixa antes de registrar a venda.');
    }

    /*
     * `fecharVenda` valida os pagamentos com a MESMA função do servidor antes
     * de devolver. Uma venda que o servidor recusaria não pode entrar na fila:
     * viraria pendência bloqueada com a cliente já fora da loja.
     */
    const fechada = fecharVenda(carrinho, {
      sessaoCaixaId: sessao.id,
      pagamentos,
      // Fiado precisa da cliente: `validarPagamentos` recusa sem ela, aqui
      // mesmo, antes de a venda entrar na fila.
      clienteId: crediario?.clienteId,
      crediario: crediario
        ? {
            quantidadeParcelas: crediario.quantidadeParcelas,
            primeiroVencimento: crediario.primeiroVencimento,
          }
        : undefined,
    });

    // Grava na fila local ANTES de qualquer rede. A venda aconteceu no mundo
    // real; o servidor fica sabendo quando der.
    await motorSincronizacao.registrarVenda({
      id: fechada.id,
      corpo: fechada.corpo,
      totalCentavos: fechada.calculo.totalCentavos,
    });

    /*
     * Captura o comprovante ANTES de limpar o carrinho: a tela de conclusão
     * mostra e reimprime a venda sem consultar nada, inclusive offline.
     */
    registrarSucesso({
      calculo: fechada.calculo,
      dados: {
        numero: null,
        vendaId: fechada.id,
        momento: new Date(),
        operador: operadora?.nome ?? 'Operadora',
        itens: carrinho.itens.map((item, indice) => ({
          descricao: item.nome,
          categoria: item.categoria,
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
      },
    });

    limparVenda();
    setFinalizando(false);
    navegar('/venda/concluida');
  }

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line bg-surface px-6 py-4">
          <form onSubmit={(evento) => void aoSubmeterBusca(evento)}>
            <Campo
              ref={campoBusca}
              rotulo="Buscar produto ou bipar código"
              placeholder="nome, marca, cor, SKU ou código de barras"
              value={termo}
              onChange={(evento) => setTermo(evento.target.value)}
              autoComplete="off"
              className="h-14 text-[17px]"
            />
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {erroBusca && <Erro>{erroBusca}</Erro>}

          {!erroBusca && termo.trim().length === 0 && <Vazio />}

          {!erroBusca && termo.trim().length > 0 && produtos.length === 0 && !buscando && (
            <p className="py-10 text-center text-[14px] text-ink-faint">
              Nada encontrado para “{termo.trim()}”. A busca usa o catálogo baixado neste caixa —
              se o produto é novo, pode ainda não ter sincronizado.
            </p>
          )}

          {produtos.length > 0 && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <LegendaGrade />
                <Selo tom="neutro">
                  {produtos.length} {produtos.length === 1 ? 'produto' : 'produtos'}
                </Selo>
              </div>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
                {produtos.map((produto) => (
                  <CardProduto
                    key={produto.produtoId}
                    produto={produto}
                    aoAdicionar={adicionarELimparBusca}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <PainelCarrinho aoFinalizar={() => setFinalizando(true)} />

      {finalizando && (
        <ModalFinalizacao
          aoFechar={() => setFinalizando(false)}
          aoConfirmar={confirmarVenda}
        />
      )}
    </div>
  );
}

function Vazio() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="max-w-[380px]">
        <p className="font-titulo text-[17px] text-ink-soft">Pronto para vender</p>
        <p className="mt-2 text-[14px] text-ink-faint">
          Bipe o código de barras ou digite o nome da peça. A grade de tamanho e cor aparece no
          próprio resultado — não precisa abrir cada variação.
        </p>
      </div>
    </div>
  );
}
