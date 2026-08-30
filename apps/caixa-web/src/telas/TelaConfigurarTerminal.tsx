import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useSessao } from '@/estado/useSessao.js';

/**
 * Identifica qual terminal físico esta máquina é — feito uma vez por
 * computador, não por operador (por isso vem depois do login, mas persiste
 * mesmo quando o operador troca ou desloga).
 *
 * O ID vem do cadastro de terminal no backend; hoje é colado manualmente
 * pelo gerente. Não existe endpoint de auto-descoberta na API atual.
 */
const esquema = z.object({
  terminalId: z.string().uuid('Cole o ID do terminal (formato UUID)'),
});
type FormularioTerminal = z.infer<typeof esquema>;

export function TelaConfigurarTerminal() {
  const definirTerminal = useSessao((estado) => estado.definirTerminal);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioTerminal>({ resolver: zodResolver(esquema) });

  return (
    <div className="grid min-h-full place-items-center">
      <form
        onSubmit={(e) => void handleSubmit((dados) => definirTerminal(dados.terminalId))(e)}
        className="w-[calc(100%-2rem)] max-w-md space-y-5 rounded-lg border border-borda bg-superficie p-8"
      >
        <header className="space-y-1">
          <h1 className="text-valor">Configurar terminal</h1>
          <p className="text-rotulo text-texto-secundario">
            Cole o ID deste terminal, fornecido pelo gerente. Feito uma vez por computador.
          </p>
        </header>

        <div className="space-y-1.5">
          <label htmlFor="terminalId" className="text-rotulo text-texto-secundario">
            ID do terminal
          </label>
          <Input id="terminalId" autoFocus invalido={!!errors.terminalId} {...register('terminalId')} />
          {errors.terminalId && <p className="text-rotulo text-perigo">{errors.terminalId.message}</p>}
        </div>

        <Button type="submit" variante="primaria" tamanho="grande" className="w-full">
          Salvar
        </Button>
      </form>
    </div>
  );
}
