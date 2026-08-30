import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';

/**
 * Tela temporária da Fase 0 — mostra os tokens de design aplicados de
 * verdade, para aprovação antes de começar a Fase 1. Some do roteador assim
 * que a tela de login (Fase 1) existir.
 */
export function EsbocoTokens() {
  return (
    <div className="min-h-full space-y-10 p-10">
      <header className="space-y-1">
        <h1 className="text-total">R$ 128,70</h1>
        <p className="text-texto-secundario text-rotulo">
          Fase 0 — tokens de design (esta tela some quando a Fase 1 começar)
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-valor">Paleta</h2>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ['fundo', 'bg-fundo border border-borda'],
              ['superficie', 'bg-superficie'],
              ['superficie-alta', 'bg-superficie-alta'],
              ['acento', 'bg-acento'],
              ['sucesso', 'bg-sucesso'],
              ['alerta', 'bg-alerta'],
              ['perigo', 'bg-perigo'],
            ] as const
          ).map(([nome, classe]) => (
            <div key={nome} className="flex flex-col items-center gap-2">
              <div className={`h-16 w-16 rounded ${classe}`} />
              <span className="text-rotulo text-texto-secundario">{nome}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-valor">Tipografia</h2>
        <p className="text-total">Total — 40px/700</p>
        <p className="text-valor">Valor de lista — 20px/600</p>
        <p className="text-corpo">Corpo — 16px/400</p>
        <p className="text-rotulo text-texto-secundario">Rótulo — 13px/500</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-valor">Botões</h2>
        <div className="flex flex-wrap gap-3">
          <Button variante="primaria">Finalizar venda (F9)</Button>
          <Button variante="secundaria">Buscar produto (F2)</Button>
          <Button variante="perigo">Cancelar venda (Esc)</Button>
          <Button variante="fantasma">Ação secundária</Button>
          <Button variante="primaria" disabled>
            Desabilitado
          </Button>
        </div>
      </section>

      <section className="max-w-sm space-y-3">
        <h2 className="text-valor">Campo</h2>
        <Input placeholder="Bipe o código de barras…" autoFocus />
        <Input placeholder="Campo com erro" invalido defaultValue="abc" />
      </section>

      <section className="space-y-3">
        <h2 className="text-valor">Indicador de conexão (Badge)</h2>
        <div className="flex flex-wrap gap-3">
          <Badge tom="sucesso">Online</Badge>
          <Badge tom="alerta">Sincronizando…</Badge>
          <Badge tom="alerta">3 pendentes</Badge>
          <Badge tom="perigo">Offline</Badge>
          <Badge tom="neutro">142 produtos no caixa</Badge>
        </div>
      </section>
    </div>
  );
}
