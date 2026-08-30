import { formatarBRL, centavos } from '@pdv/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useCatalogoLocal, useSincronizacaoCatalogo } from '@/banco-local/sincronizacaoCatalogo.js';
import type { ItemCatalogoLocal } from '@/banco-local/db.js';
import { interpretarEntradaCodigo } from '@/dominio/codigoBarras.js';
import { useSessao } from '@/estado/useSessao.js';
import { totalCarrinhoCentavos, totalDePecas, useCarrinho } from '@/estado/useCarrinho.js';
import { useSessaoCaixaAberta } from '@/servicos/caixa.js';
import type { DadosComprovante } from '@/servicos/impressao.js';
import { ModalCliente } from './ModalCliente.js';
import { ModalFinalizarVenda, type ResultadoFinalizacao } from './ModalFinalizarVenda.js';
import { PainelBuscaPorNome } from './PainelBuscaPorNome.js';
import { TelaVendaConcluida } from './TelaVendaConcluida.js';

/**
 * Tela de venda. Da Fase 3 em diante, F9 abre o pagamento múltiplo de
 * verdade e a venda é registrada contra a API real.
 *
 * O campo de código NUNCA perde o foco por conta própria: toda ação
 * (adicionar item, fechar busca, cancelar) devolve o foco pra ele — é o
 * que permite o operador trabalhar com scanner USB sem tocar em nada.
 */
