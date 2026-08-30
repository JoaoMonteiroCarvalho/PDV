import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { useSessao } from '@/estado/useSessao.js';
import { IndicadorConexao } from './IndicadorConexao.js';
import { ModalTrocarOperador } from './ModalTrocarOperador.js';

/** Barra fixa no topo, sempre visível depois do login. */
export function Cabecalho() {
  const operador = useSessao((estado) => estado.operador);
  const sair = useSessao((estado) => estado.sair);
  const [modalAberto, setModalAberto] = useState(false);

  if (!operador) return null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-borda bg-superficie px-5">
      <span className="text-corpo font-semibold">PDV</span>

      <div className="flex items-center gap-4">
        <IndicadorConexao />
        <span className="text-rotulo text-texto-secundario">
          {operador.nome} <span className="text-texto-secundario/70">· {operador.papel}</span>
        </span>
        <Button variante="secundaria" onClick={() => setModalAberto(true)}>
          Trocar operador
        </Button>
        <Button variante="fantasma" onClick={sair}>
          Sair
        </Button>
      </div>

      <ModalTrocarOperador aberto={modalAberto} aoFechar={() => setModalAberto(false)} />
    </header>
  );
}
