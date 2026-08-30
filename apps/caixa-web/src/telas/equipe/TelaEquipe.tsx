import { useState } from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { useNavegacao } from '@/estado/useNavegacao.js';
import { useOperadores, type OperadorListado } from '@/servicos/operadores.js';
import { ModalOperador } from './ModalOperador.js';

const NOME_PAPEL: Record<string, string> = {
  OPERADOR: 'Operador',
  GERENTE: 'Gerente',
  ADMIN: 'Administrador',
};

export function TelaEquipe() {
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [painel, setPainel] = useState<{ tipo: 'novo' } | { tipo: 'editar'; operador: OperadorListado } | null>(
    null,
  );

  const { data, isLoading, isError } = useOperadores(mostrarInativos);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-valor">Equipe</h1>
        <div className="flex gap-3">
          <Button variante="primaria" onClick={() => setPainel({ tipo: 'novo' })}>
            Novo operador
          </Button>
          <Button variante="fantasma" onClick={irParaVenda}>
            Voltar pra venda
          </Button>
        </div>
      </header>

      <label className="flex items-center gap-2 text-rotulo text-texto-secundario">
        <input
          type="checkbox"
          checked={mostrarInativos}
          onChange={(e) => setMostrarInativos(e.target.checked)}
        />
        Mostrar inativos
      </label>

      {isLoading && <p className="text-corpo text-texto-secundario">Carregando…</p>}
      {isError && (
        <p role="alert" className="text-corpo text-perigo">
          Não foi possível carregar a equipe. Verifique a conexão.
        </p>
      )}

      <ul className="space-y-2">
        {data?.operadores.map((operador) => (
          <li
            key={operador.id}
            className="flex items-center justify-between rounded-lg border border-borda bg-superficie p-4"
          >
            <div>
              <p className="text-corpo">
                {operador.nome} <span className="text-rotulo text-texto-secundario">· {operador.login}</span>
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge tom="neutro">{NOME_PAPEL[operador.papel] ?? operador.papel}</Badge>
                {!operador.ativo && <Badge tom="perigo">inativo</Badge>}
              </div>
            </div>
            <Button variante="secundaria" onClick={() => setPainel({ tipo: 'editar', operador })}>
              Editar
            </Button>
          </li>
        ))}
      </ul>

      {painel?.tipo === 'novo' && (
        <ModalOperador aoConcluir={() => setPainel(null)} aoFechar={() => setPainel(null)} />
      )}
      {painel?.tipo === 'editar' && (
        <ModalOperador
          operador={painel.operador}
          aoConcluir={() => setPainel(null)}
          aoFechar={() => setPainel(null)}
        />
      )}
    </div>
  );
}
