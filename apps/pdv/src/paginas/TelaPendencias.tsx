/**
 * Vendas que não chegaram ao servidor.
 *
 * Esta tela existe porque a fila tem um estado que nenhuma outra resolve:
 * `BLOQUEADA`. O servidor recusou a venda por regra de negócio (4xx) e
 * retentar não muda nada — mas **a venda aconteceu**: foi impressa, o dinheiro
 * entrou na gaveta e a cliente foi embora. Sem um lugar para vê-la, esse
 * dinheiro fica invisível: não está no relatório, não está no fechamento, e
 * ninguém descobre até a conferência do mês não bater.
 *
 * Duas decisões de desenho:
 *
 * - **Nada é apagado daqui.** Reenviar é a única ação. Descartar uma venda
 *   bloqueada seria apagar o registro de dinheiro que existe de verdade, e é
 *   exatamente o que a fila se recusa a fazer sozinha desde `fila.ts`.
 *
 * - **O erro do servidor aparece em texto, junto com os dados brutos.** Quem
 *   vai destravar isso é a gerente, no telefone com o suporte — e a pergunta
 *   dela vai ser "o que exatamente ele recusou?".
 */

import { centavos, formatarBRL } from '@pdv/shared';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { bancoLocal, type VendaEnfileirada } from '../banco/local.js';
import { Botao, Cartao, Erro, Selo } from '../componentes/base.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';

export function TelaPendencias() {
  const [fila, setFila] = useState<VendaEnfileirada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState<string | null>(null);

  // `liveQuery`: a lista se corrige sozinha quando uma venda sincroniza, sem a
  // gerente precisar recarregar para saber se resolveu.
  useEffect(() => {
    const inscricao = liveQuery(() => bancoLocal.fila.orderBy('criadaEm').toArray()).subscribe({
      next: setFila,
      error: (falha: unknown) =>
        setErro(falha instanceof Error ? falha.message : 'Não foi possível ler a fila local.'),
    });
    return () => inscricao.unsubscribe();
  }, []);

  const bloqueadas = fila?.filter((venda) => venda.estado === 'BLOQUEADA') ?? [];
  const aguardando = fila?.filter((venda) => venda.estado !== 'BLOQUEADA') ?? [];

  async function reenviar(vendaId: string) {
    setErro(null);
    setReenviando(vendaId);
    try {
      await motorSincronizacao.obterFila().reabilitar(vendaId);
      await motorSincronizacao.enviarPendentes();
      await motorSincronizacao.atualizarContadores();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível reenviar.');
    } finally {
      setReenviando(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="font-titulo text-[24px]">Vendas a enviar</h1>
      <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-ink-soft">
        Vendas que já aconteceram no caixa e ainda não foram registradas no servidor. Nada é
        apagado daqui — venda bloqueada é dinheiro que existe e precisa de decisão de gente.
      </p>

      {erro && (
        <div className="mt-5">
          <Erro>{erro}</Erro>
        </div>
      )}

      {fila === null ? (
        <p className="mt-8 text-[14px] text-ink-faint">Lendo a fila deste caixa…</p>
      ) : fila.length === 0 ? (
        <Cartao className="mt-6 p-8 text-center">
          <Selo tom="ok">Tudo sincronizado</Selo>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
            Nenhuma venda esperando envio. O que foi vendido neste caixa já está registrado no
            servidor.
          </p>
        </Cartao>
      ) : (
        <>
          {bloqueadas.length > 0 && (
            <section className="mt-6">
              <h2 className="font-titulo text-[17px] font-medium text-perigo">
                {bloqueadas.length}{' '}
                {bloqueadas.length === 1 ? 'venda recusada' : 'vendas recusadas'} pelo servidor
              </h2>
              <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-soft">
                Retentar sozinho não resolve: o servidor recusou por regra de negócio. Corrija a
                causa (caixa fechado, cliente sem limite, produto fora do catálogo) e reenvie.
              </p>
              <ul className="mt-4 space-y-3">
                {bloqueadas.map((venda) => (
                  <CartaoVenda
                    key={venda.id}
                    venda={venda}
                    reenviando={reenviando === venda.id}
                    aoReenviar={() => void reenviar(venda.id)}
                  />
                ))}
              </ul>
            </section>
          )}

          {aguardando.length > 0 && (
            <section className="mt-8">
              <h2 className="font-titulo text-[17px] font-medium">
                {aguardando.length}{' '}
                {aguardando.length === 1 ? 'venda aguardando' : 'vendas aguardando'} envio
              </h2>
              <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-soft">
                Estas sobem sozinhas assim que a conexão permitir. Não exigem ação.
              </p>
              <ul className="mt-4 space-y-3">
                {aguardando.map((venda) => (
                  <CartaoVenda key={venda.id} venda={venda} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CartaoVenda({
  venda,
  reenviando,
  aoReenviar,
}: {
  venda: VendaEnfileirada;
  reenviando?: boolean;
  aoReenviar?: () => void;
}) {
  const bloqueada = venda.estado === 'BLOQUEADA';
  const momento = new Date(venda.criadaEm);

  return (
    <li>
      <Cartao className="p-4">
        <div className="flex flex-wrap items-baseline gap-3">
          {/*
            O código curto é o mesmo que sai impresso no comprovante. É por ele
            que a gerente liga o papel na mão a esta linha da tela — o UUID
            inteiro ninguém confere.
          */}
          <span className="num font-titulo text-[17px] font-semibold">
            {venda.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="num text-[17px]">{formatarBRL(centavos(venda.totalCentavos))}</span>
          <span className="flex-1 text-[13px] text-ink-faint">
            {momento.toLocaleString('pt-BR')}
          </span>
          {bloqueada ? (
            <Selo tom="perigo">Recusada</Selo>
          ) : (
            <Selo tom="accent">Aguardando envio</Selo>
          )}
        </div>

        {venda.ultimoErro && (
          <p className="mt-3 rounded-[8px] bg-sunken px-3 py-2 text-[13px] leading-relaxed text-ink">
            {venda.ultimoErro}
          </p>
        )}

        <p className="mt-2 text-[12px] text-ink-faint">
          {venda.tentativas} {venda.tentativas === 1 ? 'tentativa' : 'tentativas'} de envio
        </p>

        {bloqueada && aoReenviar && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Botao variante="primario" disabled={reenviando} onClick={aoReenviar}>
              {reenviando ? 'Reenviando…' : 'Reenviar agora'}
            </Botao>
            {/*
              Os dados brutos ficam atrás de um clique: quem precisa deles está
              no telefone com o suporte, e quem não precisa não deve ver JSON
              na tela do caixa.
            */}
            <details className="w-full">
              <summary className="cursor-pointer text-[13px] text-ink-soft">
                Dados desta venda
              </summary>
              <pre className="num mt-2 max-h-56 overflow-auto rounded-[8px] bg-sunken p-3 text-[12px] leading-relaxed">
                {JSON.stringify(venda.corpo, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </Cartao>
    </li>
  );
}
