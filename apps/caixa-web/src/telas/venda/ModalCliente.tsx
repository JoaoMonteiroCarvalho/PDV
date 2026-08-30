import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ErroApi } from '@/servicos/api.js';
import { useBuscarClientes, useCriarCliente, type Cliente } from '@/servicos/clientes.js';

function paraCentavos(valor: string): number {
  if (!valor.trim()) return 0;
  return Math.round(Number(valor.trim().replace(',', '.')) * 100);
}

const esquemaNovoCliente = z.object({
  nome: z.string().trim().min(1, 'Informe o nome'),
  telefone: z.string().trim().optional(),
  limite: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d+([.,]\d{1,2})?$/.test(v), 'Use um valor em reais, ex.: 300,00'),
});
type FormularioNovoCliente = z.infer<typeof esquemaNovoCliente>;

interface Props {
  readonly aoVincular: (cliente: Cliente) => void;
  readonly aoFechar: () => void;
}

/**
 * F6: busca cliente por nome/CPF; se não achar, oferece cadastrar na hora —
 * o operador não pode ficar preso numa venda com fiado porque o cliente
 * ainda não existe no sistema.
 */
export function ModalCliente({ aoVincular, aoFechar }: Props) {
  const [busca, setBusca] = useState('');
  const [cadastrando, setCadastrando] = useState(false);
  const { data, isLoading } = useBuscarClientes(busca);
  const criar = useCriarCliente();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioNovoCliente>({ resolver: zodResolver(esquemaNovoCliente) });

  async function cadastrarECincular(dados: FormularioNovoCliente) {
    const criado = await criar.mutateAsync({
      nome: dados.nome.trim(),
      ...(dados.telefone?.trim() && { telefone: dados.telefone.trim() }),
      limiteCrediarioCentavos: paraCentavos(dados.limite ?? ''),
    });
    aoVincular({
      id: criado.id,
      nome: dados.nome.trim(),
      cpf: null,
      telefone: dados.telefone?.trim() ?? null,
      ativo: true,
      limiteCrediarioCentavos: paraCentavos(dados.limite ?? ''),
    });
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('cliente-busca')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">Vincular cliente</Dialog.Title>
          <Dialog.Description className="sr-only">
            Busque por nome ou CPF. Se o cliente não existir, cadastre na hora.
          </Dialog.Description>

          {!cadastrando ? (
            <>
              <Input
                id="cliente-busca"
                placeholder="Nome ou CPF…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />

              {isLoading && <p className="text-rotulo text-texto-secundario">Buscando…</p>}

              {data && data.itens.length > 0 && (
                <ul className="max-h-64 space-y-1.5 overflow-auto">
                  {data.itens.map((cliente) => (
                    <li key={cliente.id}>
                      <button
                        type="button"
                        onClick={() => aoVincular(cliente)}
                        className="flex w-full items-center justify-between rounded border border-borda px-3 py-2 text-left hover:bg-superficie-alta"
                      >
                        <span className="text-corpo">{cliente.nome}</span>
                        <span className="text-rotulo text-texto-secundario">
                          limite {formatarBRL(centavos(cliente.limiteCrediarioCentavos))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {data && data.itens.length === 0 && (
                <p className="text-rotulo text-texto-secundario">Nenhum cliente encontrado.</p>
              )}

              <div className="flex justify-end gap-3">
                <Dialog.Close asChild>
                  <Button type="button" variante="fantasma">
                    Cancelar
                  </Button>
                </Dialog.Close>
                <Button type="button" variante="secundaria" onClick={() => setCadastrando(true)}>
                  Cadastrar novo
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={(e) => void handleSubmit(cadastrarECincular)(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="cliente-nome" className="text-rotulo text-texto-secundario">
                  Nome
                </label>
                <Input id="cliente-nome" autoFocus invalido={!!errors.nome} {...register('nome')} />
                {errors.nome && <p className="text-rotulo text-perigo">{errors.nome.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="cliente-telefone" className="text-rotulo text-texto-secundario">
                  Telefone (opcional)
                </label>
                <Input id="cliente-telefone" {...register('telefone')} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="cliente-limite" className="text-rotulo text-texto-secundario">
                  Limite de crediário (R$)
                </label>
                <Input
                  id="cliente-limite"
                  inputMode="decimal"
                  placeholder="0,00"
                  invalido={!!errors.limite}
                  {...register('limite')}
                />
                {errors.limite && <p className="text-rotulo text-perigo">{errors.limite.message}</p>}
              </div>

              {criar.isError && (
                <p role="alert" className="text-rotulo text-perigo">
                  {criar.error instanceof ErroApi ? criar.error.message : 'Não foi possível cadastrar o cliente.'}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <Button type="button" variante="fantasma" onClick={() => setCadastrando(false)}>
                  Voltar
                </Button>
                <Button type="submit" variante="primaria" disabled={criar.isPending}>
                  {criar.isPending ? 'Cadastrando…' : 'Cadastrar e vincular'}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
