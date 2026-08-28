/**
 * Carrinho da venda em andamento.
 *
 * Estado imutável e funções puras: cada operação devolve um estado novo. Isso
 * torna o comportamento testável sem React e evita a classe de bug em que dois
 * componentes mutam o mesmo array de itens.
 *
 * PONTO CRÍTICO: o cálculo NÃO é reimplementado aqui. `calcularVenda` vem de
 * `@pdv/shared` — exatamente o mesmo código que o servidor executa. Se o caixa
 * tivesse a própria conta de rateio de desconto, o total impresso no
 * comprovante poderia divergir do total gravado no servidor, e a loja só
 * descobriria no fechamento do caixa.
 */

import {
  type Centavos,
  type ItemEntrada,
  type PagamentoEntrada,
  type VendaCalculada,
  ZERO,
  calcularVenda,
  centavos,
  somar,
  subtrair,
  validarPagamentos,
} from '@pdv/shared';

export interface ItemCarrinho {
  readonly varianteId: string;
  readonly sku: string;
  readonly nome: string;
  readonly tamanho: string | null;
  readonly cor: string | null;
  readonly precoUnitarioCentavos: Centavos;
  readonly quantidade: number;
  readonly descontoCentavos: Centavos;
}

export interface EstadoCarrinho {
  readonly itens: readonly ItemCarrinho[];
  readonly descontoSobreTotalCentavos: Centavos;
}

export const CARRINHO_VAZIO: EstadoCarrinho = {
  itens: [],
  descontoSobreTotalCentavos: ZERO,
};

/** Produto vindo do catálogo local, no formato que o carrinho aceita. */
export interface ProdutoParaVenda {
  readonly id: string;
  readonly sku: string;
  readonly nome: string;
  readonly tamanho: string | null;
  readonly cor: string | null;
  readonly precoCentavos: number;
}

/**
 * Adiciona um produto. Bipar o mesmo código duas vezes soma na quantidade em
 * vez de criar duas linhas — é o que a operadora espera ao passar duas peças
 * iguais pelo leitor.
 */
export function adicionar(
  estado: EstadoCarrinho,
  produto: ProdutoParaVenda,
  quantidade = 1,
): EstadoCarrinho {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new Error(`Quantidade deve ser inteiro positivo, recebido ${quantidade}`);
  }

  const existente = estado.itens.findIndex((item) => item.varianteId === produto.id);
  if (existente >= 0) {
    return alterarQuantidade(
      estado,
      produto.id,
      estado.itens[existente]!.quantidade + quantidade,
    );
  }

  const novo: ItemCarrinho = {
    varianteId: produto.id,
    sku: produto.sku,
    nome: produto.nome,
    tamanho: produto.tamanho,
    cor: produto.cor,
    precoUnitarioCentavos: centavos(produto.precoCentavos),
    quantidade,
    descontoCentavos: ZERO,
  };
  return { ...estado, itens: [...estado.itens, novo] };
}

/** Quantidade zero remove o item — é como a operadora "apaga" uma linha. */
export function alterarQuantidade(
  estado: EstadoCarrinho,
  varianteId: string,
  quantidade: number,
): EstadoCarrinho {
  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw new Error(`Quantidade deve ser inteiro não negativo, recebido ${quantidade}`);
  }
  if (quantidade === 0) return remover(estado, varianteId);

  return {
    ...estado,
    itens: estado.itens.map((item) =>
      item.varianteId === varianteId
        ? {
            ...item,
            quantidade,
            // O desconto do item some ao mudar a quantidade: um desconto de
            // R$ 10 dado sobre 1 peça não deve continuar valendo sobre 5.
            descontoCentavos: ZERO,
          }
        : item,
    ),
  };
}

export function remover(estado: EstadoCarrinho, varianteId: string): EstadoCarrinho {
  return {
    ...estado,
    itens: estado.itens.filter((item) => item.varianteId !== varianteId),
  };
}

export function definirDescontoDoItem(
  estado: EstadoCarrinho,
  varianteId: string,
  desconto: Centavos,
): EstadoCarrinho {
  return {
    ...estado,
    itens: estado.itens.map((item) =>
      item.varianteId === varianteId ? { ...item, descontoCentavos: desconto } : item,
    ),
  };
}

export function definirDescontoDoTotal(
  estado: EstadoCarrinho,
  desconto: Centavos,
): EstadoCarrinho {
  return { ...estado, descontoSobreTotalCentavos: desconto };
}

export function limpar(): EstadoCarrinho {
  return CARRINHO_VAZIO;
}

