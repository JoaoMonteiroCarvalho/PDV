import { useEffect, useMemo, useRef, useState } from 'react';
import { formatarBRL, centavos } from '@pdv/shared';
import { Input } from '@/components/ui/Input.js';
import type { ItemCatalogo } from '@/servicos/catalogo.js';

/**
 * Busca por nome (F2), navegável só pelo teclado: setas movem a seleção,
 * Enter escolhe, Esc fecha. Debounce curto (150ms) — resultado quase
 * instantâneo, mas sem refiltrar a cada tecla numa lista grande.
 */
interface Props {
  readonly catalogo: readonly ItemCatalogo[];
  readonly aoEscolher: (produto: ItemCatalogo) => void;
  readonly aoFechar: () => void;
}

/**
 * Remove acento para a busca "cotton" achar "Calcinha Côtton". Faixa
 * Unicode U+0300–U+036F = marcas diacríticas combinantes; escapo em hex
 * para não deixar caractere combinante literal solto no código-fonte.
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function PainelBuscaPorNome({ catalogo, aoEscolher, aoFechar }: Props) {
  const [termo, setTermo] = useState('');
  const [termoComDebounce, setTermoComDebounce] = useState('');
  const [indiceSelecionado, setIndiceSelecionado] = useState(0);
  const refInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refInput.current?.focus();
  }, []);

  useEffect(() => {
    const temporizador = setTimeout(() => setTermoComDebounce(termo), 150);
    return () => clearTimeout(temporizador);
  }, [termo]);

  const resultados = useMemo(() => {
    const alvo = normalizar(termoComDebounce.trim());
    if (alvo.length < 2) return [];
    return catalogo.filter((item) => normalizar(item.nome).includes(alvo)).slice(0, 8);
  }, [catalogo, termoComDebounce]);

  useEffect(() => setIndiceSelecionado(0), [resultados.length, termoComDebounce]);

  function escolherAtual() {
    const escolhido = resultados[indiceSelecionado];
    if (escolhido) aoEscolher(escolhido);
  }

  return (
    <div className="absolute inset-x-0 top-0 z-10 border-b border-borda bg-superficie p-4 shadow-lg">
      <Input
        ref={refInput}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Buscar produto por nome…"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            aoFechar();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndiceSelecionado((i) => Math.min(i + 1, resultados.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndiceSelecionado((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            escolherAtual();
          }
        }}
      />

      {termoComDebounce.trim().length >= 2 && (
        <ul role="listbox" aria-label="Resultados da busca" className="mt-2 max-h-72 overflow-auto">
          {resultados.length === 0 ? (
            <li className="p-3 text-rotulo text-texto-secundario">Nenhum produto encontrado.</li>
          ) : (
            resultados.map((item, indice) => (
              <li
                key={item.id}
                role="option"
                aria-selected={indice === indiceSelecionado}
                onMouseEnter={() => setIndiceSelecionado(indice)}
                onClick={() => aoEscolher(item)}
                className={`flex cursor-pointer items-center justify-between rounded px-3 py-2 text-corpo ${
                  indice === indiceSelecionado ? 'bg-acento text-acento-texto' : ''
                }`}
              >
                <span>
                  {item.nome}
                  {(item.tamanho || item.cor) && (
                    <span className="ml-2 text-rotulo opacity-70">
                      {[item.tamanho, item.cor].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="font-semibold">{formatarBRL(centavos(item.precoCentavos))}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
