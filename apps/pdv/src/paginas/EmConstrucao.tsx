/**
 * Placeholder honesto para telas ainda não construídas.
 *
 * Diz o que é e em que fase entra, em vez de mostrar tela em branco ou um
 * erro — quem abre a rota entende que não quebrou, só ainda não chegou a vez.
 */

export function EmConstrucao({ titulo, fase }: { titulo: string; fase: string }) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-[13px] font-medium tracking-widest text-ink-faint uppercase">{fase}</p>
        <h1 className="mt-2 text-[28px]">{titulo}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          Esta tela ainda não foi construída. A fundação (rotas, design system,
          estado e sincronização) já está no lugar — ela entra na fase indicada
          acima.
        </p>
      </div>
    </div>
  );
}
