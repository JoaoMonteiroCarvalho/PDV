import { formatarBRL, centavos } from '@pdv/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { interpretarEntradaCodigo } from '@/dominio/codigoBarras.js';
import { totalCarrinhoCentavos, totalDePecas, useCarrinho } from '@/estado/useCarrinho.js';
import { useCatalogo, type ItemCatalogo } from '@/servicos/catalogo.js';
import { PainelBuscaPorNome } from './PainelBuscaPorNome.js';

/**
 * Tela de venda — Fase 2: layout e navegação por teclado. Pagamento
 * (finalização, F9) chega na Fase 3; aqui F9 só sinaliza que a venda está
 * pronta pra fechar, sem processar nada ainda.
 *
 * O campo de código NUNCA perde o foco por conta própria: toda ação
 * (adicionar item, fechar busca, cancelar) devolve o foco pra ele — é o
 * que permite o operador trabalhar com scanner USB sem tocar em nada.
 */
export function TelaVenda() {
  const { data: catalogo = [] } = useCatalogo();
  const itens = useCarrinho((estado) => estado.itens);
  const adicionar = useCarrinho((estado) => estado.adicionar);
  const removerUltimo = useCarrinho((estado) => estado.removerUltimo);
  const limpar = useCarrinho((estado) => estado.limpar);
  const alterarQuantidade = useCarrinho((estado) => estado.alterarQuantidade);

  const [textoCodigo, setTextoCodigo] = useState('');
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const [editandoQuantidade, setEditandoQuantidade] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

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

  function localizarPorCodigo(codigo: string): ItemCatalogo | undefined {
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

  function escolherDaBusca(produto: ItemCatalogo) {
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
      if (buscaAberta) return; // o painel de busca cuida das próprias teclas

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
        setAviso('Vincular cliente entra na Fase 6 (clientes e fiado).');
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (itens.length === 0) {
          setAviso('Adicione ao menos um item antes de finalizar.');
        } else {
          setAviso('Finalização com pagamento entra na Fase 3.');
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
  }, [buscaAberta, itens.length, removerUltimo]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  const ultimoItem = itens.at(-1);
  const total = totalCarrinhoCentavos(itens);

  return (
    <div className="relative flex h-full flex-col">
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
          <div />
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
