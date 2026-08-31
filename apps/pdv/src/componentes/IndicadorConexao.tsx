/**
 * Estado de conexão — sempre visível, sempre em palavras.
 *
 * Nunca um ícone ambíguo: uma nuvem cortada pode significar "offline",
 * "erro de sincronização" ou "sem conta configurada", e a operadora não tem
 * como saber qual. Aqui o estado é escrito.
 *
 * Offline NÃO é erro: o caixa continua vendendo. A cor comunica isso — âmbar
 * (atenção), não vermelho (falha).
 */

import { useEffect, useState } from 'react';
import { Selo } from './base.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';
import type { EstadoSincronizacao } from '../sincronizacao/motor.js';

export function useEstadoSincronizacao(): EstadoSincronizacao | null {
  const [estado, setEstado] = useState<EstadoSincronizacao | null>(null);
  useEffect(() => motorSincronizacao.aoMudar(setEstado), []);
  return estado;
}

export function IndicadorConexao() {
  const estado = useEstadoSincronizacao();
  const online = estado?.online ?? true;
  const pendentes = estado?.pendentes ?? 0;
  const bloqueadas = estado?.bloqueadas ?? 0;
  const sincronizando = estado?.sincronizando ?? false;

  return (
    <div className="flex items-center gap-2">
      {online ? (
        <Selo tom={sincronizando ? 'accent' : 'ok'}>
          <Ponto className={sincronizando ? 'bg-accent' : 'bg-ok'} pulsando={sincronizando} />
          {sincronizando ? 'Sincronizando' : 'Online'}
        </Selo>
      ) : (
        <Selo tom="alerta">
          <Ponto className="bg-alerta" />
          Offline — vendendo normalmente
        </Selo>
      )}

      {pendentes > 0 && (
        <Selo tom="accent">
          {pendentes} {pendentes === 1 ? 'venda aguardando' : 'vendas aguardando'} envio
        </Selo>
      )}

      {/*
        Venda bloqueada é o único estado aqui que exige ação humana: o servidor
        recusou por regra de negócio e retentar não resolve. Por isso é o único
        em vermelho, e diz o que fazer.
      */}
      {bloqueadas > 0 && (
        <Selo tom="perigo">
          {bloqueadas} com problema — chame o gerente
        </Selo>
      )}
    </div>
  );
}

function Ponto({ className, pulsando }: { className: string; pulsando?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-1.5 rounded-full ${className} ${pulsando ? 'animate-pulse' : ''}`}
    />
  );
}
