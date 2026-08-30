import { Environment, Float, RoundedBox } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

/**
 * Objeto 3D herói: uma caixa de presente estilizada — a metáfora universal
 * de "algo foi vendido e embrulhado", sem depender de um produto específico
 * do catálogo (a loja vende de lingerie a pijama a itens de sexshop; uma
 * caixa/embrulho representa qualquer um deles sem escolher um).
 *
 * Procedural (geometria + material PBR + luz de estúdio), não um modelo
 * importado — não há pipeline de asset 3D neste projeto. Se um .glb
 * chegar depois, troca-se só este arquivo.
 */
export function ObjetoHero({ corAcento }: { corAcento: string }) {
  const grupoRef = useRef<THREE.Group>(null);
  const alvoRotacao = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  // Leve inclinação em direção ao cursor — não é o giro constante do Float
  // (que continua rodando sozinho), é um deslocamento adicional pequeno.
  useFrame((estado) => {
    if (!grupoRef.current) return;
    const x = (estado.pointer.y * Math.PI) / 24;
    const y = (estado.pointer.x * Math.PI) / 20;
    alvoRotacao.current.x += (x - alvoRotacao.current.x) * 0.05;
    alvoRotacao.current.y += (y - alvoRotacao.current.y) * 0.05;
    grupoRef.current.rotation.x = alvoRotacao.current.x;
    grupoRef.current.rotation.y = alvoRotacao.current.y;
  });

  const escala = Math.min(1.4, viewport.width / 6);

  return (
    <>
      <Environment preset="studio" />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 4]} intensity={1.4} castShadow />

      <Float speed={1.6} rotationIntensity={0.5} floatIntensity={0.8}>
        <group ref={grupoRef} scale={escala}>
          {/* Caixa */}
          <RoundedBox args={[1.8, 1.3, 1.4]} radius={0.08} smoothness={4} castShadow receiveShadow>
            <meshPhysicalMaterial color="#F5F1EA" roughness={0.35} clearcoat={0.4} clearcoatRoughness={0.3} />
          </RoundedBox>
          {/* Fita — duas tiras cruzadas na cor de acento da marca */}
          <RoundedBox args={[1.86, 0.22, 1.46]} radius={0.04} position={[0, 0.15, 0]} castShadow>
            <meshPhysicalMaterial color={corAcento} roughness={0.25} metalness={0.1} clearcoat={0.6} />
          </RoundedBox>
          <RoundedBox args={[0.22, 1.36, 1.46]} radius={0.04} position={[0, 0.15, 0]} castShadow>
            <meshPhysicalMaterial color={corAcento} roughness={0.25} metalness={0.1} clearcoat={0.6} />
          </RoundedBox>
          {/* Laço simplificado: dois toros achatados */}
          <mesh position={[-0.16, 0.85, 0]} rotation={[Math.PI / 2, 0.4, 0]} castShadow>
            <torusGeometry args={[0.22, 0.07, 16, 32]} />
            <meshPhysicalMaterial color={corAcento} roughness={0.25} clearcoat={0.6} />
          </mesh>
          <mesh position={[0.16, 0.85, 0]} rotation={[Math.PI / 2, -0.4, 0]} castShadow>
            <torusGeometry args={[0.22, 0.07, 16, 32]} />
            <meshPhysicalMaterial color={corAcento} roughness={0.25} clearcoat={0.6} />
          </mesh>
        </group>
      </Float>
    </>
  );
}
