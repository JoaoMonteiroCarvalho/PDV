import { zodResolver } from '@hookform/resolvers/zod';
import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ErroApi } from '@/servicos/api.js';
import { useFecharCaixa, useMarcarCaixaFechado, type ResultadoFecharSessao } from '@/servicos/caixaGestao.js';

const esquema = z.object({
  valorContado: z
    .string()
    .min(1, 'Informe o valor contado')
    .refine((v) => /^\d+([.,]\d{1,2})?$/.test(v.trim()), 'Use um valor em reais, ex.: 350,00'),
});
type FormularioFechamento = z.infer<typeof esquema>;

function paraCentavos(valor: string): number {
  return Math.round(Number(valor.trim().replace(',', '.')) * 100);
}

interface Props {
  readonly sessaoCaixaId: string;
  readonly aoConcluir: () => void;
  readonly aoVoltar: () => void;
}

/**
 * Conferência CEGA: o campo abaixo é a única coisa que o operador vê antes
 * de confirmar. O valor esperado só existe na resposta do servidor — não é
 * buscado nem mostrado antes disso, mesmo que a tela já tivesse esse número
 * disponível de outra consulta. Ver isso antes anularia a conferência.
 */
export function TelaFecharCaixa({ sessaoCaixaId, aoConcluir, aoVoltar }: Props) {
  const [confirmando, setConfirmando] = useState<{ valorContadoCentavos: number } | null>(null);
  const fechar = useFecharCaixa(sessaoCaixaId);
  const marcarCaixaFechado = useMarcarCaixaFechado();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioFechamento>({ resolver: zodResolver(esquema) });

  async function confirmarFechamento() {
    if (!confirmando) return;
    await fechar.mutateAsync(confirmando.valorContadoCentavos);
  }

  if (fechar.isSuccess) {
    return (
      <ResultadoFechamentoView
        resultado={fechar.data}
        aoConcluir={() => {
          // Só AGORA — depois que o operador já viu a diferença e decidiu
          // seguir em frente — é seguro avisar o resto do app que a sessão
          // fechou. Fazer isso antes faria a tela trocar sozinha por baixo
          // do operador, sem ele conseguir ler o resultado.
          marcarCaixaFechado();
          aoConcluir();
        }}
      />
    );
  }

  if (confirmando) {
    return (
      <div className="grid min-h-full place-items-center">
        <div className="w-full max-w-sm space-y-5 rounded-lg border border-alerta bg-superficie p-8 text-center">
          <p className="text-corpo">Fechar o caixa contando</p>
          <p className="text-total">{formatarBRL(centavos(confirmando.valorContadoCentavos))}</p>
          <p className="text-rotulo text-texto-secundario">
            O fechamento não é bloqueado por diferença — mas toda diferença fica registrada.
          </p>

          {fechar.isError && (
            <p role="alert" className="text-rotulo text-perigo">
              {fechar.error instanceof ErroApi ? fechar.error.message : 'Não foi possível fechar o caixa.'}
            </p>
          )}

          <div className="flex justify-center gap-3">
            <Button variante="fantasma" onClick={() => setConfirmando(null)} disabled={fechar.isPending}>
              Voltar
            </Button>
            <Button variante="perigo" onClick={() => void confirmarFechamento()} disabled={fechar.isPending}>
              {fechar.isPending ? 'Fechando…' : 'Confirmar fechamento'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-full place-items-center">
      <form
        onSubmit={(e) =>
          void handleSubmit((dados) => setConfirmando({ valorContadoCentavos: paraCentavos(dados.valorContado) }))(
            e,
          )
        }
        className="w-full max-w-sm space-y-5 rounded-lg border border-borda bg-superficie p-8"
      >
        <header className="space-y-1">
          <h1 className="text-valor">Fechar caixa</h1>
          <p className="text-rotulo text-texto-secundario">
            Conte o dinheiro na gaveta e digite o total. O sistema mostra o esperado só depois.
          </p>
        </header>

        <div className="space-y-1.5">
          <label htmlFor="valorContado" className="text-rotulo text-texto-secundario">
            Valor contado (R$)
          </label>
          <Input
            id="valorContado"
            autoFocus
            inputMode="decimal"
            placeholder="0,00"
            className="text-valor"
            invalido={!!errors.valorContado}
            {...register('valorContado')}
          />
          {errors.valorContado && <p className="text-rotulo text-perigo">{errors.valorContado.message}</p>}
        </div>

        <div className="flex justify-end gap-3">
          <Button type="button" variante="fantasma" onClick={aoVoltar}>
            Voltar
          </Button>
          <Button type="submit" variante="primaria">
            Continuar
          </Button>
        </div>
      </form>
    </div>
  );
}

function ResultadoFechamentoView({
  resultado,
  aoConcluir,
}: {
  resultado: ResultadoFecharSessao;
  aoConcluir: () => void;
}) {
  const bateu = resultado.diferencaCentavos === 0;
  const sobrou = resultado.diferencaCentavos > 0;

  return (
    <div className="grid min-h-full place-items-center">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-borda bg-superficie p-8 text-center">
        <h1 className="text-valor">Caixa fechado</h1>

        <dl className="space-y-2 text-left">
          <div className="flex justify-between text-corpo">
            <dt className="text-texto-secundario">Contado</dt>
            <dd>{formatarBRL(centavos(resultado.valorContadoCentavos))}</dd>
          </div>
          <div className="flex justify-between text-corpo">
            <dt className="text-texto-secundario">Esperado</dt>
            <dd>{formatarBRL(centavos(resultado.valorEsperadoCentavos))}</dd>
          </div>
        </dl>

        {bateu ? (
          <p className="text-valor text-sucesso">Bateu certinho ✓</p>
        ) : (
          <p className="text-valor text-perigo">
            Diferença: {sobrou ? '+' : '-'}
            {formatarBRL(centavos(Math.abs(resultado.diferencaCentavos)))}
            {sobrou ? ' (sobrou)' : ' (faltou)'}
          </p>
        )}

        <Button variante="primaria" tamanho="grande" className="w-full" onClick={aoConcluir} autoFocus>
          Concluir
        </Button>
      </div>
    </div>
  );
}
