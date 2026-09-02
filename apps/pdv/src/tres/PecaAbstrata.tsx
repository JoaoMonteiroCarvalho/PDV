/**
 * A peça na prévia 3D — três formas abstratas, nenhuma com corpo humano.
 *
 * Roupa aparece DOBRADA, como fica na prateleira da loja. Essa não é uma
 * escolha estética: um manequim na tela, numa loja de moda íntima, é
 * constrangedor com a cliente do outro lado do balcão. E uma silhueta de
 * corpo ainda por cima sugeriria caimento e tamanho que o sistema não sabe.
 *
 * A geometria e o material vêm de `geometrias.ts`, COMPARTILHADOS. Antes cada
 * peça construía os próprios — 60 geometrias e 51 ms de CPU cada vez que
 * cards entravam na tela do catálogo. Agora são 3 construções na vida do app.
 *
 * SOBRE DESCARTE, que é a dúvida óbvia ao compartilhar objetos: o R3F NÃO
 * descarta geometria e material passados como prop. No `removeChild` dele, o
 * descarte é `child.dispose && child.type !== 'Scene'` — e `THREE.Mesh` não
 * tem método `dispose`, então nada acontece. Só é descartado o que é filho
 * declarativo (`<meshLambertMaterial />` dentro do mesh), que aí é por
 * instância mesmo.
 *
 * Por isso NÃO se usa `dispose={null}` aqui. Ele seria inócuo para os objetos
 * compartilhados e, pior, impediria o descarte de qualquer material declarado
 * como filho — vazando um material por desmontagem.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import type { FormaDaPeca } from '../catalogo/formaDaPeca.js';
import { COR_TAMPA, GEOMETRIAS, materialDaPeca, type NivelDeDetalhe } from './geometrias.js';

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
 * Separada de `PecaAbstrata` porque o card do catálogo precisa da mesma peça
 * com outro comportamento: lá ela fica parada e só gira quando o mouse passa
 * por cima. Duplicar as formas faria a peça do card divergir da da consulta.
 */
export function MalhaDaPeca({
  forma,
  cor,
  detalhe = 'alto',
}: {
  forma: FormaDaPeca;
  cor: string;
  detalhe?: NivelDeDetalhe;
}) {
  const material = materialDaPeca(cor, detalhe);
  const geometrias = GEOMETRIAS[detalhe];

  if (forma === 'frasco') {
    return (
      <Frasco
        geometrias={geometrias.frasco}
        material={material}
        materialTampa={materialDaPeca(COR_TAMPA, detalhe)}
      />
    );
  }
  if (forma === 'dobrada') return <PecaDobrada geometrias={geometrias.laminas} material={material} />;

  // Embalagem neutra: o que o sistema mostra quando não sabe o formato.
  return <mesh geometry={geometrias.bloco} material={material} position={[0, -0.1, 0]} />;
}

type Material = ReturnType<typeof materialDaPeca>;

/**
 * Três lâminas empilhadas, cada uma girada um pouco — a leitura de tecido
 * dobrado vem do desalinhamento, não de deformar a malha (que custaria caro).
 */
function PecaDobrada({
  geometrias,
  material,
}: {
  geometrias: (typeof GEOMETRIAS)['alto']['laminas'];
  material: Material;
}) {
  return (
    <group position={[0, -0.15, 0]}>
      <mesh geometry={geometrias.base} material={material} />
      <mesh
        geometry={geometrias.meio}
        material={material}
        position={[0.04, 0.27, 0.03]}
        rotation={[0, 0.06, 0.012]}
      />
      <mesh
        geometry={geometrias.topo}
        material={material}
        position={[-0.05, 0.53, -0.02]}
        rotation={[0, -0.05, -0.015]}
      />
    </group>
  );
}

/** Frasco: corpo cilíndrico, ombro, gargalo e tampa. */
function Frasco({
  geometrias,
  material,
  materialTampa,
}: {
  geometrias: (typeof GEOMETRIAS)['alto']['frasco'];
  material: Material;
  materialTampa: Material;
}) {
  return (
    <group position={[0, -0.55, 0]}>
      <mesh geometry={geometrias.corpo} material={material} position={[0, 0.5, 0]} />
      <mesh geometry={geometrias.ombro} material={material} position={[0, 1.08, 0]} />
      <mesh geometry={geometrias.gargalo} material={material} position={[0, 1.24, 0]} />
      {/*
        Tampa em tom neutro escuro, não na cor do produto: no frasco real a cor
        que a cliente vê é a do líquido, e a tampa costuma destoar. Vem do mesmo
        cache dos outros — nada de material por instância.
      */}
      <mesh geometry={geometrias.tampa} material={materialTampa} position={[0, 1.47, 0]} />
    </group>
  );
}
