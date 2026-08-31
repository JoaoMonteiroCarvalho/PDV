/**
 * Prévia do produto sem 3D.
 *
 * Aparece em três situações e em NENHUMA delas é um erro:
 *   - o computador não tem WebGL;
 *   - a operadora desligou os efeitos em Configurações;
 *   - a cena ainda está carregando (serve de `fallback` do Suspense).
 *
 * Por isso desenha a MESMA forma em SVG plano, com as mesmas cores de
 * catálogo. Quem nunca viu a versão 3D não percebe que está vendo a
 * alternativa — que é o ponto. Um retângulo cinza com "sem suporte" faria a
 * operadora achar que o sistema quebrou.
 */

import type { FormaDaPeca } from '../catalogo/formaDaPeca.js';

export function PalcoProduto({
  forma,
  cor,
  descricao,
}: {
  forma: FormaDaPeca;
  cor: string;
  descricao: string;
}) {
  return (
    <div className="grid size-full place-items-center">
      <svg width="260" height="230" viewBox="0 0 260 230" fill="none" role="img" aria-label={descricao}>
        {/* Sombra de contato, equivalente ao ContactShadows da cena. */}
        <ellipse cx="130" cy="198" rx="72" ry="9" fill="rgb(0 0 0 / 10%)" />
        {forma === 'dobrada' && <DesenhoDobrada cor={cor} />}
        {forma === 'frasco' && <DesenhoFrasco cor={cor} />}
        {forma === 'bloco' && <DesenhoBloco cor={cor} />}
      </svg>
    </div>
  );
}

/** Três lâminas empilhadas em perspectiva leve — o mesmo desenho da cena 3D. */
function DesenhoDobrada({ cor }: { cor: string }) {
  return (
    <g>
      {/* base */}
      <path d="M56 168 L130 190 L204 168 L130 146 Z" fill={cor} opacity="0.9" />
      <path d="M56 168 L56 178 L130 200 L130 190 Z" fill={cor} opacity="0.7" />
      <path d="M204 168 L204 178 L130 200 L130 190 Z" fill={cor} opacity="0.55" />
      {/* meio */}
      <path d="M60 140 L130 161 L200 140 L130 119 Z" fill={cor} opacity="0.95" />
      <path d="M60 140 L60 150 L130 171 L130 161 Z" fill={cor} opacity="0.72" />
      <path d="M200 140 L200 150 L130 171 L130 161 Z" fill={cor} opacity="0.58" />
      {/* topo */}
      <path d="M66 113 L130 133 L194 113 L130 93 Z" fill={cor} />
      <path d="M66 113 L66 123 L130 143 L130 133 Z" fill={cor} opacity="0.75" />
      <path d="M194 113 L194 123 L130 143 L130 133 Z" fill={cor} opacity="0.6" />
    </g>
  );
}

function DesenhoFrasco({ cor }: { cor: string }) {
  return (
    <g>
      {/* corpo */}
      <path d="M96 116 L164 116 L160 188 L100 188 Z" fill={cor} />
      <path d="M130 116 L164 116 L160 188 L130 188 Z" fill={cor} opacity="0.78" />
      {/* ombro */}
      <path d="M112 100 L148 100 L164 116 L96 116 Z" fill={cor} opacity="0.9" />
      {/* gargalo */}
      <rect x="118" y="84" width="24" height="17" fill={cor} opacity="0.95" />
      {/* tampa: tom neutro fixo, como na cena 3D */}
      <rect x="112" y="64" width="36" height="22" rx="4" fill="#4A4A4F" />
    </g>
  );
}

function DesenhoBloco({ cor }: { cor: string }) {
  return (
    <g>
      <path d="M70 108 L130 130 L130 190 L70 168 Z" fill={cor} />
      <path d="M190 108 L130 130 L130 190 L190 168 Z" fill={cor} opacity="0.78" />
      <path d="M70 108 L130 86 L190 108 L130 130 Z" fill={cor} opacity="0.92" />
    </g>
  );
}
