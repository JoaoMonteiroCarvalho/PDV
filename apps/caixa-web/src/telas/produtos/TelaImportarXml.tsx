import { zodResolver } from '@hookform/resolvers/zod';
import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ErroApi } from '@/servicos/api.js';
import {
  useConfirmarImportacaoXml,
  usePreVisualizarImportacaoXml,
  type PreviaImportacao,
} from '@/servicos/importacaoXml.js';

function paraCentavos(valor: string): number {
  return Math.round(Number(valor.trim().replace(',', '.')) * 100);
}

function sugerirSku(descricao: string, indice: number): string {
  const base = descricao
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toUpperCase()
    .slice(0, 20);
  return `${base || 'ITEM'}-${indice + 1}`;
}

const esquemaRevisao = z.object({
  itens: z.array(
    z.object({
      nome: z.string().trim().optional(),
      sku: z.string().trim().optional(),
      preco: z
        .string()
        .optional()
        .refine((v) => !v || /^\d+([.,]\d{1,2})?$/.test(v.trim()), 'Use um valor em reais, ex.: 59,90'),
    }),
  ),
});
type FormularioRevisao = z.infer<typeof esquemaRevisao>;

interface Props {
  readonly aoVoltar: () => void;
}

/**
 * Importação de NF-e em três passos visíveis: colar o XML (nada gravado
 * ainda), revisar item a item (produto novo precisa de nome + preço de
 * venda — a nota só traz custo), confirmar (grava tudo).
 */
export function TelaImportarXml({ aoVoltar }: Props) {
  const [xml, setXml] = useState('');
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null);
  const preVisualizar = usePreVisualizarImportacaoXml();
  const confirmar = useConfirmarImportacaoXml();

  const { control, register, handleSubmit, formState: { errors } } = useForm<FormularioRevisao>({
    resolver: zodResolver(esquemaRevisao),
    values: previa
      ? {
          itens: previa.itens.map((item, indice) => ({
            nome: item.nomeExistente ?? item.descricao,
            sku: item.skuExistente ?? sugerirSku(item.descricao, indice),
            preco: '',
          })),
        }
      : { itens: [] },
  });
  const { fields } = useFieldArray({ control, name: 'itens' });

  async function analisar() {
    if (!xml.trim()) return;
    const resultado = await preVisualizar.mutateAsync(xml);
    setPrevia(resultado);
  }

  async function confirmarImportacao(dados: FormularioRevisao) {
    if (!previa) return;
    const itens = previa.itens.map((item, indice) => {
      const linha = dados.itens[indice];
      if (item.varianteExistenteId) {
        return {
          varianteId: item.varianteExistenteId,
          quantidade: item.quantidade,
          custoUnitarioCentavos: item.custoUnitarioCentavos,
        };
      }
      return {
        ...(item.codigoBarras && { codigoBarras: item.codigoBarras }),
        produtoNovo: {
          nome: (linha?.nome ?? item.descricao).trim(),
          sku: (linha?.sku ?? sugerirSku(item.descricao, indice)).trim(),
          precoCentavos: paraCentavos(linha?.preco ?? '0'),
        },
        quantidade: item.quantidade,
        custoUnitarioCentavos: item.custoUnitarioCentavos,
      };
    });
    await confirmar.mutateAsync({ ...(previa.numeroNota && { numeroNota: previa.numeroNota }), itens });
  }

  if (confirmar.isSuccess) {
    return (
      <div className="mx-auto max-w-md space-y-5 p-6 text-center">
        <h1 className="text-valor">Importação concluída</h1>
        <p className="text-corpo">{confirmar.data.movimentosCriados} movimentos de estoque criados.</p>
        <Button variante="primaria" tamanho="grande" className="w-full" onClick={aoVoltar} autoFocus>
          Voltar para produtos
        </Button>
      </div>
    );
  }

  if (previa) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <header className="space-y-1">
          <h1 className="text-valor">Revisar importação</h1>
          <p className="text-rotulo text-texto-secundario">
            {previa.numeroNota ? `Nota ${previa.numeroNota} — ` : ''}
            Itens já cadastrados aparecem casados pelo código de barras. Itens novos precisam de nome e preço de
            venda — a nota só traz o custo.
          </p>
        </header>

        <form onSubmit={(e) => void handleSubmit(confirmarImportacao)(e)} className="space-y-4">
          {fields.map((campo, indice) => {
            const item = previa.itens[indice]!;
            const existente = !!item.varianteExistenteId;
            return (
              <div key={campo.id} className="rounded-lg border border-borda bg-superficie p-4">
                <div className="flex items-center justify-between text-rotulo text-texto-secundario">
                  <span>{item.descricao}</span>
                  <span>
                    {item.quantidade} un. · custo {formatarBRL(centavos(item.custoUnitarioCentavos))}/un.
                  </span>
                </div>

                {existente ? (
                  <p className="mt-2 text-corpo">
                    Casado com <strong>{item.nomeExistente}</strong> ({item.skuExistente})
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor={`nome-${indice}`} className="text-rotulo text-texto-secundario">
                        Nome do produto novo
                      </label>
                      <Input id={`nome-${indice}`} {...register(`itens.${indice}.nome`)} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`sku-${indice}`} className="text-rotulo text-texto-secundario">
                        SKU
                      </label>
                      <Input id={`sku-${indice}`} {...register(`itens.${indice}.sku`)} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`preco-${indice}`} className="text-rotulo text-texto-secundario">
                        Preço de venda (R$)
                      </label>
                      <Input
                        id={`preco-${indice}`}
                        inputMode="decimal"
                        placeholder="0,00"
                        invalido={!!errors.itens?.[indice]?.preco}
                        {...register(`itens.${indice}.preco`)}
                      />
                      {errors.itens?.[indice]?.preco && (
                        <p className="text-rotulo text-perigo">{errors.itens[indice]?.preco?.message}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {confirmar.isError && (
            <p role="alert" className="text-rotulo text-perigo">
              {confirmar.error instanceof ErroApi ? confirmar.error.message : 'Não foi possível confirmar a importação.'}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variante="fantasma" onClick={() => setPrevia(null)}>
              Voltar
            </Button>
            <Button type="submit" variante="primaria" disabled={confirmar.isPending}>
              {confirmar.isPending ? 'Confirmando…' : 'Confirmar importação'}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-valor">Importar XML de NF-e</h1>
        <p className="text-rotulo text-texto-secundario">
          Cole o conteúdo do XML da nota de compra. Nada é gravado até você revisar e confirmar.
        </p>
      </header>

      <input
        type="file"
        accept=".xml,text/xml"
        aria-label="Carregar arquivo XML"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          if (!arquivo) return;
          void arquivo.text().then(setXml);
        }}
      />

      <textarea
        value={xml}
        onChange={(e) => setXml(e.target.value)}
        placeholder="Cole o XML aqui…"
        rows={10}
        className="w-full rounded border border-borda bg-fundo p-3 text-rotulo text-texto"
      />

      {preVisualizar.isError && (
        <p role="alert" className="text-rotulo text-perigo">
          {preVisualizar.error instanceof ErroApi ? preVisualizar.error.message : 'Não foi possível ler o XML.'}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Button variante="fantasma" onClick={aoVoltar}>
          Voltar
        </Button>
        <Button variante="primaria" onClick={() => void analisar()} disabled={preVisualizar.isPending}>
          {preVisualizar.isPending ? 'Analisando…' : 'Analisar'}
        </Button>
      </div>
    </div>
  );
}
