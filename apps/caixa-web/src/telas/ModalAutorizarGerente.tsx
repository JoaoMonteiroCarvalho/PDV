import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useAutenticar } from '@/servicos/autenticacao.js';
import { ErroApi } from '@/servicos/api.js';

/**
 * Autorização de gerente POR SOBREPOSIÇÃO — login e senha do gerente,
 * validados na hora, SEM trocar a sessão do operador que está atendendo
 * (diferente de `ModalTrocarOperador`, que troca).
 *
 * Genérico de propósito: sangria, suprimento e fechamento com divergência
 * usam este mesmo componente hoje; desconto acima da alçada e cancelamento
 * de venda (fases futuras) reaproveitam sem duplicar.
 *
 * `descricao` é o que aparece antes do login — é o "mostre exatamente o que
 * será autorizado" que toda ação financeira/destrutiva exige, em vez de um
 * "tem certeza?" genérico.
 */

const esquema = z.object({
  login: z.string().min(1, 'Informe o código do gerente'),
  senha: z.string().min(1, 'Informe a senha'),
});
type FormularioAutorizacao = z.infer<typeof esquema>;

interface Props {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly descricao: string;
  readonly aoAutorizar: (gerenteId: string) => void;
  readonly aoFechar: () => void;
}

export function ModalAutorizarGerente({ aberto, titulo, descricao, aoAutorizar, aoFechar }: Props) {
  const autenticar = useAutenticar();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormularioAutorizacao>({ resolver: zodResolver(esquema) });

  async function enviar(dados: FormularioAutorizacao) {
    const resposta = await autenticar.mutateAsync(dados);
    if (resposta.operador.papel !== 'GERENTE' && resposta.operador.papel !== 'ADMIN') {
      // O servidor faz a mesma checagem na hora de gravar o movimento — isto
      // aqui é só feedback rápido, não é a autoridade real da regra.
      setError('login', { message: 'Este login não tem permissão de gerente.' });
      return;
    }
    reset();
    aoAutorizar(resposta.operador.id);
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
          className="fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-alerta bg-superficie p-8"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('autorizar-login')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">{titulo}</Dialog.Title>
          <Dialog.Description className="text-corpo text-texto">{descricao}</Dialog.Description>
          <p className="text-rotulo text-texto-secundario">
            Exige senha de gerente. A sessão do operador atual não é trocada.
          </p>

          <form onSubmit={(e) => void handleSubmit(enviar)(e)} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="autorizar-login" className="text-rotulo text-texto-secundario">
                Código do gerente
              </label>
              <Input
                id="autorizar-login"
                autoComplete="username"
                invalido={!!errors.login}
                {...register('login')}
              />
              {errors.login && <p className="text-rotulo text-perigo">{errors.login.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="autorizar-senha" className="text-rotulo text-texto-secundario">
                Senha
              </label>
              <Input
                id="autorizar-senha"
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
                {autenticar.isPending ? 'Verificando…' : 'Autorizar'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
