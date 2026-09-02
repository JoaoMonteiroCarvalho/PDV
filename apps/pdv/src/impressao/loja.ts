/**
 * Identificação da loja no comprovante.
 *
 * Vem do servidor (`GET /configuracao`), cadastrada em Configurações. Era fixa
 * no código até a Fase 11 — este arquivo dizia "provisório", e deixou de ser.
 *
 * Guardada em memória e também no `localStorage`: o comprovante é impresso a
 * cada venda, inclusive OFFLINE, e não pode depender de uma chamada de rede no
 * momento em que a cliente está esperando o papel. A cópia local é atualizada
 * sempre que o app consegue falar com o servidor.
 */

import { clienteApi, type ConfiguracaoLoja } from '../api/cliente.js';
import type { DadosLoja } from './comprovante.js';

const CHAVE = 'pdv.loja';

/**
 * Usado antes da primeira sincronização e quando o `localStorage` está
 * indisponível. "Loja" sem endereço nem CNPJ é honesto: melhor um comprovante
 * genérico do que um com dado inventado.
 */
const PADRAO: DadosLoja = {
  nome: 'Loja',
  endereco: undefined,
  telefone: undefined,
  cnpj: undefined,
};

let emMemoria: DadosLoja = lerDoArmazenamento() ?? PADRAO;
/** Linha extra da política, definida pela loja. As regras legais são fixas. */
let politicaExtra: string | null = lerPoliticaDoArmazenamento();

function lerDoArmazenamento(): DadosLoja | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const salvo = JSON.parse(bruto) as ConfiguracaoLoja;
    return converter(salvo);
  } catch {
    return null;
  }
}

function lerPoliticaDoArmazenamento(): string | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    return (JSON.parse(bruto) as ConfiguracaoLoja).politicaTrocaExtra ?? null;
  } catch {
    return null;
  }
}

/** `null` do servidor vira `undefined`: o comprovante testa presença. */
function converter(configuracao: ConfiguracaoLoja): DadosLoja {
  return {
    nome: configuracao.nome,
    endereco: configuracao.endereco ?? undefined,
    telefone: configuracao.telefone ?? undefined,
    cnpj: configuracao.cnpj ?? undefined,
  };
}

/** Os dados que o comprovante usa AGORA — síncrono, nunca espera rede. */
export function lojaAtual(): DadosLoja {
  return emMemoria;
}

export function politicaTrocaDaLoja(): string | null {
  return politicaExtra;
}

/** Atualiza a cópia local. Chamado no Shell e ao salvar em Configurações. */
export function guardarLoja(configuracao: ConfiguracaoLoja): void {
  emMemoria = converter(configuracao);
  politicaExtra = configuracao.politicaTrocaExtra ?? null;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(configuracao));
  } catch {
    // Sem persistência a configuração vale para esta sessão — aceitável.
  }
}

/**
 * Busca no servidor e atualiza a cópia local.
 *
 * Falha em silêncio de propósito: o caixa continua vendendo e imprimindo com o
 * que já tem. Um erro aqui não pode interromper venda.
 */
export async function sincronizarLoja(): Promise<void> {
  try {
    guardarLoja(await clienteApi.obterConfiguracaoLoja());
  } catch {
    // Offline ou servidor fora: mantém a última configuração conhecida.
  }
}
