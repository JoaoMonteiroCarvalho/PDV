import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ModalAutorizarGerente } from '@/telas/ModalAutorizarGerente.js';
import { ErroApi } from '@/servicos/api.js';
import { useRegistrarMovimentoCaixa } from '@/servicos/caixaGestao.js';

const NOME_DO_TIPO = { SANGRIA: 'Sangria', SUPRIMENTO: 'Suprimento' } as const;

const esquema = z.object({
  valor: z
    .string()
    .min(1, 'Informe o valor')
    .refine((v) => /^\d+([.,]\d{1,2})?$/.test(v.trim()), 'Use um valor em reais, ex.: 50,00')
    .refine((v) => Number(v.trim().replace(',', '.')) > 0, 'O valor precisa ser maior que zero'),
  motivo: z.string().trim().min(3, 'Descreva o motivo (mínimo 3 caracteres)'),
});
type FormularioMovimento = z.infer<typeof esquema>;

function paraCentavos(valor: string): number {
  return Math.round(Number(valor.trim().replace(',', '.')) * 100);
}

interface Props {
  readonly sessaoCaixaId: string;
  readonly tipo: 'SANGRIA' | 'SUPRIMENTO';
  readonly aoConcluir: () => void;
  readonly aoFechar: () => void;
}

/**
 * Sangria/suprimento em duas etapas: primeiro o formulário (valor + motivo,
 * ambos obrigatórios), depois autorização de gerente — nesta ordem, porque
 * o gerente precisa ver exatamente o valor e o motivo antes de autorizar,
 * não uma tela em branco.
 */
export function ModalMovimentoCaixa({ sessaoCaixaId, tipo, aoConcluir, aoFechar }: Props) {
  const [dadosConfirmados, setDadosConfirmados] = useState<{ valorCentavos: number; motivo: string } | null>(
    null,
  );
  const registrar = useRegistrarMovimentoCaixa(sessaoCaixaId);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioMovimento>({ resolver: zodResolver(esquema) });

  async function autorizado(gerenteId: string) {
    if (!dadosConfirmados) return;
    await registrar.mutateAsync({
      tipo,
      valorCentavos: dadosConfirmados.valorCentavos,
      observacao: dadosConfirmados.motivo,
      autorizadoPorId: gerenteId,
    });
    aoConcluir();
  }

  if (dadosConfirmados) {
    return (
      <ModalAutorizarGerente
        aberto
        titulo={`Autorizar ${NOME_DO_TIPO[tipo].toLowerCase()}`}
        descricao={`${NOME_DO_TIPO[tipo]} de ${formatarBRL(centavos(dadosConfirmados.valorCentavos))} — ${dadosConfirmados.motivo}`}
        aoAutorizar={(gerenteId) => void autorizado(gerenteId)}
        aoFechar={() => setDadosConfirmados(null)}
      />
    );
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('movimento-valor')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">{NOME_DO_TIPO[tipo]}</Dialog.Title>
          <Dialog.Description className="sr-only">
            Informe o valor e o motivo. A confirmação exige autorização de gerente.
          </Dialog.Description>

          <form
            onSubmit={(e) =>
              void handleSubmit((dados) =>
                setDadosConfirmados({ valorCentavos: paraCentavos(dados.valor), motivo: dados.motivo.trim() }),
              )(e)
            }
            className="space-y-5"
          >
            <div className="space-y-1.5">
              <label htmlFor="movimento-valor" className="text-rotulo text-texto-secundario">
                Valor (R$)
              </label>
              <Input
                id="movimento-valor"
                inputMode="decimal"
                placeholder="0,00"
                className="text-valor"
                invalido={!!errors.valor}
                {...register('valor')}
              />
              {errors.valor && <p className="text-rotulo text-perigo">{errors.valor.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="movimento-motivo" className="text-rotulo text-texto-secundario">
                Motivo
              </label>
              <Input
                id="movimento-motivo"
                placeholder={tipo === 'SANGRIA' ? 'Ex.: depósito no banco' : 'Ex.: reforço de troco'}
                invalido={!!errors.motivo}
                {...register('motivo')}
              />
              {errors.motivo && <p className="text-rotulo text-perigo">{errors.motivo.message}</p>}
            </div>

            {registrar.isError && (
              <p role="alert" className="text-rotulo text-perigo">
                {registrar.error instanceof ErroApi ? registrar.error.message : 'Não foi possível registrar.'}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button type="button" variante="fantasma">
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variante="primaria">
                Continuar
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
