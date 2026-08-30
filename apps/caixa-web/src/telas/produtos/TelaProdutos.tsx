import { formatarBRL, centavos } from '@pdv/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { useNavegacao } from '@/estado/useNavegacao.js';
import { useProdutos, type VarianteListada } from '@/servicos/produtos.js';
import { ModalAjusteEstoque } from './ModalAjusteEstoque.js';
import { ModalProduto } from './ModalProduto.js';
import { ModalVariante } from './ModalVariante.js';
import { TelaImportarXml } from './TelaImportarXml.js';

type Painel =
  | { tipo: 'nenhum' }
  | { tipo: 'novo-produto' }
  | { tipo: 'nova-variante'; produtoId: string; nomeProduto: string }
  | { tipo: 'ajuste-estoque'; variante: VarianteListada; nomeProduto: string }
  | { tipo: 'importar-xml' };

function descricaoVariante(nomeProduto: string, variante: VarianteListada): string {
  const detalhes = [variante.tamanho, variante.cor].filter(Boolean).join(' ');
  return detalhes ? `${nomeProduto} — ${detalhes}` : nomeProduto;
}

export function TelaProdutos() {
  const irParaVenda = useNavegacao((estado) => estado.irParaVenda);
  const [busca, setBusca] = useState('');
  const [painel, setPainel] = useState<Painel>({ tipo: 'nenhum' });
  const { data, isLoading, isError } = useProdutos(busca.trim() ? { busca: busca.trim() } : {});

  if (painel.tipo === 'importar-xml') {
    return <TelaImportarXml aoVoltar={() => setPainel({ tipo: 'nenhum' })} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-valor">Produtos e estoque</h1>
        <div className="flex gap-3">
          <Button variante="secundaria" onClick={() => setPainel({ tipo: 'importar-xml' })}>
            Importar XML
          </Button>
          <Button variante="primaria" onClick={() => setPainel({ tipo: 'novo-produto' })}>
            Novo produto
          </Button>
          <Button variante="fantasma" onClick={irParaVenda}>
            Voltar pra venda
          </Button>
        </div>
      </header>

      <Input
        placeholder="Buscar por nome…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        aria-label="Buscar produto"
      />

      {isLoading && <p className="text-corpo text-texto-secundario">Carregando…</p>}
      {isError && (
        <p role="alert" className="text-corpo text-perigo">
          Não foi possível carregar os produtos. Verifique a conexão.
        </p>
      )}

      <div className="space-y-4">
        {data?.itens.map((produto) => (
          <div key={produto.id} className="rounded-lg border border-borda bg-superficie p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-corpo font-semibold">{produto.nome}</h2>
                {produto.marca && <p className="text-rotulo text-texto-secundario">{produto.marca}</p>}
              </div>
              <Button
                variante="secundaria"
                onClick={() => setPainel({ tipo: 'nova-variante', produtoId: produto.id, nomeProduto: produto.nome })}
              >
                Nova variante
              </Button>
            </div>

            {produto.variantes.length === 0 ? (
              <p className="mt-3 text-rotulo text-texto-secundario">Nenhuma variante cadastrada ainda.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {produto.variantes.map((variante) => (
                  <li
                    key={variante.id}
                    className="flex items-center justify-between rounded border border-borda px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-corpo">
                        {[variante.tamanho, variante.cor].filter(Boolean).join(' ') || variante.sku}
                      </span>
                      <span className="text-rotulo text-texto-secundario">{variante.sku}</span>
                      <span className="text-rotulo text-texto-secundario">
                        {formatarBRL(centavos(variante.precoCentavos))}
                      </span>
                      <Badge tom={variante.saldoEstoque <= 0 ? 'perigo' : 'neutro'}>
                        {variante.saldoEstoque} em estoque
                      </Badge>
                    </div>
                    <Button
                      variante="fantasma"
                      onClick={() =>
                        setPainel({ tipo: 'ajuste-estoque', variante, nomeProduto: produto.nome })
                      }
                    >
                      Ajustar estoque
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {painel.tipo === 'novo-produto' && (
        <ModalProduto
          aoConcluir={() => setPainel({ tipo: 'nenhum' })}
          aoFechar={() => setPainel({ tipo: 'nenhum' })}
        />
      )}

      {painel.tipo === 'nova-variante' && (
        <ModalVariante
          produtoId={painel.produtoId}
          nomeProduto={painel.nomeProduto}
          aoConcluir={() => setPainel({ tipo: 'nenhum' })}
          aoFechar={() => setPainel({ tipo: 'nenhum' })}
        />
      )}

      {painel.tipo === 'ajuste-estoque' && (
        <ModalAjusteEstoque
          varianteId={painel.variante.id}
          descricaoVariante={descricaoVariante(painel.nomeProduto, painel.variante)}
          aoConcluir={() => setPainel({ tipo: 'nenhum' })}
          aoFechar={() => setPainel({ tipo: 'nenhum' })}
        />
      )}
    </div>
  );
}
