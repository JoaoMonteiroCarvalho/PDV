/**
 * Relatório Z — o documento do fim do turno.
 *
 * Antes, fechar o caixa produzia três números: esperado, contado, diferença.
 * Isso responde "bateu?" e nada mais. A pergunta seguinte, que aparece toda
 * noite, é "bateu com o quê?" — e sem a quebra por forma de pagamento não dá
 * para conciliar o extrato da maquininha nem saber quanto do dia foi Pix.
 *
 * A distinção que organiza a tela: **só dinheiro passa pela gaveta.** Cartão e
 * Pix vão direto para a conta da loja, e crediário não é dinheiro recebido, é
 * promessa. Eles aparecem porque o turno os movimentou, não porque entram na
 * conferência — somá-los ao esperado faria toda gaveta fechar com sobra
 * fantasma.
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { clienteApi, type RelatorioFechamento } from '../api/cliente.js';
import { Botao, Cartao, Erro, Selo, cx } from '../componentes/base.js';

const ROTULO_FORMA: Readonly<Record<string, string>> = {
  DINHEIRO: 'Dinheiro',
  DEBITO: 'Cartão de débito',
  CREDITO: 'Cartão de crédito',
  PIX: 'Pix',
  CREDIARIO: 'Fiado',
};

/** As formas que de fato entram na gaveta. O resto não é conferido no caixa. */
const NA_GAVETA = new Set(['DINHEIRO']);

