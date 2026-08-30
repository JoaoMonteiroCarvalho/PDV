import { api, ErroApi } from '@/servicos/api.js';
import type { RegistrarVendaEntrada, RespostaVenda } from '@/servicos/vendas.js';
import { bancoLocal, type VendaNaFila } from './db.js';

/**
 * Motor de sincronização da fila de vendas.
 *
 * A regra que este arquivo inteiro existe para cumprir: TODA venda grava no
 * Dexie primeiro (`enfileirarVenda`), e o registro só sai do estado
 * "pendente" quando o servidor de fato confirma. Se a rede cair no meio de
 * uma venda, ela já está salva localmente — o caixa nunca fica esperando o
 * servidor pra terminar de atender o cliente.
 *
 * Reenvio automático em três gatilhos:
 *   1. na hora, assim que a venda é enfileirada (rede pode estar ótima);
 *   2. a cada `INTERVALO_MS`, pra pendências antigas não ficarem esquecidas;
 *   3. no evento `online` do navegador, pra não esperar o próximo tick
 *      depois que a conexão volta.
 */

const INTERVALO_MS = 8_000;

export async function enfileirarVenda(payload: RegistrarVendaEntrada): Promise<VendaNaFila> {
  const registro: VendaNaFila = {
    id: payload.id,
    status: 'pendente',
    payload,
    tentativas: 0,
    criadaEm: new Date().toISOString(),
  };
  await bancoLocal.filaVendas.put(registro);
  void processarFila();
  return registro;
}

async function enviarUmaVenda(item: VendaNaFila): Promise<void> {
  await bancoLocal.filaVendas.update(item.id, { status: 'enviando' });
  try {
    const resultado = await api<RespostaVenda>('/vendas', {
      metodo: 'POST',
      corpo: item.payload,
      // Sem isto, uma conexão travada (não recusada, só muda) prenderia a
      // trava global do motor pra sempre e a fila inteira pararia de
      // avançar até a página ser recarregada.
      timeoutMs: 15_000,
    });
    // Não zero `ultimoErro` aqui: com `exactOptionalPropertyTypes`, o Dexie
    // não aceita `undefined` como forma de limpar um campo opcional. Sem
    // problema — com status "sincronizada" o erro antigo nunca é exibido.
    await bancoLocal.filaVendas.update(item.id, {
      status: 'sincronizada',
      numero: resultado.numero,
    });
  } catch (erro) {
    // Erro de REGRA DE NEGÓCIO (4xx com código conhecido) não vai se resolver
    // tentando de novo — mas ainda assim fica visível como "erro" na fila em
    // vez de sumir, porque a venda aconteceu de verdade no mundo real e
    // alguém (o gerente) precisa decidir o que fazer com ela.
    const mensagem =
      erro instanceof ErroApi ? erro.message : 'Falha de rede — tentando novamente automaticamente.';
    await bancoLocal.filaVendas.update(item.id, {
      status: 'erro',
      tentativas: item.tentativas + 1,
      ultimoErro: mensagem,
    });
  }
}

let processandoAgora = false;

/** Reenvia tudo que está pendente ou com erro. Evita rodar duas vezes ao mesmo tempo. */
export async function processarFila(): Promise<void> {
  if (processandoAgora) return;
  processandoAgora = true;
  try {
    const pendentes = await bancoLocal.filaVendas.where('status').anyOf('pendente', 'erro').toArray();
    // Em série, não em paralelo: preserva a ordem em que as vendas
    // aconteceram e evita disparar dezenas de requisições de uma vez se o
    // caixa ficou offline por horas.
    for (const item of pendentes) {
      await enviarUmaVenda(item);
    }
  } finally {
    processandoAgora = false;
  }
}

let motorIniciado = false;

/**
 * Chamar uma vez, no topo do app (App.tsx). A primeira chamada a
 * `processarFila()` aqui É a "retomada da fila" — reenvia sozinho qualquer
 * venda que ficou pendente de uma sessão anterior (página recarregada,
 * navegador fechado com o caixa offline).
 */
export function iniciarMotorSincronizacao(): void {
  if (motorIniciado) return;
  motorIniciado = true;

  void processarFila();
  setInterval(() => void processarFila(), INTERVALO_MS);
  window.addEventListener('online', () => void processarFila());
}
