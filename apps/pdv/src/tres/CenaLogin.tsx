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

/*
 * IMPORT CIRURGICO — vale para todas as cenas deste diretorio.
 *
 * O indice do drei puxa a biblioteca inteira (centenas de modulos) e estourava
 * a memoria do Node no build e no dev server. Por isso cada componente entra
 * pelo caminho exato do arquivo, `@react-three/drei/core/X.js`, e nunca por
 * `from '@react-three/drei'`.
 */
import { ContactShadows } from '@react-three/drei/core/ContactShadows.js';
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js';
import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { MarcaDaLoja } from './MarcaDaLoja.js';
import { preferereduzirMovimento } from './capacidade.js';

interface Props {
  /** Cor da marca. Fixa nos dois temas — ver `formaDaMarca.ts`. */
  readonly cor: string;
}

export default function CenaLogin({ cor }: Props) {
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
      /*
       * Camera quase na altura do simbolo, nao olhando de cima.
       *
       * A caixinha pedia um angulo alto para mostrar a tampa. O simbolo e
       * chapado: visto de cima ele encurta e a marca fica deformada logo na
       * primeira coisa que a operadora ve. O afastamento continua generoso,
       * porque o espaco em branco em volta e o que faz a peca parecer exposta
       * e nao espremida.
       */
      camera={{ position: [0, 0.25, 6.6], fov: 30 }}
      gl={{ antialias: true, powerPreference: 'low-power' }}
      onPointerDown={() => setInteragindo(true)}
      onPointerUp={() => setInteragindo(false)}
      onPointerLeave={() => setInteragindo(false)}
      aria-hidden
    >
      {/*
        Iluminação de estúdio, refeita para um objeto de traço fino.
        
        Um tubo de seção redonda mostra à câmera principalmente a lateral do
        cilindro, que fica de esguelha para qualquer luz vinda do alto — com a
        luz de chave sozinha, o vinho da marca lia quase preto. A terceira luz
        vem de perto da câmera e é o que devolve a cor; as outras duas
        continuam dando o volume.
      */}
      <ambientLight intensity={1.05} />
      <directionalLight position={[3.5, 5, 3]} intensity={1.35} />
      <directionalLight position={[-4, 2, -2]} intensity={0.4} />
      <directionalLight position={[0.5, 1.2, 5]} intensity={0.9} />

      <MarcaDaLoja cor={cor} interagindo={interagindo} aoRepousar={() => setRepousou(true)} />

      {/* Sombra de contato: um borrão no chão, muito mais barato que sombra real. */}
      {/*
        Sombra de contato bem abaixo e bem suave: o simbolo nao "apoia" no
        chao como uma caixa, ele flutua. Uma sombra dura embaixo de uma peca
        que flutua parece erro de montagem.
      */}
      <ContactShadows
        position={[0, -1.95, 0]}
        opacity={0.22}
        scale={8}
        blur={3.2}
        far={2.6}
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
