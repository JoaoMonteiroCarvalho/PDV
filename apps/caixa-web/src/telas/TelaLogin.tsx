import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useSessao } from '@/estado/useSessao.js';
import { useAutenticar } from '@/servicos/autenticacao.js';
import { ErroApi } from '@/servicos/api.js';

/**
 * Login rápido do operador.
 *
 * O backend real usa um campo de texto (`login`), não um PIN puramente
 * numérico — os operadores cadastrados hoje são "ana", "bia" etc. Sigo o
 * contrato que existe, em vez de inventar um esquema de código numérico que
 * o servidor não entende.
 *
 * Enter no campo de login move o foco para a senha; Enter na senha envia —
 * o operador nunca precisa tocar no mouse para entrar.
 */

const esquema = z.object({
  login: z.string().min(1, 'Informe o código do operador'),
  senha: z.string().min(1, 'Informe a senha'),
});
type FormularioLogin = z.infer<typeof esquema>;

export function TelaLogin() {
  const entrar = useSessao((estado) => estado.entrar);
  const autenticar = useAutenticar();

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<FormularioLogin>({ resolver: zodResolver(esquema) });

  async function enviar(dados: FormularioLogin) {
    try {
      const resposta = await autenticar.mutateAsync(dados);
      entrar(resposta.token, resposta.operador);
    } catch {
      // erro já fica disponível via autenticar.error — tratado no JSX abaixo.
    }
  }

  return (
    <div className="grid min-h-full place-items-center">
      <form
        onSubmit={(e) => void handleSubmit(enviar)(e)}
        className="w-full max-w-sm space-y-5 rounded-lg border border-borda bg-superficie p-8"
      >
        <header className="space-y-1">
          <h1 className="text-valor">PDV — Caixa</h1>
          <p className="text-rotulo text-texto-secundario">Identifique-se para começar</p>
        </header>

        <div className="space-y-1.5">
          <label htmlFor="login" className="text-rotulo text-texto-secundario">
            Código do operador
          </label>
          <Input
            id="login"
            autoFocus
            autoComplete="username"
            invalido={!!errors.login}
            {...register('login')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setFocus('senha');
              }
            }}
          />
          {errors.login && <p className="text-rotulo text-perigo">{errors.login.message}</p>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="senha" className="text-rotulo text-texto-secundario">
            Senha
          </label>
          <Input
            id="senha"
            type="password"
            autoComplete="current-password"
            invalido={!!errors.senha}
            {...register('senha')}
          />
          {errors.senha && <p className="text-rotulo text-perigo">{errors.senha.message}</p>}
        </div>

        {autenticar.isError && (
          <p role="alert" className="text-rotulo text-perigo">
            {autenticar.error instanceof ErroApi
              ? autenticar.error.message
              : 'Não foi possível conectar ao servidor.'}
          </p>
        )}

        <Button type="submit" variante="primaria" tamanho="grande" className="w-full" disabled={autenticar.isPending}>
          {autenticar.isPending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  );
}
