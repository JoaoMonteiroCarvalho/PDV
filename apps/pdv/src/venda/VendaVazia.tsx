/**
 * O que a tela de venda mostra enquanto ninguém digitou nada.
 *
 * Antes era só a frase "Pronto para vender" no meio de um retângulo enorme.
 * Agora esse espaço trabalha: traz as peças que mais saíram no mês como cards
 * clicáveis, iguais aos do resultado de busca — a operadora lança a campeã do
 * mês sem tocar no teclado.
 *
 * Os dois estados são diferentes de propósito:
 *
 *   - SEM ranking (loja nova, mês sem venda, catálogo ainda sincronizando) a
 *     tela volta a ser a mensagem centrada. Nada de moldura vazia, nada de
 *     esqueleto cinza esperando dado que talvez nunca chegue.
 *   - COM ranking, a mensagem encolhe e sobe: ela deixa de ser o assunto da
 *     tela e vira legenda do que está embaixo.
 */

import { useEffect, useState } from 'react';
import { bancoLocal, type ItemCatalogo } from '../banco/local.js';
import { atualizarMaisVendidos, lerMaisVendidos } from '../catalogo/maisVendidos.js';
import type { ProdutoAgrupado } from '../catalogo/grade.js';
import { CardProduto, LegendaGrade } from './CardProduto.js';

export function VendaVazia({
  aoAdicionar,
}: {
  aoAdicionar: (variante: ItemCatalogo) => void;
}) {
  const [populares, setPopulares] = useState<ProdutoAgrupado[]>([]);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      /*
       * Lê o cache ANTES de pensar em rede. Se houver ranking guardado, ele
       * aparece no primeiro quadro — offline inclusive. A consulta ao
       * servidor vem depois e só para manter a lista fresca.
       */
      const guardado = await lerMaisVendidos(bancoLocal);
      if (vivo && guardado.length > 0) setPopulares(guardado);

      const mudou = await atualizarMaisVendidos(bancoLocal);
      if (vivo && mudou) setPopulares(await lerMaisVendidos(bancoLocal));
    })();

    return () => {
      vivo = false;
    };
  }, []);

  if (populares.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div className="max-w-[380px]">
          <p className="font-titulo text-[17px] text-ink-soft">Pronto para vender</p>
          <p className="mt-2 text-[14px] text-ink-faint">
            Bipe o código de barras ou digite o nome da peça. A grade de tamanho e cor aparece no
            próprio resultado — não precisa abrir cada variação.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-5">
        <p className="font-titulo text-[19px] text-ink">Pronto para vender</p>
        <p className="mt-1 text-[14px] text-ink-faint">
          Bipe o código de barras ou digite o nome da peça. Abaixo, o que mais saiu nos últimos 30
          dias — clique na grade para lançar direto.
        </p>
      </div>

      {/*
        O filete de ouro separa a instrução do atalho, do mesmo jeito que
        separa as duas zonas do cartão de login. Aqui ele marca onde a tela
        deixa de explicar e passa a oferecer.
      */}
      <div className="filete-ouro mb-5 w-full" aria-hidden />

      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-titulo text-[15px] font-medium text-ink">Mais vendidos do mês</h2>
        <LegendaGrade />
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {populares.map((produto) => (
          <CardProduto key={produto.produtoId} produto={produto} aoAdicionar={aoAdicionar} />
        ))}
      </div>
    </>
  );
}
