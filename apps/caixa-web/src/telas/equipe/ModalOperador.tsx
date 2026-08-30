import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ErroApi } from '@/servicos/api.js';
import {
  useAtualizarOperador,
  useCriarOperador,
  type OperadorListado,
  type Papel,
} from '@/servicos/operadores.js';

const PAPEIS: ReadonlyArray<{ valor: Papel; rotulo: string }> = [
  { valor: 'OPERADOR', rotulo: 'Operador' },
  { valor: 'GERENTE', rotulo: 'Gerente' },
  { valor: 'ADMIN', rotulo: 'Administrador' },
];

const esquemaCriar = z.object({
  nome: z.string().trim().min(1, 'Informe o nome'),
  login: z.string().trim().min(3, 'O login precisa ter ao menos 3 caracteres'),
  senha: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres'),
  papel: z.enum(['OPERADOR', 'GERENTE', 'ADMIN']),
  limiteDesconto: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d+(,\d{1,2})?$/.test(v), 'Use um percentual, ex.: 5 ou 5,50'),
});
type FormularioCriar = z.infer<typeof esquemaCriar>;

const esquemaEditar = z.object({
  nome: z.string().trim().min(1, 'Informe o nome'),
  papel: z.enum(['OPERADOR', 'GERENTE', 'ADMIN']),
  limiteDesconto: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d+(,\d{1,2})?$/.test(v), 'Use um percentual, ex.: 5 ou 5,50'),
  novaSenha: z
    .string()
    .optional()
    .refine((v) => !v || v.length >= 6, 'A nova senha precisa ter ao menos 6 caracteres'),
});
type FormularioEditar = z.infer<typeof esquemaEditar>;

function paraBps(percentual: string | undefined): number {
  if (!percentual?.trim()) return 0;
  return Math.round(Number(percentual.trim().replace(',', '.')) * 100);
}

function deBps(bps: number): string {
  return bps === 0 ? '' : (bps / 100).toString().replace('.', ',');
}

interface Props {
  readonly operador?: OperadorListado;
  readonly aoConcluir: () => void;
  readonly aoFechar: () => void;
}

export function ModalOperador({ operador, aoConcluir, aoFechar }: Props) {
  if (operador) {
    return <FormularioEdicao operador={operador} aoConcluir={aoConcluir} aoFechar={aoFechar} />;
  }
  return <FormularioCriacao aoConcluir={aoConcluir} aoFechar={aoFechar} />;
}

