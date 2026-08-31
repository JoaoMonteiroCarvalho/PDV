/**
 * Cena 3D da consulta de produto.
 *
 * Mesma economia de GPU da cena de login, pelo mesmo motivo — mini-PC de loja,
 * aberto o dia todo:
 *   - `frameloop` vira `demand` quando a apresentação termina; a GPU para de
 *     desenhar uma imagem parada;
 *   - arrastar volta ao loop contínuo e soltar desliga de novo;
 *   - aba em segundo plano para tudo;
 *   - `dpr` limitado a 1.5.
 *
 * UM canvas por tela, deliberadamente. A tentação seria pôr uma prévia 3D em
 * cada card do catálogo, mas o navegador limita quantos contextos WebGL
 * existem ao mesmo tempo (na prática 8 a 16) e passa a DESCARTAR os mais
 * antigos — cards virariam retângulos pretos sem nenhum erro no console. Por
 * isso o catálogo usa amostra de cor plana e o 3D vive só aqui, na tela de um
 * produto só.
 */

// Import cirurgico — ver nota em CaixaDaMarca.tsx.
import { ContactShadows } from '@react-three/drei/core/ContactShadows.js';
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js';
import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import type { FormaDaPeca } from '../catalogo/formaDaPeca.js';
import { PecaAbstrata } from './PecaAbstrata.js';
import { preferereduzirMovimento } from './capacidade.js';

interface Props {
  readonly forma: FormaDaPeca;
  readonly cor: string;
}

export default function CenaProduto({ forma, cor }: Props) {
  const [repousou, setRepousou] = useState(preferereduzirMovimento());
  const [interagindo, setInteragindo] = useState(false);
  const [abaVisivel, setAbaVisivel] = useState(!document.hidden);

  useEffect(() => {
    const aoTrocarVisibilidade = () => setAbaVisivel(!document.hidden);
    document.addEventListener('visibilitychange', aoTrocarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
  }, []);

  /*
   * Trocar de variação troca a cor da peça. Sem reiniciar a apresentação, a
   * peça nova apareceria parada e a operadora não teria certeza de que a
   * troca surtiu efeito — o giro curto é a confirmação visual.
   */
  useEffect(() => {
    setRepousou(preferereduzirMovimento());
  }, [cor, forma]);

  const precisaDesenhar = abaVisivel && (!repousou || interagindo);

  return (
    <Canvas
      key={forma}
      frameloop={precisaDesenhar ? 'always' : 'demand'}
      dpr={[1, 1.5]}
      camera={{ position: [0, 1.15, 6.2], fov: 30 }}
      gl={{ antialias: true, powerPreference: 'low-power' }}
      onPointerDown={() => setInteragindo(true)}
      onPointerUp={() => setInteragindo(false)}
      onPointerLeave={() => setInteragindo(false)}
      aria-hidden
    >
      {/* Luz de estúdio: uma chave, um preenchimento suave, sem drama. */}
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 4.5, 3]} intensity={1.4} />
      <directionalLight position={[-3.5, 2, -2]} intensity={0.32} />

      <PecaAbstrata
        forma={forma}
        cor={cor}
        interagindo={interagindo}
        aoRepousar={() => setRepousou(true)}
      />

      <ContactShadows
        position={[0, -0.95, 0]}
        opacity={0.3}
        scale={6}
        blur={2.4}
        far={2}
        resolution={256}
      />

      {/*
        Só rotação horizontal, como no login. Zoom e pan tirariam a peça do
        enquadramento e não há botão de "resetar câmera" nesta tela.
      */}
      <OrbitControls
        makeDefault
        enableZoom={false}
        enablePan={false}
        minPolarAngle={Math.PI / 2.7}
        maxPolarAngle={Math.PI / 2.02}
        rotateSpeed={0.5}
        onStart={() => setInteragindo(true)}
        onEnd={() => setInteragindo(false)}
      />
    </Canvas>
  );
}
