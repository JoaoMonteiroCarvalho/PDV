import * as Dialog from '@radix-ui/react-dialog';
import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { ErroApi } from '@/servicos/api.js';
import { useReceberParcela, type EntradaReceberParcela } from '@/servicos/clientes.js';

const FORMAS: ReadonlyArray<{ forma: EntradaReceberParcela['forma']; rotulo: string }> = [
  { forma: 'DINHEIRO', rotulo: 'Dinheiro' },
  { forma: 'PIX', rotulo: 'Pix' },
  { forma: 'DEBITO', rotulo: 'Débito' },
  { forma: 'CREDITO', rotulo: 'Crédito' },
];

interface Props {
  readonly parcelaId: string;
  readonly sessaoCaixaId: string;
  readonly valorCentavos: number;
  readonly aoConcluir: () => void;
  readonly aoFechar: () => void;
}

/**
 * Recebimento exige o valor EXATO da parcela — sem edição do valor aqui,
 * só a forma de pagamento. Ver validarRecebimentoParcela em @pdv/shared.
 */
export function ModalReceberParcela({ parcelaId, sessaoCaixaId, valorCentavos, aoConcluir, aoFechar }: Props) {
  const [forma, setForma] = useState<EntradaReceberParcela['forma'] | null>(null);
  const receber = useReceberParcela(parcelaId);

  if (receber.isSuccess) {
    return (
      <Dialog.Root open onOpenChange={(aberto) => !aberto && aoConcluir()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60" />
          <Dialog.Content
            role="status"
            aria-live="polite"
            className="fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8 text-center"
          >
            <Dialog.Title className="text-valor text-sucesso">Parcela recebida</Dialog.Title>
            <p className="text-corpo">{formatarBRL(centavos(valorCentavos))}</p>
            <Button variante="primaria" tamanho="grande" className="w-full" onClick={aoConcluir} autoFocus>
              Concluir
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8">
          <Dialog.Title className="text-valor">Receber parcela</Dialog.Title>
          <Dialog.Description className="text-corpo text-texto-secundario">
            {formatarBRL(centavos(valorCentavos))}
          </Dialog.Description>

          <div className="grid grid-cols-2 gap-2">
            {FORMAS.map(({ forma: opcao, rotulo }) => (
              <Button
                key={opcao}
                variante={forma === opcao ? 'primaria' : 'secundaria'}
                onClick={() => setForma(opcao)}
              >
                {rotulo}
              </Button>
            ))}
          </div>

          {receber.isError && (
            <p role="alert" className="text-rotulo text-perigo">
              {receber.error instanceof ErroApi ? receber.error.message : 'Não foi possível registrar o recebimento.'}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button type="button" variante="fantasma">
                Cancelar
              </Button>
            </Dialog.Close>
            <Button
              variante="primaria"
              disabled={!forma || receber.isPending}
              onClick={() =>
                forma &&
                void receber.mutateAsync({ sessaoCaixaId, valorCentavos, forma })
              }
            >
              {receber.isPending ? 'Registrando…' : 'Confirmar recebimento'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
