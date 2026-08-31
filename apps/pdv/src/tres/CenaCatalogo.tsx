/**
 * Prévia 3D em CADA card do catálogo, com um único contexto WebGL.
 *
 * O problema que este arquivo resolve: um `<Canvas>` por card criaria um
 * contexto WebGL por card, e o navegador só mantém 8 a 16 vivos — a partir daí
 * ele DESCARTA os mais antigos em silêncio, sem erro no console. Numa grade de
 * 30 produtos, os primeiros cards virariam retângulos pretos e ninguém saberia
 * por quê.
 *
 * A solução é `View` do drei: um canvas só, fixo cobrindo a janela, que
 * desenha N viewports recortados por scissor — um para cada card, seguindo o
 * retângulo do elemento na tela. Um contexto, quantos cards a loja quiser.
 *
 * Economia de GPU, que aqui importa mais que na consulta (são dezenas de peças
 * em vez de uma):
 *   - `frameloop="demand"`: parado, não desenha nada. Rolar a lista ou passar
 *     o mouse é o que pede quadro novo.
 *   - só a peça sob o mouse gira; as outras ficam paradas num ângulo fixo.
 *   - o `View` do drei já pula o desenho do que está fora da tela, e a tela
 *     ainda monta prévia só para o card visível (ver `TelaCatalogo`).
 *   - `dpr` teto 1.25, mais baixo que o da consulta: são muitos viewports
 *     pequenos, e resolução extra aqui não acrescenta nada.
 */

// Import cirurgico — ver nota em CaixaDaMarca.tsx.
import { View } from '@react-three/drei/web/View.js';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import type { FormaDaPeca } from '../catalogo/formaDaPeca.js';
import { MalhaDaPeca } from './PecaAbstrata.js';
import { preferereduzirMovimento } from './capacidade.js';

/** Ângulo de repouso: virada o bastante para ler como volume. */
const ANGULO_PARADO = Math.PI * 0.18;
const VELOCIDADE_GIRO = 0.9;

export interface AlvoPrevia {
  readonly chave: string;
  readonly forma: FormaDaPeca;
  readonly cor: string;
  /** Elemento do card que a prévia acompanha. */
  readonly trilho: React.MutableRefObject<HTMLElement | null>;
}

export default function CenaCatalogo({ alvos }: { alvos: readonly AlvoPrevia[] }) {
  const [girando, setGirando] = useState<string | null>(null);
  const [abaVisivel, setAbaVisivel] = useState(!document.hidden);

  useEffect(() => {
    const aoTrocar = () => setAbaVisivel(!document.hidden);
    document.addEventListener('visibilitychange', aoTrocar);
    return () => document.removeEventListener('visibilitychange', aoTrocar);
  }, []);

  /*
   * Passar o mouse é do DOM, não do 3D: o canvas tem `pointer-events: none`
   * para não roubar o clique dos cards, que são links. Escutamos o hover nos
   * próprios elementos rastreados.
   */
  useEffect(() => {
    const limpezas = alvos.map((alvo) => {
      const elemento = alvo.trilho.current;
      if (!elemento) return () => {};
      const entrou = () => setGirando(alvo.chave);
      const saiu = () => setGirando((atual) => (atual === alvo.chave ? null : atual));
      elemento.addEventListener('pointerenter', entrou);
      elemento.addEventListener('pointerleave', saiu);
      return () => {
        elemento.removeEventListener('pointerenter', entrou);
        elemento.removeEventListener('pointerleave', saiu);
      };
    });
    return () => limpezas.forEach((limpar) => limpar());
  }, [alvos]);

  const parado = preferereduzirMovimento() || girando === null;
  const precisaDesenhar = abaVisivel && !parado;

  return (
    <Canvas
      /*
        Fixo cobrindo a janela e SEM eventos de ponteiro. O canvas é
        transparente fora dos retângulos dos cards, então o texto e os preços
        continuam legíveis por baixo dele; e como não recebe ponteiro, o clique
        atravessa e chega no link do card.
      */
      className="pointer-events-none fixed inset-0 z-10"
      frameloop={precisaDesenhar ? 'always' : 'demand'}
      dpr={[1, 1.25]}
      camera={{ position: [0, 1.1, 5.6], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      style={{ width: '100vw', height: '100vh' }}
    >
      <RedesenharAoRolar />

      {alvos.map((alvo) => (
        <View key={alvo.chave} track={alvo.trilho as React.MutableRefObject<HTMLElement>}>
          {/* Cada viewport tem a própria luz: a cena é portalada, não compartilhada. */}
          <ambientLight intensity={0.85} />
          <directionalLight position={[3, 4.5, 3]} intensity={1.3} />
          <directionalLight position={[-3.5, 2, -2]} intensity={0.3} />
          <PecaDoCard forma={alvo.forma} cor={alvo.cor} girando={girando === alvo.chave} />
        </View>
      ))}
    </Canvas>
  );
}

/**
 * Rolar a lista move os cards, e o recorte de cada viewport vem do retângulo
 * do elemento. Sem pedir quadro novo a cada rolagem, as peças ficariam para
 * trás da grade em `frameloop="demand"`.
 *
 * `capture` porque o scroll acontece no container interno do Shell, não na
 * janela, e evento de rolagem não sobe por bubbling.
 */
function RedesenharAoRolar() {
  const invalidar = useThree((estado) => estado.invalidate);

  useEffect(() => {
    const pedir = () => invalidar();
    window.addEventListener('scroll', pedir, { capture: true, passive: true });
    window.addEventListener('resize', pedir);
    return () => {
      window.removeEventListener('scroll', pedir, { capture: true });
      window.removeEventListener('resize', pedir);
    };
  }, [invalidar]);

  return null;
}

/** Parada num ângulo fixo; gira só enquanto o mouse está sobre o card. */
function PecaDoCard({
  forma,
  cor,
  girando,
}: {
  forma: FormaDaPeca;
  cor: string;
  girando: boolean;
}) {
  const grupo = useRef<Group>(null);

  useFrame((_, delta) => {
    if (!grupo.current) return;
    if (girando) {
      grupo.current.rotation.y += delta * VELOCIDADE_GIRO;
      return;
    }
    // Volta ao ângulo de repouso pelo caminho mais curto, sem dar meia-volta.
    const alvo = ANGULO_PARADO;
    const atual = grupo.current.rotation.y % (Math.PI * 2);
    const diferenca = ((alvo - atual + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(diferenca) < 0.01) {
      grupo.current.rotation.y = alvo;
      return;
    }
    grupo.current.rotation.y = atual + diferenca * Math.min(1, delta * 6);
  });

  return (
    <group ref={grupo} rotation={[0, ANGULO_PARADO, 0]} scale={0.78}>
      <MalhaDaPeca forma={forma} cor={cor} />
    </group>
  );
}
