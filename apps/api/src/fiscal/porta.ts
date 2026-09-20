/**
 * A PORTA do documento fiscal.
 *
 * Esta versão do PDV **não emite NFC-e**: imprime comprovante não fiscal. O
 * que existe aqui é o encaixe — a fronteira pela qual um emissor real entra
 * um dia, sem que `registrar-venda.ts` precise ser reescrito.
 *
 * Por que a porta existe antes do emissor:
 *
 *   Sem ela, ligar o fiscal significaria abrir o serviço que registra a venda
 *   — o código mais sensível do sistema, o que decide dinheiro — e costurar
 *   chamadas de rede no meio de uma transação que hoje é toda local. Seria
 *   uma cirurgia no coração do PDV feita sob pressão de prazo fiscal. Com a
 *   porta, ligar vira trocar `emissorDesligado` por outra implementação.
 *
 * Duas regras que qualquer implementação desta porta precisa respeitar, e que
 * são a razão de o contrato ter a forma que tem:
 *
 *   1. **A VENDA JÁ ACONTECEU.** Quando esta porta é chamada, o dinheiro
 *      entrou na gaveta, o comprovante foi impresso e a cliente foi embora. A
 *      SEFAZ fora do ar não desfaz nada disso. Por isso `emitir` NUNCA lança
 *      para cancelar a venda: ela devolve uma SITUAÇÃO, e indisponibilidade é
 *      uma situação normal, prevista, não uma exceção.
 *
 *   2. **A emissão acontece FORA da transação da venda.** Amarrar uma chamada
 *      de rede à transação que grava a venda significaria manter uma transação
 *      de banco aberta pelo tempo de resposta da SEFAZ — e, no timeout,
 *      desfazer o registro de uma venda que existe no mundo real.
 */

/** Item como o fisco o vê: com os campos tributários do produto. */
export interface ItemParaFiscal {
  readonly sequencia: number;
  readonly descricao: string;
  readonly sku: string;
  readonly quantidade: number;
  readonly precoUnitarioCentavos: number;
  /** Já líquido do desconto rateado — é sobre ele que o imposto incide. */
  readonly totalCentavos: number;
  /**
   * Campos fiscais do produto, como estavam no momento da venda.
   *
   * Nuláveis de propósito: o regime tributário ainda não foi definido pelo
   * contador, e a loja vai preenchendo conforme cadastra. Um emissor real
   * precisa decidir o que fazer com o que vier vazio — recusar, usar padrão
   * da loja — e essa decisão é dele, não desta porta.
   */
  readonly ncm: string | null;
  readonly cest: string | null;
  readonly origem: number | null;
  /** CSOSN (Simples) ou CST (Presumido) — string livre até o regime ser definido. */
  readonly situacaoTributaria: string | null;
}

export interface PagamentoParaFiscal {
  readonly forma: 'DINHEIRO' | 'DEBITO' | 'CREDITO' | 'PIX' | 'CREDIARIO';
  readonly valorCentavos: number;
  readonly trocoCentavos: number;
  readonly bandeira: string | null;
  readonly parcelasCartao: number | null;
}

export interface VendaParaFiscal {
  readonly vendaId: string;
  /** Sequencial da loja. Não é o número do documento fiscal. */
  readonly numero: number;
  readonly registradaEm: Date;
  readonly subtotalCentavos: number;
  readonly descontoCentavos: number;
  readonly totalCentavos: number;
  readonly itens: readonly ItemParaFiscal[];
  readonly pagamentos: readonly PagamentoParaFiscal[];
  /** Só quando a cliente se identificou. NFC-e sem CPF é o caso normal. */
  readonly cliente: { readonly nome: string; readonly cpf: string | null } | null;
}

/**
 * Desfecho da tentativa de emissão.
 *
 * `INDISPONIVEL` é separado de `REJEITADO` porque o que a loja faz depois é
 * diferente: rejeição é erro de dado que alguém precisa corrigir; SEFAZ fora
 * do ar é esperar e tentar de novo — ou entrar em contingência. Juntar os dois
 * num "falhou" obrigaria a ler a mensagem para saber o que fazer.
 */
export type ResultadoFiscal =
  | { readonly situacao: 'DESLIGADO' }
  | {
      readonly situacao: 'AUTORIZADO';
      readonly chaveAcesso: string;
      readonly protocolo: string;
    }
  | { readonly situacao: 'REJEITADO'; readonly codigo: string; readonly motivo: string }
  | { readonly situacao: 'INDISPONIVEL'; readonly motivo: string };

export interface EmissorFiscal {
  /**
   * Quando false, `registrar-venda` sequer monta o payload fiscal — nenhuma
   * consulta a mais roda no caminho da venda. É o que sustenta a promessa de
   * que o módulo desligado não custa nada.
   */
  readonly habilitado: boolean;

  /**
   * Emite o documento da venda.
   *
   * O contrato é: **não lança para recusar a venda**. Falha de rede, timeout
   * e recusa da SEFAZ viram `INDISPONIVEL` ou `REJEITADO`. Quem chama trata a
   * situação como dado, não como exceção.
   */
  emitir(venda: VendaParaFiscal): Promise<ResultadoFiscal>;
}
