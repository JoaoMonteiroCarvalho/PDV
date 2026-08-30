import { Canvas } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { Suspense } from 'react';
import { ObjetoHero } from './ObjetoHero.js';

/**
 * Canvas WebGL isolado num arquivo próprio — importado só via `React.lazy`
 * em `TelaApresentacao`. Three.js/R3F nunca entram no bundle inicial nem
 * chegam a ser requisitados fora desta tela de vitrine.
 */
export default function CenaHero({ corAcento }: { corAcento: string }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.6, 5], fov: 35 }}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <ObjetoHero corAcento={corAcento} />
        <ContactShadows position={[0, -0.9, 0]} opacity={0.35} scale={6} blur={2.4} far={2} />
      </Suspense>
    </Canvas>
  );
}
