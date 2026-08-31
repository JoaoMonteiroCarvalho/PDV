/**
 * Palco sem 3D.
 *
 * Aparece em três situações, e em NENHUMA delas é um erro:
 *   - o computador não tem WebGL;
 *   - a operadora desligou os efeitos em Configurações;
 *   - a cena ainda está carregando (serve de `fallback` do Suspense).
 *
 * Por isso não há ícone quebrado, mensagem de falha nem retângulo cinza: é a
 * mesma caixinha, desenhada em SVG plano, com o mesmo respiro. Quem nunca viu
 * a versão 3D não percebe que está vendo a alternativa.
 *
 * O SVG é desenhado com as MESMAS cores de catálogo da cena — de novo, sem
 * tocar em token de interface.
 */

export function PalcoEstatico({
  cor,
  corFita,
  rotulo,
}: {
  cor: string;
  corFita: string;
  rotulo?: string | undefined;
}) {
  return (
    <div className="grid size-full place-items-center">
      <div className="flex flex-col items-center gap-6">
        <svg
          width="260"
          height="220"
          viewBox="0 0 260 220"
          fill="none"
          role="img"
          aria-label="Embalagem da marca"
        >
          {/* Sombra de contato, equivalente ao ContactShadows da cena */}
          <ellipse cx="130" cy="196" rx="76" ry="10" fill="rgb(0 0 0 / 10%)" />

          {/* Corpo da caixa, em perspectiva leve */}
          <path d="M52 88 L130 116 L130 186 L52 158 Z" fill={cor} />
          <path d="M208 88 L130 116 L130 186 L208 158 Z" fill={cor} opacity="0.82" />

          {/* Tampa */}
          <path d="M52 88 L130 60 L208 88 L130 116 Z" fill={cor} opacity="0.92" />

          {/* Fita: acompanha as duas faces visíveis */}
          <path d="M112 109 L120 106 L120 178 L112 181 Z" fill={corFita} />
          <path d="M140 106 L148 109 L148 181 L140 178 Z" fill={corFita} opacity="0.85" />
          <path d="M112 74 L120 71 L148 82 L140 85 Z" fill={corFita} opacity="0.95" />
        </svg>

        {rotulo && <p className="text-[13px] text-ink-faint">{rotulo}</p>}
      </div>
    </div>
  );
}
