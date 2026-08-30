import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Suspense } from 'react';
import { ObjetoHero } from './ObjetoHero.js';

/**
 * Canvas WebGL isolado num arquivo próprio — importado só via `React.lazy`
 * em `TelaApresentacao`. Three.js/R3F nunca entram no bundle inicial nem
 * chegam a ser requisitados fora desta tela de vitrine.
 *
 * `OrbitControls` só de rotação (zoom e pan desligados — não é um visualizador
 * de produto, é um herói decorativo) é quem dá a interação de arrastar: gira
 * sozinho devagar quando ninguém toca (`autoRotate`), e some pro controle do
 * visitante assim que ele clica/toca e arrasta, com desaceleração suave
 * (`enableDamping`) em vez de parar seco ao soltar.
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
      <OrbitControls
        makeDefault
        target={[0, 0.05, 0]}
        enableZoom={false}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.7}
        autoRotate
        autoRotateSpeed={0.8}
        minPolarAngle={Math.PI / 2 - 0.6}
        maxPolarAngle={Math.PI / 2 + 0.6}
      />
    </Canvas>
  );
}
