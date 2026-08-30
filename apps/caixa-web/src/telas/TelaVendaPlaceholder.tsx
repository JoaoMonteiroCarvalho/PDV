import { useSessao } from '@/estado/useSessao.js';
import { useSessaoCaixaAberta } from '@/servicos/caixa.js';
import { formatarBRL, centavos } from '@pdv/shared';

/** Placeholder até a Fase 2 construir a tela de venda de verdade. */
export function TelaVendaPlaceholder() {
  const terminalId = useSessao((estado) => estado.terminalId);
  const { data: sessao } = useSessaoCaixaAberta(terminalId);

  return (
    <div className="grid min-h-full place-items-center">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-valor">Caixa aberto ✓</h1>
        <p className="text-corpo text-texto-secundario">
          A tela de venda entra na Fase 2. Por enquanto, aqui está a confirmação de que a
          sessão de caixa deste terminal está de pé.
        </p>
        {sessao && (
          <p className="text-corpo">
            Saldo esperado na gaveta: <strong>{formatarBRL(centavos(sessao.saldoEsperadoCentavos))}</strong>
          </p>
        )}
      </div>
    </div>
  );
}
