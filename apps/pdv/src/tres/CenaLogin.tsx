/**
 * Cena 3D do login.
 *
 * Economia de GPU, que é o requisito duro aqui — isto fica aberto o dia todo
 * num mini-PC de loja:
 *
 *   - `frameloop` vira `demand` assim que a peça para de girar. Sem isso, o
 *     navegador continuaria desenhando 60 quadros por segundo de uma imagem
 *     parada até alguém logar.
 *   - Arrastar volta ao loop contínuo e, ao soltar, ele desliga de novo.
 *   - Com a aba em segundo plano, para tudo.
 *   - `dpr` limitado a 1.5: acima disso o ganho visual não paga o custo.
 *
 * A cena inteira é destruída ao desmontar (troca de rota), liberando o
 * contexto WebGL — R3F faz isso, mas só porque o Canvas vive dentro deste
 * componente e não num singleton global.
 */

// Import cirurgico — ver nota em CaixaDaMarca.tsx.
import { ContactShadows } from '@react-three/drei/core/ContactShadows.js';
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js';
import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { CaixaDaMarca } from './CaixaDaMarca.js';
import { preferereduzirMovimento } from './capacidade.js';

interface Props {
  readonly cor: string;
  readonly corFita: string;
}

export default function CenaLogin({ cor, corFita }: Props) {
  const [repousou, setRepousou] = useState(preferereduzirMovimento());
  const [interagindo, setInteragindo] = useState(false);
  const [abaVisivel, setAbaVisivel] = useState(!document.hidden);

  useEffect(() => {
    const aoTrocarVisibilidade = () => setAbaVisivel(!document.hidden);
    document.addEventListener('visibilitychange', aoTrocarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
  }, []);

  // `always` só enquanto há motivo para redesenhar.
  const precisaDesenhar = abaVisivel && (!repousou || interagindo);

  return (
    <Canvas
      frameloop={precisaDesenhar ? 'always' : 'demand'}
      dpr={[1, 1.5]}
      // Camera afastada de proposito: espaco em branco em volta do objeto e o
      // que separa uma pagina de produto de um card apertado.
      camera={{ position: [0, 1.35, 7.4], fov: 30 }}
      gl={{ antialias: true, powerPreference: 'low-power' }}
      onPointerDown={() => setInteragindo(true)}
      onPointerUp={() => setInteragindo(false)}
      onPointerLeave={() => setInteragindo(false)}
      aria-hidden
    >
      {/* Iluminação de estúdio: uma chave, um preenchimento suave, sem drama. */}
      <ambientLight intensity={0.75} />
      <directionalLight position={[3.5, 5, 3]} intensity={1.5} />
      <directionalLight position={[-4, 2, -2]} intensity={0.35} />

      <CaixaDaMarca
        cor={cor}
        corFita={corFita}
        interagindo={interagindo}
        aoRepousar={() => setRepousou(true)}
      />

      {/* Sombra de contato: um borrão no chão, muito mais barato que sombra real. */}
      <ContactShadows
        position={[0, -0.72, 0]}
        opacity={0.34}
        scale={7}
        blur={2.6}
        far={2.2}
        resolution={256}
      />

      {/*
        Só rotação horizontal. Zoom e pan sairiam do enquadramento e a
        operadora não teria como voltar — não há botão de "resetar câmera"
        numa tela de login.
      */}
      <OrbitControls
        makeDefault
        enableZoom={false}
        enablePan={false}
        minPolarAngle={Math.PI / 2.6}
        maxPolarAngle={Math.PI / 2.05}
        rotateSpeed={0.5}
        onStart={() => setInteragindo(true)}
        onEnd={() => setInteragindo(false)}
      />
    </Canvas>
  );
}
