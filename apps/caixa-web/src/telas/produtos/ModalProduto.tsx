import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ErroApi } from '@/servicos/api.js';
import { useCriarProduto } from '@/servicos/produtos.js';

const esquema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do produto'),
  descricao: z.string().trim().optional(),
  marca: z.string().trim().optional(),
});
type FormularioProduto = z.infer<typeof esquema>;

interface Props {
  readonly aoConcluir: () => void;
  readonly aoFechar: () => void;
}

export function ModalProduto({ aoConcluir, aoFechar }: Props) {
  const criar = useCriarProduto();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioProduto>({ resolver: zodResolver(esquema) });

  async function enviar(dados: FormularioProduto) {
    await criar.mutateAsync({
      nome: dados.nome.trim(),
      ...(dados.descricao?.trim() && { descricao: dados.descricao.trim() }),
      ...(dados.marca?.trim() && { marca: dados.marca.trim() }),
    });
    aoConcluir();
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('produto-nome')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">Novo produto</Dialog.Title>
          <Dialog.Description className="sr-only">
            Cadastre o produto. Cores, tamanhos e preço ficam nas variantes, depois de criado.
          </Dialog.Description>

          <form onSubmit={(e) => void handleSubmit(enviar)(e)} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="produto-nome" className="text-rotulo text-texto-secundario">
                Nome
              </label>
              <Input id="produto-nome" invalido={!!errors.nome} {...register('nome')} />
              {errors.nome && <p className="text-rotulo text-perigo">{errors.nome.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="produto-marca" className="text-rotulo text-texto-secundario">
                Marca (opcional)
              </label>
              <Input id="produto-marca" {...register('marca')} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="produto-descricao" className="text-rotulo text-texto-secundario">
                Descrição (opcional)
              </label>
              <Input id="produto-descricao" {...register('descricao')} />
            </div>

            {criar.isError && (
              <p role="alert" className="text-rotulo text-perigo">
                {criar.error instanceof ErroApi ? criar.error.message : 'Não foi possível criar o produto.'}
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