export function TelaVenda() {
  const operador = useSessao((estado) => estado.operador);
  const terminalId = useSessao((estado) => estado.terminalId);
  const { data: sessaoCaixa } = useSessaoCaixaAberta(terminalId);

  // Sincroniza o catálogo do servidor pro Dexie enquanto o caixa está
  // aberto; a busca/leitura abaixo é sempre do IndexedDB, nunca da API
  // diretamente — é isso que permite continuar vendendo sem rede.
  useSincronizacaoCatalogo(!!sessaoCaixa);
  const catalogo: ItemCatalogoLocal[] = useCatalogoLocal();
  const itens = useCarrinho((estado) => estado.itens);
  const adicionar = useCarrinho((estado) => estado.adicionar);
  const removerUltimo = useCarrinho((estado) => estado.removerUltimo);
  const limpar = useCarrinho((estado) => estado.limpar);
  const alterarQuantidade = useCarrinho((estado) => estado.alterarQuantidade);
  const cliente = useCarrinho((estado) => estado.cliente);
  const desvincularCliente = useCarrinho((estado) => estado.desvincularCliente);
  const vincularCliente = useCarrinho((estado) => estado.vincularCliente);

  const [textoCodigo, setTextoCodigo] = useState('');
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [vinculandoCliente, setVinculandoCliente] = useState(false);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const [editandoQuantidade, setEditandoQuantidade] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [finalizando, setFinalizando] = useState(false);
  const [vendaConcluida, setVendaConcluida] = useState<DadosComprovante | null>(null);

  const refCampoCodigo = useRef<HTMLInputElement>(null);
  const refCampoQuantidade = useRef<HTMLInputElement>(null);

  function focarCampoCodigo() {
    // Sem o timeout, o foco às vezes perde a corrida com o fechamento do
    // painel que estava sobreposto (busca, confirmação) no mesmo ciclo.
    setTimeout(() => refCampoCodigo.current?.focus(), 0);
  }

  useEffect(() => {
    focarCampoCodigo();
  }, []);

  function localizarPorCodigo(codigo: string): ItemCatalogoLocal | undefined {
    return catalogo.find((item) => item.codigoBarras === codigo || item.sku === codigo);
  }

  function processarCodigo() {
    const bruto = textoCodigo.trim();
    if (!bruto) return;
    setErroCodigo(null);

    const interpretado = interpretarEntradaCodigo(bruto);

    if (interpretado.tipo === 'balanca') {
      // O catálogo desta loja não tem produto vendido por peso — mostrar
      // isto como se tivesse achado um preço seria inventar dado que a
      // API não tem. Erro honesto em vez de cálculo fantasma.
      setErroCodigo(
        `Código de balança lido (produto ${interpretado.codigoProduto}, ${(interpretado.pesoGramas / 1000).toFixed(3)} kg), mas esta loja não vende produto por peso.`,
      );
      setTextoCodigo('');
      focarCampoCodigo();
      return;
    }

    const produto = localizarPorCodigo(interpretado.codigo);
    if (!produto) {
      setErroCodigo(`Nenhum produto encontrado para o código "${interpretado.codigo}".`);
      setTextoCodigo('');
      focarCampoCodigo();
      return;
    }

    adicionar(produto, interpretado.quantidade);
    setTextoCodigo('');
    focarCampoCodigo();
  }

  function escolherDaBusca(produto: ItemCatalogoLocal) {
    adicionar(produto, 1);
    setBuscaAberta(false);
    focarCampoCodigo();
  }

  function cancelarVenda() {
    limpar();
    setConfirmandoCancelamento(false);
    focarCampoCodigo();
  }

  // Atalhos globais: precisam funcionar mesmo com o campo de código focado
  // (que é o estado normal da tela o tempo todo).
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      // Painel de busca, modal de pagamento e tela de conclusão cuidam das
      // próprias teclas — sem essa guarda, F9 dentro do modal reabriria o
      // próprio modal, ou Esc cancelaria a venda por baixo dele.
      if (buscaAberta || finalizando || vendaConcluida || vinculandoCliente) return;

      if (e.key === 'F2') {
        e.preventDefault();
        setBuscaAberta(true);
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (itens.length > 0) setEditandoQuantidade(true);
      } else if (e.key === 'F4') {
        e.preventDefault();
        setAviso('Desconto entra numa fase futura, com autorização por alçada.');
      } else if (e.key === 'F6') {
        e.preventDefault();
        setVinculandoCliente(true);
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (itens.length === 0) {
          setAviso('Adicione ao menos um item antes de finalizar.');
        } else if (!sessaoCaixa) {
          setAviso('Sessão de caixa não encontrada — recarregue a página.');
        } else {
          setFinalizando(true);
        }
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (itens.length > 0) removerUltimo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (itens.length > 0) setConfirmandoCancelamento(true);
      }
    }

    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [buscaAberta, finalizando, vendaConcluida, vinculandoCliente, itens.length, removerUltimo, sessaoCaixa]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  const ultimoItem = itens.at(-1);
  const total = totalCarrinhoCentavos(itens);

  function aoConcluirVenda(resultado: ResultadoFinalizacao) {
    setVendaConcluida({
      // O número sequencial só existe quando o servidor confirma — a venda
      // acabou de ser gravada localmente, ainda não foi sincronizada. O
      // comprovante mostra "pendente" com o código curto do id enquanto isso.
      numero: null,
      vendaId: resultado.vendaId,
      momento: new Date(),
      operador: operador?.nome ?? '',
      itens: itens.map((item) => ({
        nome: item.nome,
        tamanho: item.tamanho,
        cor: item.cor,
        quantidade: item.quantidade,
        precoUnitarioCentavos: item.precoCentavos,
        totalCentavos: item.precoCentavos * item.quantidade,
      })),
      totalCentavos: resultado.totalCentavos,
      pagamentos: resultado.pagamentos,
    });
    setFinalizando(false);
    limpar();
  }

  if (vendaConcluida) {
    return (
      <TelaVendaConcluida
        dados={vendaConcluida}
        aoContinuar={() => {
          setVendaConcluida(null);
          focarCampoCodigo();
        }}
      />
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {finalizando && sessaoCaixa && (
        <ModalFinalizarVenda
          itens={itens}
          sessaoCaixaId={sessaoCaixa.id}
          cliente={cliente}
          aoConcluir={aoConcluirVenda}
          aoFechar={() => {
            setFinalizando(false);
            focarCampoCodigo();
          }}
        />
      )}

      {vinculandoCliente && (
        <ModalCliente
          aoVincular={(clienteEscolhido) => {
            vincularCliente({ id: clienteEscolhido.id, nome: clienteEscolhido.nome });
            setVinculandoCliente(false);
            focarCampoCodigo();
          }}
          aoFechar={() => {
            setVinculandoCliente(false);
            focarCampoCodigo();
          }}
        />
      )}

      {buscaAberta && (
        <PainelBuscaPorNome
          catalogo={catalogo}
          aoEscolher={escolherDaBusca}
          aoFechar={() => {
            setBuscaAberta(false);
            focarCampoCodigo();
          }}
        />
      )}

      <div className="grid flex-1 grid-cols-[1fr_360px] overflow-hidden">
        {/* Coluna principal: código + lista de itens */}
        <div className="flex flex-col overflow-hidden p-6">
          <Input
            ref={refCampoCodigo}
            value={textoCodigo}
            onChange={(e) => setTextoCodigo(e.target.value)}
            placeholder="Bipe o código de barras ou digite (3*código para multiplicar)…"
            className="h-16 text-valor"
            invalido={!!erroCodigo}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                processarCodigo();
              }
            }}
          />
          {erroCodigo && (
            <p role="alert" className="mt-2 text-rotulo text-perigo">
              {erroCodigo}
            </p>
          )}

          <h2 className="mb-2 mt-6 text-rotulo text-texto-secundario">
            Itens da venda ({totalDePecas(itens)} peça(s))
          </h2>

          {itens.length === 0 ? (
            <p className="text-corpo text-texto-secundario">Nenhum item ainda. Bipe ou busque um produto (F2).</p>
          ) : (
            // Mais recente primeiro: o último item lançado fica sempre
            // visível no topo, sem precisar rolar a lista.
            <ul className="flex-1 space-y-2 overflow-auto">
              {[...itens].reverse().map((item) => {
                const ehUltimo = item.varianteId === ultimoItem?.varianteId;
                return (
                  <li
                    key={item.varianteId}
                    className={`flex items-center justify-between rounded border px-4 py-3 ${
                      ehUltimo ? 'border-acento bg-superficie-alta' : 'border-borda bg-superficie'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-corpo font-medium">{item.nome}</p>
                      <p className="text-rotulo text-texto-secundario">
                        {[item.tamanho, item.cor].filter(Boolean).join(' · ')} · {item.sku} ·{' '}
                        {item.quantidade}× {formatarBRL(centavos(item.precoCentavos))}
                      </p>
                    </div>
                    <span className="text-valor">
                      {formatarBRL(centavos(item.precoCentavos * item.quantidade))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {editandoQuantidade && ultimoItem && (
            <div className="mt-3 flex items-center gap-3 rounded border border-acento bg-superficie-alta p-3">
              <span className="text-corpo">Quantidade de "{ultimoItem.nome}":</span>
              <Input
                ref={refCampoQuantidade}
                type="number"
                min={1}
                defaultValue={ultimoItem.quantidade}
                autoFocus
                className="w-24"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const valor = Number((e.target as HTMLInputElement).value);
                    if (valor > 0) alterarQuantidade(ultimoItem.varianteId, valor);
                    setEditandoQuantidade(false);
                    focarCampoCodigo();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditandoQuantidade(false);
                    focarCampoCodigo();
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* Coluna lateral: total em destaque */}
        <div className="flex flex-col justify-between border-l border-borda bg-superficie p-6">
          {cliente ? (
            <div className="flex items-center justify-between rounded border border-acento bg-superficie-alta px-3 py-2">
              <span className="truncate text-corpo">{cliente.nome}</span>
              <button
                type="button"
                onClick={desvincularCliente}
                aria-label={`Desvincular cliente ${cliente.nome}`}
                className="text-texto-secundario hover:text-perigo"
              >
                ×
              </button>
            </div>
          ) : (
            <div />
          )}
          <div>
            <p className="text-rotulo text-texto-secundario">Total</p>
            <p className="text-total">{formatarBRL(centavos(total))}</p>
          </div>
        </div>
      </div>

      {aviso && (
        <div role="status" className="border-t border-borda bg-superficie-alta px-6 py-2 text-rotulo">
          {aviso}
        </div>
      )}

      {confirmandoCancelamento && (
        <div role="alertdialog" aria-label="Confirmar cancelamento da venda" className="border-t border-perigo bg-superficie p-4">
          <p className="text-corpo">
            Cancelar esta venda com <strong>{itens.length} item(ns)</strong>, total{' '}
            <strong>{formatarBRL(centavos(total))}</strong>?
          </p>
          <div className="mt-3 flex gap-3">
            <Button
              variante="perigo"
              autoFocus
              onClick={cancelarVenda}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setConfirmandoCancelamento(false);
                  focarCampoCodigo();
                }
              }}
            >
              Confirmar cancelamento (Enter)
            </Button>
            <Button
              variante="fantasma"
              onClick={() => {
                setConfirmandoCancelamento(false);
                focarCampoCodigo();
              }}
            >
              Manter venda (Esc)
            </Button>
          </div>
        </div>
      )}

      <footer className="flex justify-center gap-6 border-t border-borda bg-fundo px-6 py-2 text-rotulo text-texto-secundario">
        <span>F2 buscar</span>
        <span>F3 quantidade</span>
        <span>F4 desconto</span>
        <span>F6 cliente</span>
        <span>F9 finalizar</span>
        <span>F10 cancelar item</span>
        <span>Esc cancelar venda</span>
      </footer>
    </div>
  );
}
