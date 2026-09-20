/**
 * Quem pode ser marcado como vendedora numa venda.
 *
 * Guardada em memória e no `localStorage`, pelo mesmo motivo dos dados da loja
 * (`impressao/loja.ts`): a venda fecha OFFLINE, e escolher quem atendeu não
 * pode depender de uma chamada de rede com a cliente esperando no balcão.
 *
 * A lista é atualizada sempre que o app consegue falar com o servidor. Se
 * nunca conseguiu, o caixa ainda funciona — só não oferece troca de vendedora,
 * e a venda sai no nome de quem está logada. Degradar assim é melhor que
 * bloquear a venda.
 */

import { clienteApi, type Vendedor } from '../api/cliente.js';

const CHAVE = 'pdv.vendedores';

let emMemoria: Vendedor[] = lerDoArmazenamento();

function lerDoArmazenamento(): Vendedor[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return [];
    const salvo = JSON.parse(bruto) as unknown;
    // Confere o formato: um `localStorage` de versão antiga do app não pode
    // derrubar a tela de venda.
    if (!Array.isArray(salvo)) return [];
    return salvo.filter(
      (item): item is Vendedor =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Vendedor).id === 'string' &&
        typeof (item as Vendedor).nome === 'string',
    );
  } catch {
    return [];
  }
}

/** O que o caixa tem agora, sem rede. */
export function lerVendedores(): Vendedor[] {
  return emMemoria;
}

/**
 * Busca a lista no servidor e guarda. Falha em silêncio de propósito: não
 * conseguir atualizar a lista de vendedoras não é motivo para avisar a
 * operadora de nada — ela continua vendendo.
 */
export async function sincronizarVendedores(): Promise<void> {
  try {
    const lista = await clienteApi.listarVendedores();
    emMemoria = lista;
    localStorage.setItem(CHAVE, JSON.stringify(lista));
  } catch {
    // Mantém o que já estava guardado.
  }
}
