/**
 * Venda concluída: confirmação e comprovante em tela.
 *
 * Duas coisas acontecem aqui, nesta ordem de importância:
 *
 *   1. A operadora precisa saber, sem dúvida, que a venda foi registrada. É
 *      isso que a solta para atender a próxima cliente.
 *   2. O comprovante aparece na tela ANTES de sair no papel. A operadora
 *      confere o total e as formas de pagamento olhando, e a cliente pode
 *      dispensar a via impressa — a loja economiza bobina e a cliente não leva
 *      para casa um papel que ela não quer que ninguém veja.
 *
 * O comprovante em tela é o MESMO texto de 48 colunas que vai à impressora.
 * Renderizar um layout bonito diferente do papel criaria a chance de a tela
 * mostrar uma coisa e a bobina outra — num documento de dinheiro isso não pode
 * acontecer.
 *
 * A venda já está gravada e na fila quando esta tela abre. Nada aqui pode
 * falhar de um jeito que desfaça isso: imprimir, não imprimir ou fechar a
 * janela dá no mesmo para o registro.
 */

import { formatarBRL } from '@pdv/shared';
import { Suspense, lazy, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Botao, Cartao, Selo, cx } from '../componentes/base.js';
import { useCarrinho } from '../estado/carrinhoStore.js';
import { comprovanteEmTexto, montarComprovante } from '../impressao/comprovante.js';
import { imprimirComprovante } from '../impressao/imprimir.js';
import { lojaAtual, politicaTrocaDaLoja } from '../impressao/loja.js';
import { vendaExigeAvisoDeHigiene } from '../impressao/politicaTroca.js';
import { PalcoEstatico } from '../tres/PalcoEstatico.js';
import { podeRenderizar3d } from '../tres/capacidade.js';

const CenaConfirmacao = lazy(() => import('../tres/CenaConfirmacao.js'));

/** Cores da embalagem — paleta de catálogo, nunca token de interface. */
const COR_EMBALAGEM = '#1A1A1C';
const COR_FITA = '#7A3129';

export function TelaVendaConcluida() {
  const navegar = useNavigate();
  const venda = useCarrinho((estado) => estado.ultimaVenda);
  const descartarAviso = useCarrinho((estado) => estado.descartarAviso);
  const [detalhado, setDetalhado] = useState(false);

  const usar3d = useMemo(() => podeRenderizar3d(), []);

  /*
   * `useMemo` incondicional, antes de qualquer retorno: hook não pode ficar
   * atrás de um `if`. Quando não há venda, produz string vazia e a tela
   * redireciona logo abaixo.
   */
  const texto = useMemo(() => {
    if (!venda) return '';
    return comprovanteEmTexto(
      montarComprovante(
        venda.calculo,
        {
          ...venda.dados,
          discricao: detalhado ? 'completo' : 'discreto',
          politicaDaLoja: politicaTrocaDaLoja(),
        },
        lojaAtual(),
      ),
    );
  }, [venda, detalhado]);

  // Chegou aqui sem venda (recarregou a página, ou colou a URL): volta ao
  // trabalho em vez de mostrar uma tela vazia sem explicação.
  if (!venda) return <Navigate to="/venda" replace />;

  const temPecaIntima = vendaExigeAvisoDeHigiene(venda.dados.itens);

  function novaVenda() {
    descartarAviso();
    navegar('/venda');
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div>
          <div className="flex items-center gap-3">
            <Selo tom="ok">Venda registrada</Selo>
            <span className="num text-[13px] text-ink-faint">
              {venda.dados.vendaId.slice(0, 8).toUpperCase()}
            </span>
          </div>

          <p className="mt-3 text-[15px] text-ink-soft">Total recebido</p>
          {/*
            O mesmo valor aparece dentro do comprovante logo ao lado, então o
            testid marca qual deles é O total da venda.
          */}
          <p
            data-testid="total-recebido"
            className="num font-titulo text-[40px] font-semibold leading-tight"
          >
            {formatarBRL(venda.calculo.totalCentavos)}
          </p>

          <div className="h-[240px]">
            {usar3d ? (
              <Suspense
                fallback={<PalcoEstatico cor={COR_EMBALAGEM} corFita={COR_FITA} />}
              >
                <CenaConfirmacao cor={COR_EMBALAGEM} corFita={COR_FITA} />
              </Suspense>
            ) : (
              <PalcoEstatico cor={COR_EMBALAGEM} corFita={COR_FITA} />
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Botao variante="primario" tamanho="grande" onClick={novaVenda}>
              Nova venda
            </Botao>
            <Botao
              variante="neutro"
              tamanho="grande"
              onClick={() =>
                imprimirComprovante(
                  venda.calculo,
                  {
                    ...venda.dados,
                    discricao: detalhado ? 'completo' : 'discreto',
                    politicaDaLoja: politicaTrocaDaLoja(),
                  },
                  lojaAtual(),
                )
              }
            >
              Imprimir comprovante
            </Botao>
          </div>

          {temPecaIntima && (
            <p className="mt-4 max-w-prose text-[13px] leading-relaxed text-ink-faint">
              A política de troca já está impressa no comprovante: peça íntima não tem troca por
              higiene, <strong className="font-medium text-ink-soft">exceto defeito de
              fabricação</strong>, que a loja é obrigada a trocar.
            </p>
          )}
        </div>

        <Cartao className="flex min-h-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-titulo text-[14px] font-medium">Comprovante</h2>
            {/*
              A via detalhada é direito da cliente: se ela pedir para ver o que
              comprou, some a discrição. A escolha é dela, não do sistema.
            */}
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-soft">
              <input
                type="checkbox"
                checked={detalhado}
                onChange={(evento) => setDetalhado(evento.target.checked)}
                className="size-3.5 accent-[var(--accent)]"
              />
              nome dos produtos
            </label>
          </header>

          <pre
            aria-label="Comprovante da venda"
            className={cx(
              'min-h-0 flex-1 overflow-auto bg-sunken px-4 py-3',
              'font-mono text-[11px] leading-[1.35] text-ink',
            )}
          >
            {texto}
          </pre>
        </Cartao>
      </div>
    </div>
  );
}
