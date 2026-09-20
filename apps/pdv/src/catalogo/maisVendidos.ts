/**
 * Atalho dos mais vendidos — o que a tela de venda oferece enquanto ninguém
 * digitou nada.
 *
 * A tela de venda passava o dia com um retângulo vazio e a frase "Pronto para
 * vender". Este módulo transforma esse vazio em trabalho: as peças que mais
 * saem no mês viram cards clicáveis, e a operadora lança as campeãs sem tocar
 * no teclado.
 *
 * TUDO AQUI RESPEITA O OFFLINE, que é a regra que rege este caixa.
 *
 * O ranking vem do servidor (só ele conhece o histórico de vendas), mas fica
 * GUARDADO no banco local. Com a internet caída, o atalho continua na tela com
 * a última lista conhecida — e uma lista de ontem é infinitamente melhor que
 * uma tela vazia. Se a busca falhar, nada acontece: o cache antigo permanece e
 * a tela não muda de comportamento.
 *
 * O que o servidor devolve é ranking de VARIANTE (por SKU). Aqui ele é
 * reagregado por PRODUTO: a operadora escolhe "Conjunto Renda", não
 * "Conjunto Renda P Preto" — a grade de tamanho e cor está no próprio card.
 */

import { clienteApi } from '../api/cliente.js';
import type { BancoLocal } from '../banco/local.js';
import { diasAtras } from '../relatorios/periodo.js';
import { agruparPorProduto, type ProdutoAgrupado } from './grade.js';

const CHAVE = 'catalogo.maisVendidos';

/**
 * Janela do ranking.
 *
 * Trinta dias porque uma loja pequena vende pouco por dia: em sete dias o
 * ranking vira ruído, e uma peça vendida duas vezes numa terça sobe ao topo.
 * Um mês já tem massa para o "mais vendido" significar alguma coisa.
 */
const JANELA_DIAS = 30;

/**
 * De quanto em quanto tempo vale a pena reconsultar.
 *
 * Ranking de trinta dias não muda em uma hora. Seis horas cobre a virada do
 * turno sem transformar a abertura da tela de venda numa chamada de rede.
 */
const VALIDADE_HORAS = 6;

/** Quantos cards cabem sem a tela virar vitrine. */
export const QUANTIDADE_PADRAO = 6;

interface RankingGuardado {
  readonly produtoIds: readonly string[];
  readonly calculadoEm: string;
}

// ---------------------------------------------------------------------------
// Regra pura
// ---------------------------------------------------------------------------

export interface LinhaVendida {
  readonly sku: string;
  readonly quantidade: number;
}

/**
 * Reagrega o ranking de variantes em ranking de produtos.
 *
 * Um produto pode aparecer várias vezes na lista do servidor — uma por
 * tamanho/cor vendido. Somar as linhas é o que faz uma peça que vendeu 3 P,
 * 3 M e 3 G ficar à frente de uma que vendeu 5 num tamanho só. Ranquear pelo
 * SKU campeão diria o contrário, e diria errado.
 *
 * SKU que não está no catálogo local é ignorado: produto desativado, ou
 * catálogo ainda sincronizando. Melhor um atalho com cinco peças do que um
 * card que não abre.
 */
export function ordenarPorProduto(
  vendidos: readonly LinhaVendida[],
  produtoPorSku: ReadonlyMap<string, string>,
): string[] {
  const somaPorProduto = new Map<string, number>();

  for (const linha of vendidos) {
    const produtoId = produtoPorSku.get(linha.sku);
    if (!produtoId) continue;
    somaPorProduto.set(produtoId, (somaPorProduto.get(produtoId) ?? 0) + linha.quantidade);
  }

  /*
   * `Map` guarda ordem de inserção e o `sort` do JS é estável — então empate
   * mantém a ordem em que o produto apareceu, que é a ordem do próprio
   * servidor. Sem isso, dois produtos com a mesma quantidade trocariam de
   * lugar entre uma abertura e outra da tela, e o atalho pareceria instável.
   */
  return [...somaPorProduto.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([produtoId]) => produtoId);
}