/** Total de peças, para o contador na tela. */
export function totalDePecas(estado: EstadoCarrinho): number {
  return estado.itens.reduce((total, item) => total + item.quantidade, 0);
}

/**
 * Calcula os totais. Mesmo código do servidor — o comprovante impresso e o
 * registro no banco não têm como divergir.
 */
export function calcular(estado: EstadoCarrinho): VendaCalculada {
  const itens: ItemEntrada[] = estado.itens.map((item) => ({
    varianteId: item.varianteId,
    quantidade: item.quantidade,
    precoUnitarioCentavos: item.precoUnitarioCentavos,
    descontoCentavos: item.descontoCentavos,
  }));
  return calcularVenda(itens, estado.descontoSobreTotalCentavos);
}

/**
 * Quanto ainda falta receber, dado o que já foi lançado em pagamentos.
 *
 * Usa o LÍQUIDO (recebido − troco), não o bruto. Um pagamento em dinheiro de
 * R$ 100 para uma venda de R$ 50 gera R$ 50 de troco; o líquido que efetivamente
 * quita a venda é R$ 50, não R$ 100. Usar o bruto aqui faria o saldo ficar
 * negativo sempre que houvesse troco, e o botão de finalizar (que exige
 * `saldo === 0`) nunca habilitaria.
 */
export function saldoAPagar(
  venda: VendaCalculada,
  pagamentos: readonly PagamentoEntrada[],
): Centavos {
  const recebido = somar(...pagamentos.map((pagamento) => pagamento.valorCentavos));
  const troco = somar(...pagamentos.map((pagamento) => pagamento.trocoCentavos));
  return subtrair(venda.totalCentavos, subtrair(recebido, troco));
}

/**
 * Troco sugerido quando o cliente paga em dinheiro acima do saldo.
 * Nunca negativo: se falta dinheiro, o troco é zero e o saldo é que fica.
 */
export function calcularTroco(
  venda: VendaCalculada,
  pagamentos: readonly PagamentoEntrada[],
): Centavos {
  const recebido = somar(...pagamentos.map((pagamento) => pagamento.valorCentavos));
  const excedente = recebido - venda.totalCentavos;
  return centavos(Math.max(0, excedente));
}

export interface DadosFechamento {
  readonly sessaoCaixaId: string;
  readonly pagamentos: readonly PagamentoEntrada[];
  readonly clienteId?: string | undefined;
  readonly autorizadoPorId?: string | undefined;
  readonly crediario?:
    | { readonly quantidadeParcelas: number; readonly primeiroVencimento: Date }
    | undefined;
}

export interface VendaFechada {
  /** UUID gerado AQUI, antes de qualquer rede. Chave de idempotência. */
  readonly id: string;
  readonly corpo: Record<string, unknown>;
  readonly calculo: VendaCalculada;
}

/**
 * Fecha a venda e monta o corpo do POST /vendas.
 *
 * Valida os pagamentos ANTES de devolver, com a mesma função do servidor.
 * Isso importa porque o próximo passo é imprimir: uma venda que o servidor
 * recusaria não pode chegar à impressora, senão vira pendência bloqueada na
 * fila com o comprovante já na mão da cliente.
 */
export function fecharVenda(
  estado: EstadoCarrinho,
  dados: DadosFechamento,
  gerarId: () => string = () => crypto.randomUUID(),
  agora: () => Date = () => new Date(),
): VendaFechada {
  const calculo = calcular(estado);

  validarPagamentos(calculo, dados.pagamentos, {
    clienteId: dados.clienteId,
  });

  const id = gerarId();

  return {
    id,
    calculo,
    corpo: {
      id,
      sessaoCaixaId: dados.sessaoCaixaId,
      criadaEmCliente: agora().toISOString(),
      clienteId: dados.clienteId,
      autorizadoPorId: dados.autorizadoPorId,
      descontoSobreTotalCentavos: estado.descontoSobreTotalCentavos,
      itens: estado.itens.map((item) => ({
        varianteId: item.varianteId,
        quantidade: item.quantidade,
        precoUnitarioCentavos: item.precoUnitarioCentavos,
        descontoCentavos: item.descontoCentavos,
      })),
      pagamentos: dados.pagamentos.map((pagamento) => ({
        forma: pagamento.forma,
        valorCentavos: pagamento.valorCentavos,
        trocoCentavos: pagamento.trocoCentavos,
      })),
      crediario: dados.crediario
        ? {
            quantidadeParcelas: dados.crediario.quantidadeParcelas,
            primeiroVencimento: dados.crediario.primeiroVencimento.toISOString(),
          }
        : undefined,
    },
  };
}
