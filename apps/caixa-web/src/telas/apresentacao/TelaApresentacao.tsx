import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';

gsap.registerPlugin(ScrollTrigger);

// Three.js/R3F só entram no bundle quando este componente monta — nunca na
// frente de caixa, produtos, ou qualquer outra tela operacional.
const CenaHero = lazy(() => import('./CenaHero.js'));

const COR_ACENTO = '#4F7CFF';

const RECURSOS = [
  {
    titulo: 'Frente de caixa sem mouse',
    texto: 'Bipar, buscar, finalizar — do primeiro item ao comprovante, 100% pelo teclado. Feito pra quem vende em pé, com a cliente na frente.',
  },
  {
    titulo: 'Estoque que se atualiza sozinho',
    texto: 'Cada venda baixa o estoque na hora. Importa nota de compra por XML e casa com o catálogo automaticamente pelo código de barras.',
  },
  {
    titulo: 'Crediário sem planilha',
    texto: 'Limite por cliente, parcelas, cobrança — tudo dentro do mesmo sistema que já sabe o que foi vendido pra quem.',
  },
  {
    titulo: 'Relatório na hora que precisar',
    texto: 'Total do dia, por forma de pagamento, por operador, produtos mais vendidos — sem esperar fechar o mês pra saber como foi.',
  },
];

function usaMovimentoReduzido(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function suportaWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Props {
  readonly aoEntrar: () => void;
}

/**
 * Tela de apresentação — a ÚNICA tela do sistema com essa identidade visual
 * (fundo claro, tipografia enorme, objeto 3D, scroll com parallax). Login e
 * toda a operação do caixa continuam no tema escuro de alto contraste,
 * inalterados: aquela decisão tem justificativa própria (loja com luz
 * ruim, operador em pé) e não faz sentido pra uma tela sem pressa nenhuma.
 */
export function TelaApresentacao({ aoEntrar }: Props) {
  const refScroll = useRef<HTMLDivElement>(null);
  const refHeadline = useRef<HTMLDivElement>(null);
  const [mostrar3d] = useState(() => suportaWebGL() && !usaMovimentoReduzido());

  useEffect(() => {
    const reduzido = usaMovimentoReduzido();
    const contexto = gsap.context(() => {
      if (!reduzido) {
        gsap.from(refHeadline.current, { opacity: 0, y: 24, duration: 0.9, ease: 'power3.out', delay: 0.1 });
      }

      gsap.utils.toArray<HTMLElement>('[data-revelar]').forEach((elemento) => {
        if (reduzido) {
          gsap.set(elemento, { opacity: 1, y: 0 });
          return;
        }
        gsap.fromTo(
          elemento,
          { opacity: 0, y: 40 },
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: elemento,
              scroller: refScroll.current,
              start: 'top 85%',
            },
          },
        );
      });

      if (!reduzido) {
        // Parallax sutil: o bloco do objeto 3D anda mais devagar que o
        // scroll — profundidade, sem disfarçar o conteúdo por trás dele.
        gsap.to('[data-parallax]', {
          yPercent: 18,
          ease: 'none',
          scrollTrigger: {
            trigger: refScroll.current,
            scroller: refScroll.current,
            start: 'top top',
            end: 'bottom top',
            scrub: true,
          },
        });
      }
    }, refScroll);

    return () => contexto.revert();
  }, []);

  return (
    <div
      ref={refScroll}
      className="h-full overflow-y-auto bg-white text-[#14161C]"
      style={{ scrollbarGutter: 'stable' }}
    >
      {/* Navegação minimalista */}
      <nav className="sticky top-0 z-20 flex items-center justify-between border-b border-black/5 bg-white/80 px-6 py-4 backdrop-blur sm:px-10">
        <span className="text-lg font-bold tracking-tight">PDV</span>
        <div className="hidden gap-8 text-sm font-medium text-black/60 sm:flex">
          <a href="#recursos" className="hover:text-black">
            Recursos
          </a>
          <a href="#sobre" className="hover:text-black">
            Como funciona
          </a>
        </div>
        <button
          type="button"
          onClick={aoEntrar}
          className="rounded-full bg-[#14161C] px-5 py-2 text-sm font-semibold text-white transition-transform active:scale-95 hover:bg-black"
        >
          Entrar
        </button>
      </nav>

      {/* Hero */}
      <section className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pb-8 pt-10 text-center sm:pb-16 sm:pt-24">
        <div ref={refHeadline}>
          <h1 className="mx-auto max-w-4xl text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[0.98] tracking-tight">
            Seu caixa.
            <br />
            Sem complicação.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-black/60">
            Feito pra loja de moda íntima que não tem tempo a perder: vende rápido, controla estoque sozinho e
            fecha o dia sem susto.
          </p>
          <button
            type="button"
            onClick={aoEntrar}
            className="mt-8 rounded-full px-8 py-3 text-base font-semibold text-white shadow-[0_12px_32px_-8px_rgb(79_124_255_/_0.55)] transition-transform active:scale-95 hover:brightness-110"
            style={{ backgroundColor: COR_ACENTO }}
          >
            Entrar no sistema
          </button>
        </div>

        {/* Objeto 3D herói */}
        <div data-parallax className="relative mt-6 h-[240px] w-full max-w-xl sm:mt-16 sm:h-[420px]">
          {mostrar3d ? (
            <Suspense
              fallback={<div className="h-full w-full animate-pulse rounded-[40%] bg-black/5" aria-hidden />}
            >
              <CenaHero corAcento={COR_ACENTO} />
            </Suspense>
          ) : (
            // Sem WebGL ou com "reduzir movimento" ligado: forma estática no
            // lugar do 3D, em vez de deixar um vazio.
            <div
              aria-hidden
              className="mx-auto h-64 w-64 rounded-[40%] bg-gradient-to-br from-[#F5F1EA] to-black/5 shadow-inner sm:h-80 sm:w-80"
            />
          )}
        </div>
      </section>

      {/* Recursos */}
      <section id="recursos" className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <h2 data-revelar className="text-3xl font-bold sm:text-4xl">
          Tudo que um caixa de verdade precisa.
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {RECURSOS.map((recurso) => (
            <div key={recurso.titulo} data-revelar className="rounded-3xl border border-black/5 bg-black/[0.02] p-8">
              <h3 className="text-xl font-semibold">{recurso.titulo}</h3>
              <p className="mt-3 text-black/60">{recurso.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section id="sobre" className="border-t border-black/5 px-6 py-20 text-center sm:py-28">
        <h2 data-revelar className="mx-auto max-w-2xl text-3xl font-bold sm:text-4xl">
          Abre o caixa, escaneia o primeiro item, vende.
        </h2>
        <button
          type="button"
          onClick={aoEntrar}
          data-revelar
          className="mx-auto mt-8 block rounded-full px-8 py-3 text-base font-semibold text-white shadow-[0_12px_32px_-8px_rgb(79_124_255_/_0.55)] transition-transform active:scale-95 hover:brightness-110"
          style={{ backgroundColor: COR_ACENTO }}
        >
          Entrar no sistema
        </button>
        <p className="mt-16 text-xs text-black/40">PDV — sistema interno de ponto de venda.</p>
      </section>
    </div>
  );
}
