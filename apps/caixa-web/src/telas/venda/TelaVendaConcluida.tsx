import { formatarBRL, centavos } from '@pdv/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { imprimirComprovante, type DadosComprovante } from '@/servicos/impressao.js';

const SEGUNDOS_ATE_VOLTAR = 6;

interface Props {
  readonly dados: DadosComprovante;
  readonly aoContinuar: () => void;
}

/** Resumo pós-venda. Imprime automaticamente uma vez e volta sozinho para a próxima venda. */
export function TelaVendaConcluida({ dados, aoContinuar }: Props) {
  const [segundosRestantes, setSegundosRestantes] = useState(SEGUNDOS_ATE_VOLTAR);

  useEffect(() => {
    imprimirComprovante(dados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (segundosRestantes <= 0) {
      aoContinuar();
      return;
    }
    const t = setTimeout(() => setSegundosRestantes((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segundosRestantes]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        aoContinuar();
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-full place-items-center">
      <div className="max-w-sm space-y-5 text-center">
        <p className="text-total text-sucesso">Venda concluída ✓</p>
        <p className="text-corpo text-texto-secundario">
          {dados.numero !== null ? `Venda #${dados.numero}` : 'Venda registrada'} ·{' '}
          {formatarBRL(centavos(dados.totalCentavos))}
        </p>

        <div className="flex justify-center gap-3">
          <Button variante="secundaria" onClick={() => imprimirComprovante(dados)}>
            Reimprimir comprovante
          </Button>
          <Button variante="primaria" onClick={aoContinuar}>
            Nova venda ({segundosRestantes}s)
          </Button>
        </div>
      </div>
    </div>
  );
}