export function RelatorioZ({ sessaoCaixaId }: { sessaoCaixaId: string }) {
  const [relatorio, setRelatorio] = useState<RelatorioFechamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void clienteApi
      .relatorioFechamento(sessaoCaixaId)
      .then((dados) => {
        if (!cancelado) setRelatorio(dados);
      })
      .catch((falha: unknown) => {
        if (!cancelado) {
          setErro(
            falha instanceof Error ? falha.message : 'Não foi possível carregar o relatório.',
          );
        }
      });
    return () => {
      cancelado = true;
    };
  }, [sessaoCaixaId]);

  if (erro) return <Erro>{erro}</Erro>;
  if (!relatorio) {
    return <p className="text-[14px] text-ink-faint">Carregando o relatório do turno…</p>;
  }

  const { gaveta } = relatorio;

  return (
    <div className="space-y-5">
      <Cartao className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-titulo text-[17px] font-medium">Turno de {relatorio.operador}</h2>
          <Selo tom={relatorio.status === 'FECHADA' ? 'neutro' : 'accent'}>
            {relatorio.status === 'FECHADA' ? 'encerrado' : 'em andamento'}
          </Selo>
        </div>
        <p className="mt-1 text-[13px] text-ink-faint">
          {relatorio.terminal} · abriu {new Date(relatorio.abertaEm).toLocaleString('pt-BR')}
          {relatorio.fechadaEm
            ? ` · fechou ${new Date(relatorio.fechadaEm).toLocaleString('pt-BR')}`
            : ''}
        </p>

        <div className="mt-4 flex flex-wrap gap-6">
          <div>
            <span className="text-[13px] text-ink-soft">Vendas</span>
            <p className="num font-titulo text-[24px] font-semibold">
              {relatorio.vendas.quantidade}
            </p>
          </div>
          <div>
            <span className="text-[13px] text-ink-soft">Total vendido</span>
            <p className="num font-titulo text-[24px] font-semibold">
              {formatarBRL(centavos(relatorio.vendas.totalCentavos))}
            </p>
          </div>
        </div>
      </Cartao>

      <Cartao className="p-5">
        <h2 className="font-titulo text-[17px] font-medium">Por forma de pagamento</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
          Valores líquidos do troco. Só o dinheiro passa pela gaveta — cartão e Pix vão direto
          para a conta, e fiado ainda não foi recebido.
        </p>

        {relatorio.porForma.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-faint">Nenhuma venda neste turno.</p>
        ) : (
          <dl className="mt-4 divide-y divide-line">
            {relatorio.porForma.map((linha) => (
              <div key={linha.forma} className="flex items-center justify-between py-2.5">
                <dt className="flex items-center gap-2 text-[14px] text-ink">
                  {ROTULO_FORMA[linha.forma] ?? linha.forma}
                  {!NA_GAVETA.has(linha.forma) && (
                    <span className="text-[12px] text-ink-faint">fora da gaveta</span>
                  )}
                </dt>
                <dd className="flex items-baseline gap-3">
                  <span className="num text-[12px] text-ink-faint">
                    {linha.quantidade}×
                  </span>
                  <span className="num text-[16px]">
                    {formatarBRL(centavos(linha.totalCentavos))}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Cartao>

      <Cartao className="p-5">
        <h2 className="font-titulo text-[17px] font-medium">Conferência da gaveta</h2>
        <dl className="mt-4 divide-y divide-line">
          <LinhaValor rotulo="Fundo de troco" valor={gaveta.fundoTrocoCentavos} />
          <LinhaValor rotulo="Vendas em dinheiro" valor={gaveta.vendasEmDinheiroCentavos} />
          {gaveta.recebimentosCrediarioCentavos !== 0 && (
            <LinhaValor rotulo="Recebimentos de fiado" valor={gaveta.recebimentosCrediarioCentavos} />
          )}
          {gaveta.suprimentosCentavos !== 0 && (
            <LinhaValor rotulo="Suprimentos" valor={gaveta.suprimentosCentavos} />
          )}
          {gaveta.sangriasCentavos !== 0 && (
            <LinhaValor rotulo="Sangrias" valor={gaveta.sangriasCentavos} />
          )}
          {gaveta.devolucoesCentavos !== 0 && (
            <LinhaValor rotulo="Devoluções" valor={gaveta.devolucoesCentavos} />
          )}
          <LinhaValor rotulo="Esperado na gaveta" valor={gaveta.esperadoCentavos} forte />
          {gaveta.contadoCentavos !== null && (
            <LinhaValor rotulo="Contado" valor={gaveta.contadoCentavos} forte />
          )}
          {gaveta.diferencaCentavos !== null && (
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-[14px] font-medium text-ink">Diferença</dt>
              <dd
                className={cx(
                  'num text-[17px] font-semibold',
                  gaveta.diferencaCentavos === 0
                    ? 'text-ok'
                    : gaveta.diferencaCentavos > 0
                      ? 'text-alerta'
                      : 'text-perigo',
                )}
              >
                {gaveta.diferencaCentavos > 0 ? '+' : ''}
                {formatarBRL(centavos(gaveta.diferencaCentavos))}
              </dd>
            </div>
          )}
        </dl>
      </Cartao>

      {relatorio.movimentos.length > 0 && (
        <Cartao className="p-5">
          <h2 className="font-titulo text-[17px] font-medium">Movimentos do turno</h2>
          <ul className="mt-4 divide-y divide-line">
            {relatorio.movimentos.map((movimento, indice) => (
              <li key={indice} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span
                  className={cx(
                    'num w-24 shrink-0 text-right text-[15px]',
                    movimento.valorCentavos < 0 ? 'text-perigo' : 'text-ink',
                  )}
                >
                  {formatarBRL(centavos(movimento.valorCentavos))}
                </span>
                <span className="text-[14px] text-ink">{movimento.tipo.replace(/_/g, ' ')}</span>
                <span className="flex-1" />
                <span className="text-[12px] text-ink-faint">
                  {new Date(movimento.criadoEm).toLocaleTimeString('pt-BR')} · {movimento.usuario}
                  {movimento.autorizadoPor ? ` · autorizou ${movimento.autorizadoPor}` : ''}
                </span>
                {movimento.observacao && (
                  <p className="w-full text-[12px] text-ink-faint">{movimento.observacao}</p>
                )}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <Botao variante="neutro" onClick={() => window.print()}>
        Imprimir relatório
      </Botao>
    </div>
  );
}

function LinhaValor({
  rotulo,
  valor,
  forte,
}: {
  rotulo: string;
  valor: number;
  forte?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className={cx('text-[14px]', forte ? 'font-medium text-ink' : 'text-ink-soft')}>
        {rotulo}
      </dt>
      <dd className={cx('num', forte ? 'text-[17px] font-semibold' : 'text-[15px]')}>
        {formatarBRL(centavos(valor))}
      </dd>
    </div>
  );
}
