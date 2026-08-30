import { zodResolver } from '@hookform/resolvers/zod';
import { formatarBRL, centavos } from '@pdv/shared';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ErroApi } from '@/servicos/api.js';
import { useLocalizarVenda, type VendaLocalizada } from '@/servicos/devolucao.js';

const esquema = z.object({
  busca: z.string().trim().min(1, 'Informe o número da venda ou o código do comprovante'),
});
type FormularioBusca = z.infer<typeof esquema>;

interface Props {
  readonly aoEncontrar: (venda: VendaLocalizada) => void;
  readonly aoVoltar: () => void;
}

/** Aceita número sequencial da venda ou o código curto de 8 dígitos impresso no comprovante. */
export function TelaLocalizarVenda({ aoEncontrar, aoVoltar }: Props) {
  const localizar = useLocalizarVenda();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioBusca>({ resolver: zodResolver(esquema) });

  async function buscar(dados: FormularioBusca) {
    try {
      const venda = await localizar.mutateAsync(dados.busca);
      aoEncontrar(venda);
    } catch {
      // Erro já fica disponível em localizar.isError/error para a UI — aqui
      // só evita a rejeição de promise não tratada subir para o RHF.
    }
  }

  return (
    <div className="grid min-h-full place-items-center">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-borda bg-superficie p-8">
        <header className="space-y-1">
          <h1 className="text-valor">Devolução</h1>
          <p className="text-rotulo text-texto-secundario">
            Número da venda (impresso no comprovante) ou código curto de 8 caracteres.
          </p>
        </header>

        <form onSubmit={(e) => void handleSubmit(buscar)(e)} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="busca-venda" className="text-rotulo text-texto-secundario">
              Número ou código
            </label>
            <Input
              id="busca-venda"
              autoFocus
              className="text-valor"
              invalido={!!errors.busca}
              {...register('busca')}
            />
            {errors.busca && <p className="text-rotulo text-perigo">{errors.busca.message}</p>}
          </div>

          {localizar.isError && (
            <p role="alert" className="text-rotulo text-perigo">
              {localizar.error instanceof ErroApi ? localizar.error.message : 'Não foi possível buscar a venda.'}
            </p>
          )}

          {localizar.isSuccess && (
            <p className="text-rotulo text-texto-secundario">
              Venda #{localizar.data.numero} — {formatarBRL(centavos(localizar.data.totalCentavos))}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variante="fantasma" onClick={aoVoltar}>
              Voltar
            </Button>
            <Button type="submit" variante="primaria" disabled={localizar.isPending}>
              {localizar.isPending ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
