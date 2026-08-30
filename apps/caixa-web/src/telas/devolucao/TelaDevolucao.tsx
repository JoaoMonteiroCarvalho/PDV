import { useState } from 'react';
import { useNavegacao } from '@/estado/useNavegacao.js';
import type { VendaLocalizada } from '@/servicos/devolucao.js';
import { TelaLocalizarVenda } from './TelaLocalizarVenda.js';
import { TelaSelecionarItens } from './TelaSelecionarItens.js';

export function TelaDevolucao() {
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const [vendaLocalizada, setVendaLocalizada] = useState<VendaLocalizada | null>(null);

  if (vendaLocalizada) {
    return (
      <TelaSelecionarItens
        venda={vendaLocalizada}
        aoConcluir={irParaVenda}
        aoVoltar={() => setVendaLocalizada(null)}
      />
    );
  }

  return <TelaLocalizarVenda aoEncontrar={setVendaLocalizada} aoVoltar={irParaVenda} />;
}
