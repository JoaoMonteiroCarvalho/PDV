import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { ModalAutorizarGerente } from '@/telas/ModalAutorizarGerente.js';
import { ErroApi } from '@/servicos/api.js';
import {
  useDisponivelParaDevolucao,
  useRegistrarDevolucao,
  type FormaEstorno,
  type ResultadoDevolucao,
  type VendaLocalizada,
} from '@/servicos/devolucao.js';

const NOME_ESTORNO: Readonly<Record<FormaEstorno, string>> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO: 'Cartão',
  VALE_TROCA: 'Vale-troca',
};

interface Props {
  readonly venda: VendaLocalizada;
  readonly aoConcluir: () => void;
  readonly aoVoltar: () => void;
}

interface DadosConfirmados {
  readonly itens: readonly { itemVendaId: string; quantidade: number }[];
  readonly motivo: string;
  readonly formaEstorno: FormaEstorno;
  readonly totalCentavos: number;
  readonly resumoItens: string;
}

export function TelaSelecionarItens({ venda, aoConcluir, aoVoltar }: Props) {
  const { data: disponivel, isLoading, isError } = useDisponivelParaDevolucao(venda.id);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const [formaEstorno, setFormaEstorno] = useState<FormaEstorno>('DINHEIRO');
  const [erroValidacao, setErroValidacao] = useState<string | null>(null);
  const [dadosConfirmados, setDadosConfirmados] = useState<DadosConfirmados | null>(null);
  const registrar = useRegistrarDevolucao(venda.id);

  if (registrar.isSuccess) {
    return <TelaResultado resultado={registrar.data} aoConcluir={aoConcluir} />;
  }

  if (dadosConfirmados) {
    return (
      <ModalAutorizarGerente
        aberto
        titulo="Autorizar devolução"
        descricao={`Devolução de ${dadosConfirmados.resumoItens} — ${formatarBRL(centavos(dadosConfirmados.totalCentavos))} estornado em ${NOME_ESTORNO[dadosConfirmados.formaEstorno]} — ${dadosConfirmados.motivo}`}
        aoAutorizar={(gerenteId) =>
          void registrar.mutateAsync({
            itens: dadosConfirmados.itens,
            motivo: dadosConfirmados.motivo,
            formaEstorno: dadosConfirmados.formaEstorno,
            autorizadoPorId: gerenteId,
          })
        }
        aoFechar={() => setDadosConfirmados(null)}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="grid min-h-full place-items-center">
        <p className="text-corpo text-texto-secundario">Carregando itens da venda…</p>
      </div>
    );
  }

  if (isError || !disponivel) {
    return (
      <div className="grid min-h-full place-items-center">
        <p role="alert" className="text-corpo text-perigo">
          Não foi possível carregar os itens desta venda.
        </p>
      </div>
    );
  }

  function confirmar() {
    const itens = disponivel!.itens
      .map((item) => ({ item, quantidade: Number((quantidades[item.itemVendaId] ?? '').trim() || 0) }))
      .filter(({ quantidade }) => quantidade > 0);

    if (itens.length === 0) {
      setErroValidacao('Selecione ao menos um item para devolver.');
      return;
    }
    const excedente = itens.find(
      ({ item, quantidade }) => quantidade > item.quantidadeVendida - item.quantidadeJaDevolvida,
    );
    if (excedente) {
      setErroValidacao(`Quantidade de "${excedente.item.descricao}" maior que o disponível para devolução.`);
      return;
    }
    if (motivo.trim().length < 3) {
      setErroValidacao('Descreva o motivo da devolução (mínimo 3 caracteres).');
      return;
    }

    setErroValidacao(null);
    const totalCentavos = itens.reduce(
      (soma, { item, quantidade }) => soma + item.precoUnitarioLiquidoCentavos * quantidade,
      0,
    );
    const resumoItens = itens.map(({ item, quantidade }) => `${quantidade}× ${item.descricao}`).join(', ');
    setDadosConfirmados({
      itens: itens.map(({ item, quantidade }) => ({ itemVendaId: item.itemVendaId, quantidade })),
      motivo: motivo.trim(),
      formaEstorno,
      totalCentavos,
      resumoItens,
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-valor">Venda #{venda.numero}</h1>
        <p className="text-rotulo text-texto-secundario">Selecione a quantidade de cada item a devolver.</p>
      </header>

      <div className="space-y-3">
        {disponivel.itens.map((item) => {
          const disponivelUnidades = item.quantidadeVendida - item.quantidadeJaDevolvida;
          return (
            <div
              key={item.itemVendaId}
              className="flex items-center justify-between rounded-lg border border-borda bg-superficie p-4"
            >
              <div>
                <p className="text-corpo">{item.descricao}</p>
                <p className="text-rotulo text-texto-secundario">
                  {item.sku} · vendido {item.quantidadeVendida} · disponível {disponivelUnidades}
                </p>
              </div>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={disponivelUnidades}
                className="w-24 text-center"
                aria-label={`Quantidade a devolver de ${item.descricao}`}
                disabled={disponivelUnidades === 0}
                value={quantidades[item.itemVendaId] ?? ''}
                onChange={(e) => setQuantidades((atual) => ({ ...atual, [item.itemVendaId]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-rotulo text-texto-secundario">Estorno via</legend>
        <div className="flex gap-4">
          {(Object.keys(NOME_ESTORNO) as FormaEstorno[]).map((opcao) => (
            <label key={opcao} className="flex items-center gap-2 text-corpo">
              <input
                type="radio"
                name="forma-estorno"
                value={opcao}
                checked={formaEstorno === opcao}
                onChange={() => setFormaEstorno(opcao)}
              />
              {NOME_ESTORNO[opcao]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="motivo-devolucao" className="text-rotulo text-texto-secundario">
          Motivo
        </label>
        <Input id="motivo-devolucao" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>

      {erroValidacao && (
        <p role="alert" className="text-rotulo text-perigo">
          {erroValidacao}
        </p>
      )}
      {registrar.isError && (
        <p role="alert" className="text-rotulo text-perigo">
          {registrar.error instanceof ErroApi ? registrar.error.message : 'Não foi possível registrar a devolução.'}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Button variante="fantasma" onClick={aoVoltar}>
          Voltar
        </Button>
        <Button variante="perigo" onClick={confirmar}>
          Continuar
        </Button>
      </div>
    </div>
  );
}

function TelaResultado({
  resultado,
  aoConcluir,
}: {
  resultado: ResultadoDevolucao;
  aoConcluir: () => void;
}) {
  return (
    <div className="grid min-h-full place-items-center">
      <div
        role="status"
        aria-live="polite"
        className="w-[calc(100%-2rem)] max-w-sm space-y-5 rounded-lg border border-borda bg-superficie p-8 text-center"
      >
        <h1 className="text-valor">Devolução registrada</h1>
        <p className="text-valor text-sucesso">{formatarBRL(centavos(resultado.totalCentavos))} estornado</p>
        <Button variante="primaria" tamanho="grande" className="w-full" onClick={aoConcluir} autoFocus>
          Concluir
        </Button>
      </div>
    </div>
  );
}
