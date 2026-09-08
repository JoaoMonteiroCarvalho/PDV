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
import { MarcaDagua } from '../componentes/MarcaDagua.js';

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
      <div className="relative grid h-full place-items-center text-center">
        {/*
          A rosa em marca d'água atrás do texto.

          Opacidade baixíssima de propósito: ela precisa tirar a cara de "tela
          em branco" sem disputar com a frase que está por cima. Se der para
          ler o contorno antes de ler o texto, está forte demais.

          DESLOCADA PARA BAIXO, e isso não é ajuste de gosto. Centrada, a
          espiral — que é a parte densa do desenho — caía bem atrás do texto, e
          onde uma letra cruzava o traço o contraste do texto secundário descia
          de 3,6:1 para ~3,2:1. Num token que já é o mais fraco da paleta, isso
          é caro. Empurrada para 60%, o texto passa a ficar sobre o afunilamento
          de cima do botão, que é vazio, e a espiral fica logo abaixo dele.

          Só entra AQUI, no vazio de verdade. Com o atalho de mais vendidos na
          tela, os cards são opacos e a marca apareceria picotada nos vãos
          entre eles — pior que não ter.
        */}
        <MarcaDagua className="pointer-events-none absolute top-[60%] left-1/2 h-[62%] max-h-[440px] -translate-x-1/2 -translate-y-1/2 text-accent opacity-[0.07]" />

        <div className="relative max-w-[380px]">
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
