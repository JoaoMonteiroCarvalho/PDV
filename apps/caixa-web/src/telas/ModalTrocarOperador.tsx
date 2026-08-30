import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useSessao } from '@/estado/useSessao.js';
import { useAutenticar } from '@/servicos/autenticacao.js';
import { ErroApi } from '@/servicos/api.js';

/**
 * Troca o operador logado SEM passar pela tela cheia de login — a sessão de
 * caixa já aberta continua valendo (qualquer operador autenticado pode
 * vender nela; não é presa a quem abriu).
 *
 * Este mesmo componente é a base da autorização de gerente por sobreposição
 * (Fases seguintes: desconto acima da alçada, cancelamento): a diferença é
 * só o que o chamador faz com o resultado. Aqui, `aoAutenticar` troca a
 * sessão ativa (`entrar`); num caso de autorização, o chamador usaria as
 * credenciais só para validar o papel do gerente, sem tocar na sessão.
 */
const esquema = z.object({
  login: z.string().min(1, 'Informe o código do operador'),
  senha: z.string().min(1, 'Informe a senha'),
});
type FormularioTroca = z.infer<typeof esquema>;

interface Props {
  readonly aberto: boolean;
  readonly aoFechar: () => void;
}

export function ModalTrocarOperador({ aberto, aoFechar }: Props) {
  const entrar = useSessao((estado) => estado.entrar);
  const autenticar = useAutenticar();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormularioTroca>({ resolver: zodResolver(esquema) });

  async function enviar(dados: FormularioTroca) {
    try {
      const resposta = await autenticar.mutateAsync(dados);
      entrar(resposta.token, resposta.operador);
      reset();
      aoFechar();
    } catch {
      // erro fica em autenticar.error, tratado no JSX.
    }
  }

  return (
    <Dialog.Root
      open={aberto}
      onOpenChange={(abrindo) => {
        if (!abrindo) {
          reset();
          autenticar.reset();
          aoFechar();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8"
          onOpenAutoFocus={(e) => {
            // Radix focaria o botão de fechar por padrão; o operador quer
            // digitar o código, não navegar até o X.
            e.preventDefault();
            document.getElementById('troca-login')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">Trocar operador</Dialog.Title>
          <Dialog.Description className="text-rotulo text-texto-secundario">
            A sessão de caixa continua aberta — só quem está operando muda.
          </Dialog.Description>

          <form onSubmit={(e) => void handleSubmit(enviar)(e)} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="troca-login" className="text-rotulo text-texto-secundario">
                Código do operador
              </label>
              <Input id="troca-login" autoComplete="username" invalido={!!errors.login} {...register('login')} />
              {errors.login && <p className="text-rotulo text-perigo">{errors.login.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="troca-senha" className="text-rotulo text-texto-secundario">
                Senha
              </label>
              <Input
                id="troca-senha"
                type="password"
                autoComplete="current-password"
                invalido={!!errors.senha}
                {...register('senha')}
              />
              {errors.senha && <p className="text-rotulo text-perigo">{errors.senha.message}</p>}
            </div>

            {autenticar.isError && (
              <p role="alert" className="text-rotulo text-perigo">
                {autenticar.error instanceof ErroApi ? autenticar.error.message : 'Não foi possível autenticar.'}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button type="button" variante="fantasma">
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variante="primaria" disabled={autenticar.isPending}>
                {autenticar.isPending ? 'Entrando…' : 'Trocar'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
