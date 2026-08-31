/**
 * A peça na prévia 3D — três formas abstratas, nenhuma com corpo humano.
 *
 * Roupa aparece DOBRADA, como fica na prateleira da loja. Essa não é uma
 * escolha estética: um manequim na tela, numa loja de moda íntima, é
 * constrangedor com a cliente do outro lado do balcão. E uma silhueta de
 * corpo ainda por cima sugeriria caimento e tamanho que o sistema não sabe.
 *
 * Custo baixo de propósito — isto roda num mini-PC o dia inteiro:
 *   - só primitivas (`RoundedBox`, cilindro), sem malha importada;
 *   - nenhuma textura, nenhum reflexo de ambiente;
 *   - a sombra é um borrão no chão, não sombra projetada.
 *
 * A cor vem SEMPRE do catálogo, nunca de token de interface. Um sutiã vinho é
 * vinho no tema claro e no escuro.
 */

// Import cirurgico: o indice do drei puxa centenas de modulos e estourava a
// memoria do Node no build. Ver nota em CaixaDaMarca.tsx.
import { RoundedBox } from '@react-three/drei/core/RoundedBox.js';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import type { FormaDaPeca } from '../catalogo/formaDaPeca.js';

/** Segundos de rotação de apresentação antes de a peça parar sozinha. */
const DURACAO_APRESENTACAO = 4.5;
/** Onde repousa: levemente virada, para ler como volume e não como recorte. */
const ANGULO_FINAL = Math.PI * 0.18;

interface Props {
  readonly forma: FormaDaPeca;
  /** Cor real da peça, vinda do catálogo. */
  readonly cor: string;
  readonly interagindo: boolean;
  readonly aoRepousar?: (() => void) | undefined;
}

export function PecaAbstrata({ forma, cor, interagindo, aoRepousar }: Props) {
  const grupo = useRef<Group>(null);
  const decorrido = useRef(0);
  const repousou = useRef(false);

  useFrame((_, delta) => {
    if (!grupo.current || repousou.current) return;

    // Arrastar assume o controle: a apresentação nunca briga com a mão.
    if (interagindo) {
      repousou.current = true;
      aoRepousar?.();
      return;
    }

    decorrido.current += delta;
    const t = Math.min(decorrido.current / DURACAO_APRESENTACAO, 1);
    // easeOutCubic: desacelera até parar, sem freada seca.
    const suavizado = 1 - (1 - t) ** 3;
    grupo.current.rotation.y = suavizado * (Math.PI * 2 + ANGULO_FINAL);

    if (t >= 1) {
      repousou.current = true;
      aoRepousar?.();
    }
  });

  return (
    <group ref={grupo}>
      <MalhaDaPeca forma={forma} cor={cor} />
    </group>
  );
}

/**
 * Só a geometria, sem animação nenhuma.
 *
 * Separado de `PecaAbstrata` porque o card do catálogo precisa da mesma peça
 * com outro comportamento: lá ela fica parada e só gira quando o mouse passa
 * por cima. Duplicar as formas para isso faria a peça do card divergir da
 * peça da consulta com a primeira alteração.
 */
export function MalhaDaPeca({ forma, cor }: { forma: FormaDaPeca; cor: string }) {
  return (
    <>
      {forma === 'dobrada' && <PecaDobrada cor={cor} />}
      {forma === 'frasco' && <Frasco cor={cor} />}
      {forma === 'bloco' && <Bloco cor={cor} />}
    </>
  );
}

/**
 * Três lâminas empilhadas, cada uma girada um pouco — a leitura de tecido
 * dobrado vem do desalinhamento, não de deformar a malha (que custaria caro).
 * A do meio é levemente mais escura, dando profundidade sem luz extra.
 */
function PecaDobrada({ cor }: { cor: string }) {
  return (
    <group position={[0, -0.15, 0]}>
      <RoundedBox args={[2.1, 0.26, 1.5]} radius={0.12} smoothness={3} position={[0, 0, 0]}>
        <meshStandardMaterial color={cor} roughness={0.78} metalness={0} />
      </RoundedBox>

      <RoundedBox
        args={[2.0, 0.24, 1.42]}
        radius={0.11}
        smoothness={3}
        position={[0.04, 0.27, 0.03]}
        rotation={[0, 0.06, 0.012]}
      >
        <meshStandardMaterial color={cor} roughness={0.82} metalness={0} />
      </RoundedBox>

      <RoundedBox
        args={[1.88, 0.22, 1.34]}
        radius={0.1}
        smoothness={3}
        position={[-0.05, 0.53, -0.02]}
        rotation={[0, -0.05, -0.015]}
      >
        <meshStandardMaterial color={cor} roughness={0.74} metalness={0} />
      </RoundedBox>
    </group>
  );
}

/**
 * Frasco: corpo cilíndrico, ombro e tampa. Segmentos baixos (24) porque a
 * peça é vista de longe e girando devagar — 64 segmentos custariam o triplo
 * sem diferença visível nesta escala.
 */
function Frasco({ cor }: { cor: string }) {
  return (
    <group position={[0, -0.55, 0]}>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.52, 0.58, 1.0, 24]} />
        <meshStandardMaterial color={cor} roughness={0.28} metalness={0.06} />
      </mesh>

      {/* Ombro: cone curto que fecha o corpo até o gargalo. */}
      <mesh position={[0, 1.08, 0]}>
        <cylinderGeometry args={[0.2, 0.52, 0.18, 24]} />
        <meshStandardMaterial color={cor} roughness={0.3} metalness={0.06} />
      </mesh>

      <mesh position={[0, 1.24, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.16, 20]} />
        <meshStandardMaterial color={cor} roughness={0.35} metalness={0.04} />
      </mesh>

      {/*
        Tampa em tom neutro escuro, não na cor do produto: no frasco real a
        cor que a cliente vê é a do líquido, e a tampa costuma destoar. Este
        cinza é fixo e não vem de token de interface.
      */}
      <RoundedBox args={[0.42, 0.34, 0.42]} radius={0.06} smoothness={3} position={[0, 1.47, 0]}>
        <meshStandardMaterial color="#4a4a4f" roughness={0.4} metalness={0.1} />
      </RoundedBox>
    </group>
  );
}

/** Embalagem neutra: o que o sistema mostra quando não sabe o formato. */
function Bloco({ cor }: { cor: string }) {
  return (
    <RoundedBox args={[1.6, 1.1, 1.0]} radius={0.1} smoothness={3} position={[0, -0.1, 0]}>
      <meshStandardMaterial color={cor} roughness={0.65} metalness={0.02} />
    </RoundedBox>
  );
}
