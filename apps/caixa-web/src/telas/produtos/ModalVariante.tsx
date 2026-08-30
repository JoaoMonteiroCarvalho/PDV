import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ErroApi } from '@/servicos/api.js';
import { useCriarVariante } from '@/servicos/produtos.js';

function paraCentavos(valor: string): number {
  return Math.round(Number(valor.trim().replace(',', '.')) * 100);
}

const valorReais = z
  .string()
  .min(1, 'Informe o valor')
  .refine((v) => /^\d+([.,]\d{1,2})?$/.test(v.trim()), 'Use um valor em reais, ex.: 89,90');

const esquema = z.object({
  sku: z.string().trim().min(1, 'Informe o SKU'),
  codigoBarras: z.string().trim().optional(),
  tamanho: z.string().trim().optional(),
  cor: z.string().trim().optional(),
  preco: valorReais.refine((v) => Number(v.trim().replace(',', '.')) > 0, 'O preço precisa ser maior que zero'),
  custo: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d+([.,]\d{1,2})?$/.test(v), 'Use um valor em reais, ex.: 40,00'),
});
type FormularioVariante = z.infer<typeof esquema>;

interface Props {
  readonly produtoId: string;
  readonly nomeProduto: string;
  readonly aoConcluir: () => void;
  readonly aoFechar: () => void;
}

export function ModalVariante({ produtoId, nomeProduto, aoConcluir, aoFechar }: Props) {
  const criar = useCriarVariante(produtoId);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioVariante>({ resolver: zodResolver(esquema) });

  async function enviar(dados: FormularioVariante) {
    await criar.mutateAsync({
      sku: dados.sku.trim(),
      precoCentavos: paraCentavos(dados.preco),
      ...(dados.codigoBarras?.trim() && { codigoBarras: dados.codigoBarras.trim() }),
      ...(dados.tamanho?.trim() && { tamanho: dados.tamanho.trim() }),
      ...(dados.cor?.trim() && { cor: dados.cor.trim() }),
      ...(dados.custo?.trim() && { custoCentavos: paraCentavos(dados.custo) }),
    });
    aoConcluir();
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('variante-sku')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">Nova variante</Dialog.Title>
          <Dialog.Description className="text-corpo text-texto-secundario">{nomeProduto}</Dialog.Description>

          <form onSubmit={(e) => void handleSubmit(enviar)(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="variante-sku" className="text-rotulo text-texto-secundario">
                SKU
              </label>
              <Input id="variante-sku" invalido={!!errors.sku} {...register('sku')} />
              {errors.sku && <p className="text-rotulo text-perigo">{errors.sku.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="variante-codigo-barras" className="text-rotulo text-texto-secundario">
                Código de barras (opcional)
              </label>
              <Input id="variante-codigo-barras" {...register('codigoBarras')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="variante-tamanho" className="text-rotulo text-texto-secundario">
                  Tamanho
                </label>
                <Input id="variante-tamanho" {...register('tamanho')} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="variante-cor" className="text-rotulo text-texto-secundario">
                  Cor
                </label>
                <Input id="variante-cor" {...register('cor')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="variante-preco" className="text-rotulo text-texto-secundario">
                  Preço de venda (R$)
                </label>
                <Input
                  id="variante-preco"
                  inputMode="decimal"
                  placeholder="0,00"
                  invalido={!!errors.preco}
                  {...register('preco')}
                />
                {errors.preco && <p className="text-rotulo text-perigo">{errors.preco.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="variante-custo" className="text-rotulo text-texto-secundario">
                  Custo (opcional)
                </label>
                <Input
                  id="variante-custo"
                  inputMode="decimal"
                  placeholder="0,00"
                  invalido={!!errors.custo}
                  {...register('custo')}
                />
                {errors.custo && <p className="text-rotulo text-perigo">{errors.custo.message}</p>}
              </div>
            </div>

            {criar.isError && (
              <p role="alert" className="text-rotulo text-perigo">
                {criar.error instanceof ErroApi ? criar.error.message : 'Não foi possível criar a variante.'}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button type="button" variante="fantasma">
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variante="primaria">
                Criar
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
