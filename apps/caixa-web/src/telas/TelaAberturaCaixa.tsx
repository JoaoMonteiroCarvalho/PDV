import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useSessao } from '@/estado/useSessao.js';
import { useAbrirSessaoCaixa } from '@/servicos/caixa.js';
import { ErroApi } from '@/servicos/api.js';

/**
 * Bloqueia a venda até existir uma sessão de caixa aberta neste terminal.
 * O fundo de troco é digitado em reais na tela (formato humano) e convertido
 * para centavos só na hora de enviar — nunca guardamos nem calculamos com
 * float em nenhum passo intermediário.
 */
const esquema = z.object({
  fundoTroco: z
    .string()
    .min(1, 'Informe o fundo de troco')
    .refine((v) => /^\d+([.,]\d{1,2})?$/.test(v.trim()), 'Use um valor em reais, ex.: 50,00'),
});
type FormularioAbertura = z.infer<typeof esquema>;

function paraCentavos(valor: string): number {
  return Math.round(Number(valor.trim().replace(',', '.')) * 100);
}

export function TelaAberturaCaixa() {
  const operador = useSessao((estado) => estado.operador);
  const terminalId = useSessao((estado) => estado.terminalId);
  const abrir = useAbrirSessaoCaixa();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioAbertura>({ resolver: zodResolver(esquema), defaultValues: { fundoTroco: '' } });

  if (!operador || !terminalId) return null; // guardas de rota já garantem isto

  function enviar(dados: FormularioAbertura) {
    if (!terminalId) return;
    abrir.mutate({ terminalId, fundoTrocoCentavos: paraCentavos(dados.fundoTroco) });
  }

  return (
    <div className="grid min-h-full place-items-center">
      <form
        onSubmit={(e) => void handleSubmit(enviar)(e)}
        className="w-full max-w-md space-y-5 rounded-lg border border-borda bg-superficie p-8"
      >
        <header className="space-y-1">
          <h1 className="text-valor">Abertura de caixa</h1>
          <p className="text-rotulo text-texto-secundario">
            Abrindo como <span className="font-semibold text-texto">{operador.nome}</span>
          </p>
        </header>

        <div className="space-y-1.5">
          <label htmlFor="fundoTroco" className="text-rotulo text-texto-secundario">
            Fundo de troco (R$)
          </label>
          <Input
            id="fundoTroco"
            autoFocus
            inputMode="decimal"
            placeholder="0,00"
            invalido={!!errors.fundoTroco}
            {...register('fundoTroco')}
          />
          {errors.fundoTroco && <p className="text-rotulo text-perigo">{errors.fundoTroco.message}</p>}
        </div>

        {abrir.isError && (
          <p role="alert" className="text-rotulo text-perigo">
            {abrir.error instanceof ErroApi ? abrir.error.message : 'Não foi possível abrir o caixa.'}
          </p>
        )}

        <Button type="submit" variante="primaria" tamanho="grande" className="w-full" disabled={abrir.isPending}>
          {abrir.isPending ? 'Abrindo…' : 'Abrir caixa'}
        </Button>
      </form>
    </div>
  );
}
