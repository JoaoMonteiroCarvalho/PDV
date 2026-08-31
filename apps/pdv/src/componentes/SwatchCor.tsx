/**
 * Amostra da cor REAL da peça.
 *
 * Usa exclusivamente a paleta de catálogo. Nenhum token de interface entra
 * aqui: a bolinha de "vinho" precisa ser vinho no tema claro, no tema escuro e
 * no comprovante. O que muda com o tema é só o contorno, que é chrome de
 * interface, não a cor do produto.
 */

import { corDoProduto, precisaDeContorno } from '../design/coresProduto.js';
import { cx } from './base.js';

export function SwatchCor({
  cor,
  tamanho = 20,
  className,
}: {
  cor: string | null;
  tamanho?: number;
  className?: string;
}) {
  const { hex, rotulo, desconhecida } = corDoProduto(cor);

  return (
    <span
      // O nome da cor vai no `title` e no aria-label porque cor sozinha não é
      // informação acessível — nem para quem não enxerga, nem para quem não
      // distingue vinho de marrom numa bolinha de 20px.
      title={desconhecida && cor ? `${cor} (não catalogada)` : rotulo}
      aria-label={desconhecida && cor ? `${cor}, cor não catalogada` : rotulo}
      role="img"
      className={cx('inline-block shrink-0 rounded-full', className)}
      style={{
        width: tamanho,
        height: tamanho,
        backgroundColor: hex,
        // Marfim sobre fundo branco sumiria; preto não precisa de contorno.
        boxShadow: precisaDeContorno(hex) ? 'inset 0 0 0 1px rgba(0,0,0,0.18)' : undefined,
      }}
    />
  );
}