/** Já passou da validade? Cache ausente também conta como vencido. */
export function precisaAtualizar(
  guardado: RankingGuardado | null,
  agora = new Date(),
  validadeHoras = VALIDADE_HORAS,
): boolean {
  if (!guardado) return true;

  const calculadoEm = new Date(guardado.calculadoEm).getTime();
  if (Number.isNaN(calculadoEm)) return true;

  return agora.getTime() - calculadoEm >= validadeHoras * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Banco local
// ---------------------------------------------------------------------------

async function lerGuardado(banco: BancoLocal): Promise<RankingGuardado | null> {
  const registro = await banco.metadados.get(CHAVE);
  const valor = registro?.valor as RankingGuardado | undefined;
  return valor && Array.isArray(valor.produtoIds) ? valor : null;
}

/**
 * Monta a lista pronta para a tela, a partir do que está guardado.
 *
 * Não toca na rede. É esta função que responde quando a tela de venda abre —
 * inclusive offline, inclusive no primeiro quadro.
 */
export async function lerMaisVendidos(
  banco: BancoLocal,
  limite = QUANTIDADE_PADRAO,
): Promise<ProdutoAgrupado[]> {
  const guardado = await lerGuardado(banco);
  if (!guardado || guardado.produtoIds.length === 0) return [];

  const variantes = await banco.catalogo
    .where('produtoId')
    .anyOf([...guardado.produtoIds])
    .toArray();

  const agrupados = agruparPorProduto(variantes.filter((item) => item.ativo));

  /*
   * `agruparPorProduto` devolve na ordem do catálogo, não na do ranking. A
   * reordenação abaixo é o que faz o primeiro card ser realmente o mais
   * vendido — sem ela o atalho teria os produtos certos na ordem errada, que
   * é um erro difícil de notar e fácil de deixar passar.
   */
  const posicao = new Map(guardado.produtoIds.map((id, indice) => [id, indice]));
  return agrupados
    .sort((a, b) => (posicao.get(a.produtoId) ?? 0) - (posicao.get(b.produtoId) ?? 0))
    .slice(0, limite);
}

/**
 * Refaz o ranking a partir do servidor, se estiver vencido.
 *
 * Falha em SILÊNCIO de propósito. Offline, servidor fora, período sem venda —
 * em nenhum desses casos a tela de venda pode mudar de comportamento por
 * causa de um atalho. O cache anterior fica onde está.
 *
 * Devolve `true` quando gravou algo novo, para quem chamou saber se vale
 * reler. Não é sinal de erro: `false` é o caminho normal quando o cache ainda
 * está fresco.
 */
export async function atualizarMaisVendidos(
  banco: BancoLocal,
  agora = new Date(),
): Promise<boolean> {
  try {
    if (!precisaAtualizar(await lerGuardado(banco), agora)) return false;

    /*
     * Rota própria, de operador, sem dinheiro na resposta.
     *
     * Antes isto chamava `relatorioVendas`, que passou a exigir gerente —
     * faturamento é dado de dono. O atalho quebrou em silêncio para toda
     * operadora: a tela de venda parou de mostrar os cards e nada indicava o
     * porquê. O ranking precisa de SKU e quantidade, nunca de faturamento.
     */
    const relatorio = await clienteApi.maisVendidos(
      diasAtras(JANELA_DIAS, agora),
      diasAtras(0, agora),
    );

    const skus = relatorio.maisVendidos.map((linha) => linha.sku);
    const doCatalogo = await banco.catalogo.where('sku').anyOf(skus).toArray();
    const produtoPorSku = new Map(doCatalogo.map((item) => [item.sku, item.produtoId]));

    const produtoIds = ordenarPorProduto(relatorio.maisVendidos, produtoPorSku);

    /*
     * VENDEU MAS NÃO CASOU NENHUM: não grava, para tentar de novo depois.
     *
     * É o caixa recém-instalado. O catálogo local sincroniza em segundo plano
     * e pode chegar depois desta consulta; enquanto ele está vazio, nenhum SKU
     * do relatório encontra produto e o ranking sai vazio por falta de dado,
     * não por falta de venda. Gravar esse vazio congelaria o atalho pelas
     * próximas seis horas — a operadora abriria o caixa de manhã e passaria o
     * turno sem ele, sem nada indicando o porquê.
     *
     * A distinção é entre "o relatório não trouxe venda" e "trouxe venda que
     * eu não sei mapear". Só o primeiro é resposta; o segundo é falta de
     * catálogo, e falta de catálogo se resolve esperando.
     */
    if (produtoIds.length === 0 && relatorio.maisVendidos.length > 0) return false;

    /*
     * Grava quando a lista sai vazia POR NÃO TER VENDA. Um mês sem venda tem
     * que apagar o ranking antigo: exibir "mais vendidos" de um período que já
     * passou é pior do que não exibir nada.
     */
    await banco.metadados.put({
      chave: CHAVE,
      valor: { produtoIds, calculadoEm: agora.toISOString() } satisfies RankingGuardado,
    });
    return true;
  } catch {
    // Sem rede ou servidor fora: fica com o que já havia. A tela não muda.
    return false;
  }
}
