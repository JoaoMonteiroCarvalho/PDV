import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ModalAutorizarGerente } from '@/telas/ModalAutorizarGerente.js';
import { ErroApi } from '@/servicos/api.js';
import { useRegistrarMovimentoEstoque, type TipoMovimentoEstoque } from '@/servicos/estoque.js';

const NOME_DO_TIPO: Readonly<Record<TipoMovimentoEstoque, string>> = {
  ENTRADA_COMPRA: 'Entrada de compra',
  PERDA: 'Perda',
  AJUSTE_INVENTARIO: 'Ajuste de inventário',
};

/** PERDA e AJUSTE_INVENTARIO exigem gerente, sem alçada — mesma regra da API (validarMovimentoManualEstoque). */
function exigeGerente(tipo: TipoMovimentoEstoque): boolean {
  return tipo === 'PERDA' || tipo === 'AJUSTE_INVENTARIO';
}

const esquema = z.object({
  quantidade: z
    .string()
    .min(1, 'Informe a quantidade')
    .refine((v) => /^\d+$/.test(v.trim()), 'Use um número inteiro de unidades')
    .refine((v) => Number(v.trim()) > 0, 'A quantidade precisa ser maior que zero'),
  observacao: z.string().trim().min(3, 'Descreva o motivo (mínimo 3 caracteres)'),
});
type FormularioAjuste = z.infer<typeof esquema>;

interface Props {
  readonly varianteId: string;
  readonly descricaoVariante: string;
  readonly aoConcluir: () => void;
  readonly aoFechar: () => void;
}

/**
 * Ajuste manual de estoque em duas etapas, mesmo desenho de
 * `ModalMovimentoCaixa`: primeiro tipo + quantidade + motivo, depois — só
 * quando o tipo exige — autorização de gerente mostrando exatamente o que
 * vai mudar. Entrada de compra não pede gerente e grava direto.
 */
export function ModalAjusteEstoque({ varianteId, descricaoVariante, aoConcluir, aoFechar }: Props) {
  const [tipo, setTipo] = useState<TipoMovimentoEstoque>('ENTRADA_COMPRA');
  const [dadosConfirmados, setDadosConfirmados] = useState<{ quantidade: number; observacao: string } | null>(
    null,
  );
  const registrar = useRegistrarMovimentoEstoque(varianteId);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioAjuste>({ resolver: zodResolver(esquema) });

  const sinal = tipo === 'PERDA' ? -1 : 1;

  async function gravar(quantidadeAssinada: number, observacao: string, autorizadoPorId?: string) {
    await registrar.mutateAsync({
      tipo,
      quantidade: quantidadeAssinada,
      observacao,
      ...(autorizadoPorId !== undefined && { autorizadoPorId }),
    });
    aoConcluir();
  }

  async function autorizado(gerenteId: string) {
    if (!dadosConfirmados) return;
    await gravar(dadosConfirmados.quantidade * sinal, dadosConfirmados.observacao, gerenteId);
  }

  async function confirmarFormulario(dados: FormularioAjuste) {
    const quantidade = Number(dados.quantidade.trim());
    const observacao = dados.observacao.trim();
    // Entrada de compra é documentada pela própria nota/recibo — não exige
    // gerente, grava direto (ver validarMovimentoManualEstoque em @pdv/shared).
    if (!exigeGerente(tipo)) {
      await gravar(quantidade * sinal, observacao);
      return;
    }
    setDadosConfirmados({ quantidade, observacao });
  }

  if (dadosConfirmados) {
    return (
      <ModalAutorizarGerente
        aberto
        titulo={`Autorizar ${NOME_DO_TIPO[tipo].toLowerCase()}`}
        descricao={`${NOME_DO_TIPO[tipo]} de ${dadosConfirmados.quantidade} un. em ${descricaoVariante} — ${dadosConfirmados.observacao}`}
        aoAutorizar={(gerenteId) => void autorizado(gerenteId)}
        aoFechar={() => setDadosConfirmados(null)}
      />
    );
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg border border-borda bg-superficie p-8"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById('ajuste-quantidade')?.focus();
          }}
        >
          <Dialog.Title className="text-valor">Ajustar estoque</Dialog.Title>
          <Dialog.Description className="text-corpo text-texto-secundario">{descricaoVariante}</Dialog.Description>

          <form onSubmit={(e) => void handleSubmit(confirmarFormulario)(e)} className="space-y-5">
            <fieldset className="space-y-1.5">
              <legend className="text-rotulo text-texto-secundario">Tipo</legend>
              <div className="flex flex-col gap-2">
                {(Object.keys(NOME_DO_TIPO) as TipoMovimentoEstoque[]).map((opcao) => (
                  <label key={opcao} className="flex items-center gap-2 text-corpo">
                    <input
                      type="radio"
                      name="tipo-ajuste"
                      value={opcao}
                      checked={tipo === opcao}
                      onChange={() => setTipo(opcao)}
                    />
                    {NOME_DO_TIPO[opcao]}
                    {exigeGerente(opcao) && (
                      <span className="text-rotulo text-texto-secundario">(exige gerente)</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor="ajuste-quantidade" className="text-rotulo text-texto-secundario">
                Quantidade (unidades)
              </label>
              <Input
                id="ajuste-quantidade"
                inputMode="numeric"
                placeholder="0"
                className="text-valor"
                invalido={!!errors.quantidade}
                {...register('quantidade')}
              />
              {errors.quantidade && <p className="text-rotulo text-perigo">{errors.quantidade.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ajuste-observacao" className="text-rotulo text-texto-secundario">
                Motivo
              </label>
              <Input
                id="ajuste-observacao"
                placeholder={tipo === 'ENTRADA_COMPRA' ? 'Ex.: compra avulsa' : 'Ex.: peça rasgada'}
                invalido={!!errors.observacao}
                {...register('observacao')}
              />
              {errors.observacao && <p className="text-rotulo text-perigo">{errors.observacao.message}</p>}
            </div>

            {registrar.isError && (
              <p role="alert" className="text-rotulo text-perigo">
                {registrar.error instanceof ErroApi ? registrar.error.message : 'Não foi possível registrar.'}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button type="button" variante="fantasma">
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variante="primaria">
                Continuar
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