function FormularioCriacao({ aoConcluir, aoFechar }: { aoConcluir: () => void; aoFechar: () => void }) {
  const criar = useCriarOperador();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioCriar>({ resolver: zodResolver(esquemaCriar), defaultValues: { papel: 'OPERADOR' } });

  async function enviar(dados: FormularioCriar) {
    await criar.mutateAsync({
      nome: dados.nome.trim(),
      login: dados.login.trim(),
      senha: dados.senha,
      papel: dados.papel,
      limiteDescontoBps: paraBps(dados.limiteDesconto),
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
            document.getElementById('operador-nome')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">Novo operador</Dialog.Title>
          <Dialog.Description className="sr-only">
            Cadastre nome, login, senha e o papel do novo operador.
          </Dialog.Description>

          <form onSubmit={(e) => void handleSubmit(enviar)(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="operador-nome" className="text-rotulo text-texto-secundario">
                Nome
              </label>
              <Input id="operador-nome" invalido={!!errors.nome} {...register('nome')} />
              {errors.nome && <p className="text-rotulo text-perigo">{errors.nome.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="operador-login" className="text-rotulo text-texto-secundario">
                Login
              </label>
              <Input id="operador-login" invalido={!!errors.login} {...register('login')} />
              {errors.login && <p className="text-rotulo text-perigo">{errors.login.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="operador-senha" className="text-rotulo text-texto-secundario">
                Senha
              </label>
              <Input id="operador-senha" type="password" invalido={!!errors.senha} {...register('senha')} />
              {errors.senha && <p className="text-rotulo text-perigo">{errors.senha.message}</p>}
            </div>

            <div className="space-y-1.5">
              <span className="text-rotulo text-texto-secundario">Papel</span>
              <div className="flex gap-4">
                {PAPEIS.map(({ valor, rotulo }) => (
                  <label key={valor} className="flex items-center gap-2 text-corpo">
                    <input type="radio" value={valor} {...register('papel')} defaultChecked={valor === 'OPERADOR'} />
                    {rotulo}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="operador-limite" className="text-rotulo text-texto-secundario">
                Limite de desconto (%, opcional)
              </label>
              <Input id="operador-limite" placeholder="0" invalido={!!errors.limiteDesconto} {...register('limiteDesconto')} />
              {errors.limiteDesconto && <p className="text-rotulo text-perigo">{errors.limiteDesconto.message}</p>}
            </div>

            {criar.isError && (
              <p role="alert" className="text-rotulo text-perigo">
                {criar.error instanceof ErroApi ? criar.error.message : 'Não foi possível criar o operador.'}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button type="button" variante="fantasma">
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variante="primaria" disabled={criar.isPending}>
                {criar.isPending ? 'Criando…' : 'Criar'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FormularioEdicao({
  operador,
  aoConcluir,
  aoFechar,
}: {
  operador: OperadorListado;
  aoConcluir: () => void;
  aoFechar: () => void;
}) {
  const atualizar = useAtualizarOperador(operador.id);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioEditar>({
    resolver: zodResolver(esquemaEditar),
    defaultValues: {
      nome: operador.nome,
      papel: operador.papel,
      limiteDesconto: deBps(operador.limiteDescontoBps),
    },
  });

  async function enviar(dados: FormularioEditar) {
    await atualizar.mutateAsync({
      nome: dados.nome.trim(),
      papel: dados.papel,
      limiteDescontoBps: paraBps(dados.limiteDesconto),
      ...(dados.novaSenha && { novaSenha: dados.novaSenha }),
    });
    aoConcluir();
  }

  async function alternarAtivo() {
    await atualizar.mutateAsync({ ativo: !operador.ativo });
    aoConcluir();
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8">
          <Dialog.Title className="text-valor">Editar operador</Dialog.Title>
          <Dialog.Description className="text-rotulo text-texto-secundario">
            Login: {operador.login} (não pode ser alterado)
          </Dialog.Description>

          <form onSubmit={(e) => void handleSubmit(enviar)(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="operador-nome-editar" className="text-rotulo text-texto-secundario">
                Nome
              </label>
              <Input id="operador-nome-editar" invalido={!!errors.nome} {...register('nome')} />
              {errors.nome && <p className="text-rotulo text-perigo">{errors.nome.message}</p>}
            </div>

            <div className="space-y-1.5">
              <span className="text-rotulo text-texto-secundario">Papel</span>
              <div className="flex gap-4">
                {PAPEIS.map(({ valor, rotulo }) => (
                  <label key={valor} className="flex items-center gap-2 text-corpo">
                    <input type="radio" value={valor} {...register('papel')} defaultChecked={valor === operador.papel} />
                    {rotulo}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="operador-limite-editar" className="text-rotulo text-texto-secundario">
                Limite de desconto (%)
              </label>
              <Input id="operador-limite-editar" invalido={!!errors.limiteDesconto} {...register('limiteDesconto')} />
              {errors.limiteDesconto && <p className="text-rotulo text-perigo">{errors.limiteDesconto.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="operador-nova-senha" className="text-rotulo text-texto-secundario">
                Redefinir senha (opcional)
              </label>
              <Input
                id="operador-nova-senha"
                type="password"
                placeholder="Deixe em branco para manter"
                invalido={!!errors.novaSenha}
                {...register('novaSenha')}
              />
              {errors.novaSenha && <p className="text-rotulo text-perigo">{errors.novaSenha.message}</p>}
            </div>

            {atualizar.isError && (
              <p role="alert" className="text-rotulo text-perigo">
                {atualizar.error instanceof ErroApi ? atualizar.error.message : 'Não foi possível salvar.'}
              </p>
            )}

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variante={operador.ativo ? 'perigo' : 'secundaria'}
                onClick={() => void alternarAtivo()}
                disabled={atualizar.isPending}
              >
                {operador.ativo ? 'Desativar' : 'Reativar'}
              </Button>
              <div className="flex gap-3">
                <Dialog.Close asChild>
                  <Button type="button" variante="fantasma">
                    Cancelar
                  </Button>
                </Dialog.Close>
                <Button type="submit" variante="primaria" disabled={atualizar.isPending}>
                  {atualizar.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
