import { Environment, Float } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * Objeto 3D herói: uma peça pendurada num cabide — o ícone universal de
 * boutique de moda íntima, sem depender de recorte anatômico nenhum.
 *
 * A peça é um CONTORNO 2D extrudado com pouca espessura (`ExtrudeGeometry`),
 * não um sólido de revolução — silhueta achatada de tecido, não vaso/garrafa.
 * O contorno é simétrico: alça fina, ombro largo, cintura marcada, barra
 * evasê — o desenho clássico de camisola/slip pendurada em vitrine.
 *
 * Procedural (geometria + material PBR + luz de estúdio), não um modelo
 * importado — não há pipeline de asset 3D neste projeto. Se um .glb
 * chegar depois, troca-se só este arquivo.
 */
export function ObjetoHero({ corAcento }: { corAcento: string }) {
  const grupoRef = useRef<THREE.Group>(null);
  const alvoRotacao = useRef({ x: 0, y: 0 });
  const { viewport } = useThree();

  const geometriaPeca = useMemo(() => {
    const forma = new THREE.Shape();
    // Metade direita do contorno, de cima (alça, perto do cabide) até
    // embaixo (barra), depois espelhada de volta — silhueta simétrica.
    forma.moveTo(-0.045, 0.58);
    forma.lineTo(0.045, 0.58);
    forma.quadraticCurveTo(0.05, 0.5, 0.16, 0.47); // desce pra alça-ombro
    forma.quadraticCurveTo(0.34, 0.44, 0.32, 0.28); // ombro largo
    forma.quadraticCurveTo(0.3, 0.12, 0.22, -0.02); // busto -> cintura
    forma.quadraticCurveTo(0.16, -0.12, 0.2, -0.3); // cintura marcada
    forma.quadraticCurveTo(0.26, -0.5, 0.4, -0.68); // quadril -> barra
    forma.lineTo(0.4, -0.78); // barra evasê, lado direito
    forma.quadraticCurveTo(0.2, -0.83, 0, -0.84); // curva da barra (frente)
    forma.quadraticCurveTo(-0.2, -0.83, -0.4, -0.78); // barra, lado esquerdo
    forma.lineTo(-0.4, -0.68);
    forma.quadraticCurveTo(-0.26, -0.5, -0.2, -0.3);
    forma.quadraticCurveTo(-0.16, -0.12, -0.22, -0.02);
    forma.quadraticCurveTo(-0.3, 0.12, -0.32, 0.28);
    forma.quadraticCurveTo(-0.34, 0.44, -0.16, 0.47);
    forma.quadraticCurveTo(-0.05, 0.5, -0.045, 0.58);

    return new THREE.ExtrudeGeometry(forma, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 3,
      curveSegments: 24,
    });
  }, []);

  useFrame((estado) => {
    if (!grupoRef.current) return;
    const x = (estado.pointer.y * Math.PI) / 28;
    const y = (estado.pointer.x * Math.PI) / 18;
    alvoRotacao.current.x += (x - alvoRotacao.current.x) * 0.05;
    alvoRotacao.current.y += (y - alvoRotacao.current.y) * 0.05;
    grupoRef.current.rotation.x = alvoRotacao.current.x;
    grupoRef.current.rotation.y = alvoRotacao.current.y;
  });

  const escala = Math.min(1.6, viewport.width / 5);

  return (
    <>
      <Environment preset="studio" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[4, 6, 4]} intensity={1.5} castShadow />
      <pointLight position={[-3, 1, 2]} intensity={0.4} color={corAcento} />

      <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.6}>
        <group ref={grupoRef} scale={escala} position={[0, -0.05, 0]}>
          {/* Cabide — encostado direto na alça da peça, sem vão entre os dois */}
          <group position={[0, 0.66, 0]}>
            <mesh position={[0, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.075, 0.015, 12, 24, Math.PI * 1.5]} />
              <meshPhysicalMaterial color="#B8A78C" roughness={0.4} metalness={0.3} />
            </mesh>
            <mesh position={[-0.14, -0.02, 0]} rotation={[0, 0, Math.PI / 6.2]}>
              <cylinderGeometry args={[0.014, 0.014, 0.32, 12]} />
              <meshPhysicalMaterial color="#C9B79A" roughness={0.45} />
            </mesh>
            <mesh position={[0.14, -0.02, 0]} rotation={[0, 0, -Math.PI / 6.2]}>
              <cylinderGeometry args={[0.014, 0.014, 0.32, 12]} />
              <meshPhysicalMaterial color="#C9B79A" roughness={0.45} />
            </mesh>
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.02, 12, 12]} />
              <meshPhysicalMaterial color="#B8A78C" roughness={0.4} metalness={0.3} />
            </mesh>
          </group>

          {/* Peça — silhueta achatada, cetim em tom neutro */}
          <mesh geometry={geometriaPeca} castShadow receiveShadow>
            <meshPhysicalMaterial
              color="#F3E9E4"
              roughness={0.3}
              clearcoat={0.5}
              clearcoatRoughness={0.3}
              sheen={1}
              sheenColor="#FFFFFF"
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Laço na alça direita — o toque de cor da marca */}
          <mesh position={[0.25, 0.42, 0.03]} rotation={[0, 0, 0.5]}>
            <torusGeometry args={[0.04, 0.013, 10, 20]} />
            <meshPhysicalMaterial color={corAcento} roughness={0.3} clearcoat={0.6} />
          </mesh>
        </group>
      </Float>
    </>
  );
}
