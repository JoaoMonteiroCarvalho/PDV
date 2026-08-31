/**
 * Confirmação da venda em 3D: a caixa da marca se fechando.
 *
 * A escolha da imagem não é decorativa. A tampa descendo e a fita assentando
 * dizem "acabou, está embalado" sem uma palavra — e é o mesmo objeto do login,
 * então o sistema abre e fecha com a mesma peça. Um "check" verde genérico
 * diria o mesmo e não seria de lugar nenhum.
 *
 * A animação dura pouco mais de um segundo e PARA. Isto aparece depois de cada
 * venda, dezenas de vezes por dia: uma animação longa vira obstáculo entre a
 * operadora e a próxima cliente. Quando termina, `frameloop` vira `demand` e a
 * GPU para de desenhar.
 *
 * Quem pediu menos movimento no sistema operacional já recebe a caixa fechada,
 * sem animação nenhuma.
 */

// Import cirurgico — ver nota em CaixaDaMarca.tsx.
import { ContactShadows } from '@react-three/drei/core/ContactShadows.js';
import { RoundedBox } from '@react-three/drei/core/RoundedBox.js';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import { preferereduzirMovimento } from './capacidade.js';

/** Segundos até a tampa assentar. Curto de propósito. */
const DURACAO = 1.15;
/** Altura de onde a tampa cai. */
const ALTURA_INICIAL = 1.5;
const ALTURA_FINAL = 0.6;

interface Props {
  readonly cor: string;
  readonly corFita: string;
}

export default function CenaConfirmacao({ cor, corFita }: Props) {
  const [fechou, setFechou] = useState(preferereduzirMovimento());
  const [abaVisivel, setAbaVisivel] = useState(!document.hidden);

  useEffect(() => {
    const aoTrocar = () => setAbaVisivel(!document.hidden);
    document.addEventListener('visibilitychange', aoTrocar);
    return () => document.removeEventListener('visibilitychange', aoTrocar);
  }, []);

  return (
    <Canvas
      frameloop={abaVisivel && !fechou ? 'always' : 'demand'}
      dpr={[1, 1.5]}
      camera={{ position: [0, 1.5, 6.4], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      aria-hidden
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[3.5, 5, 3]} intensity={1.4} />
      <directionalLight position={[-4, 2, -2]} intensity={0.32} />

      <CaixaFechando
        cor={cor}
        corFita={corFita}
        jaFechada={fechou}
        aoFechar={() => setFechou(true)}
      />

      <ContactShadows
        position={[0, -0.75, 0]}
        opacity={0.32}
        scale={7}
        blur={2.6}
        far={2.2}
        resolution={256}
      />
    </Canvas>
  );
}

function CaixaFechando({
  cor,
  corFita,
  jaFechada,
  aoFechar,
}: {
  cor: string;
  corFita: string;
  jaFechada: boolean;
  aoFechar: () => void;
}) {
  const tampa = useRef<Group>(null);
  const fita = useRef<Group>(null);
  const decorrido = useRef(0);
  const terminou = useRef(jaFechada);

  useFrame((_, delta) => {
    if (terminou.current || !tampa.current || !fita.current) return;

    decorrido.current += delta;
    const t = Math.min(decorrido.current / DURACAO, 1);
    // easeOutBack leve: a tampa passa um fio do lugar e volta, como peça que
    // encaixa. Sem exagero — não é brinquedo, é confirmação de dinheiro.
    const c = 1.20;
    const suavizado = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;

    tampa.current.position.y = ALTURA_INICIAL - (ALTURA_INICIAL - ALTURA_FINAL) * suavizado;
    // A fita só aparece depois que a tampa assenta: ela envolve a caixa
    // fechada, e cresceria atravessando a tampa se subisse junto.
    const escalaFita = Math.max(0, (t - 0.62) / 0.38);
    fita.current.scale.setScalar(Math.min(1, escalaFita));

    if (t >= 1) {
      terminou.current = true;
      tampa.current.position.y = ALTURA_FINAL;
      fita.current.scale.setScalar(1);
      aoFechar();
    }
  });

  return (
    <group>
      {/* Corpo */}
      <RoundedBox args={[2, 1.15, 1.45]} radius={0.09} smoothness={4}>
        <meshStandardMaterial color={cor} roughness={0.62} metalness={0.02} />
      </RoundedBox>

      <group ref={tampa} position={[0, jaFechada ? ALTURA_FINAL : ALTURA_INICIAL, 0]}>
        <RoundedBox args={[2.06, 0.22, 1.51]} radius={0.07} smoothness={4}>
          <meshStandardMaterial color={cor} roughness={0.55} metalness={0.02} />
        </RoundedBox>
      </group>

      <group ref={fita} scale={jaFechada ? 1 : 0}>
        {/* Mesmas medidas da fita do login: envolve do fundo ao topo da tampa. */}
        <mesh position={[0, 0.0675, 0]}>
          <boxGeometry args={[0.17, 1.305, 1.53]} />
          <meshStandardMaterial color={corFita} roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}
