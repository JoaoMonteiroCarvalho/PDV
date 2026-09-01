/**
 * Escolha da cliente para venda no crediário.
 *
 * Fiado sem cliente identificada é dívida de ninguém. O servidor recusa
 * (`CREDIARIO_SEM_CLIENTE`), e esta tela recusa antes, para o erro não chegar
 * depois do comprovante impresso.
 *
 * Mostra o limite DISPONÍVEL, não o limite total: o que importa para decidir a
 * venda é quanto ainda cabe, já descontado o que a cliente deve.
 */

import { formatarBRL, centavos, formatarCpf } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { clienteApi, type ClienteDetalhe, type ClienteResumo } from '../api/cliente.js';
import { Botao, Campo, Erro, Selo, cx } from '../componentes/base.js';

interface Props {
  readonly escolhida: ClienteDetalhe | null;
  readonly aoEscolher: (cliente: ClienteDetalhe | null) => void;
}

export function SeletorCliente({ escolhida, aoEscolher }: Props) {
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ClienteResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (escolhida) return;
    let cancelado = false;
    const temporizador = setTimeout(async () => {
      setCarregando(true);
      try {
        const achados = await clienteApi.buscarClientes(busca);
        if (!cancelado) {
          setResultados(achados);
          setErro(null);
        }
      } catch (falha) {
        if (!cancelado) {
          setErro(falha instanceof Error ? falha.message : 'Não foi possível buscar as clientes.');
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }, 200);

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [busca, escolhida]);

  async function escolher(cliente: ClienteResumo) {
    setErro(null);
    try {
      // Puxa a ficha completa: o limite DISPONÍVEL não vem na busca, e é ele
      // que decide se a venda cabe.
      aoEscolher(await clienteApi.obterCliente(cliente.id));
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível abrir a ficha.');
    }
  }

  if (escolhida) {
    return (
      <div className="rounded-[12px] border border-line bg-sunken px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-ink">{escolhida.nome}</p>
            <p className="num truncate text-[12px] text-ink-faint">
              {escolhida.cpf ? formatarCpf(escolhida.cpf) : 'sem CPF'}
            </p>
          </div>
          <Botao variante="discreto" onClick={() => aoEscolher(null)} className="h-8 px-3 text-[13px]">
            Trocar
          </Botao>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <div className="flex gap-2">
            <dt className="text-ink-soft">Deve</dt>
            <dd className="num">{formatarBRL(centavos(escolhida.saldoDevedorCentavos))}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-soft">Pode levar</dt>
            <dd
              data-testid="limite-disponivel-venda"
              className={cx(
                'num font-medium',
                escolhida.limiteDisponivelCentavos > 0 ? 'text-ok' : 'text-perigo',
              )}
            >
              {formatarBRL(centavos(escolhida.limiteDisponivelCentavos))}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-line px-4 py-3">
      <Campo
        rotulo="Cliente do fiado"
        placeholder="nome ou CPF"
        value={busca}
        onChange={(evento) => setBusca(evento.target.value)}
        autoComplete="off"
      />

      {erro && (
        <div className="mt-3">
          <Erro>{erro}</Erro>
        </div>
      )}

      {!erro && resultados.length === 0 && !carregando && (
        <p className="mt-3 text-[13px] text-ink-faint">
          {busca.trim()
            ? 'Nenhuma cliente com esse nome ou CPF. Cadastre em Clientes antes de vender fiado.'
            : 'Busque a cliente pelo nome ou CPF.'}
        </p>
      )}

      {resultados.length > 0 && (
        <ul className="mt-3 max-h-52 divide-y divide-line overflow-y-auto rounded-[10px] border border-line">
          {resultados.map((cliente) => (
            <li key={cliente.id}>
              <button
                type="button"
                onClick={() => void escolher(cliente)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-sunken"
              >
                <span className="min-w-0 flex-1 truncate text-[14px]">{cliente.nome}</span>
                {cliente.limiteCrediarioCentavos > 0 ? (
                  <Selo tom="accent">
                    até {formatarBRL(centavos(cliente.limiteCrediarioCentavos))}
                  </Selo>
                ) : (
                  <Selo tom="neutro">sem fiado</Selo>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
