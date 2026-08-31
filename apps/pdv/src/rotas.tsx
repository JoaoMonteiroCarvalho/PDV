/**
 * Rotas da aplicação.
 *
 * Dois guards, nesta ordem, porque a ordem importa:
 *
 *   1. `ExigeLogin`  — sem operadora identificada não se faz nada. Toda ação
 *                      financeira precisa saber QUEM fez.
 *   2. `ExigeCaixa`  — sem caixa aberto não se vende. Bloquear na rota evita
 *                      a operadora lançar dez itens e só descobrir o problema
 *                      no momento de finalizar.
 */

import { type ReactNode } from 'react';
import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom';
import { Shell } from './layout/Shell.js';
import { useSessao } from './estado/sessaoStore.js';
import { useCaixa } from './estado/caixaStore.js';
import { TelaEntrar } from './paginas/TelaEntrar.js';
import { EmConstrucao } from './paginas/EmConstrucao.js';
import { TelaCaixa } from './paginas/TelaCaixa.js';
import { TelaVenda } from './paginas/TelaVenda.js';
import { DesignSystem } from './paginas/DesignSystem.js';

function ExigeLogin({ children }: { children: ReactNode }) {
  const operadora = useSessao((estado) => estado.operadora);
  const local = useLocation();
  if (!operadora) {
    // Guarda de onde a operadora veio, para voltar ao mesmo ponto após entrar.
    return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  }
  return <>{children}</>;
}

function ExigeCaixa({ children }: { children: ReactNode }) {
  const sessao = useCaixa((estado) => estado.sessao);
  const jaConsultou = useCaixa((estado) => estado.jaConsultou);

  // Só decide depois de perguntar ao servidor. Redirecionar antes disso
  // expulsaria a operadora da venda mesmo com o caixa aberto.
  if (!jaConsultou) return <Carregando />;
  if (!sessao) return <Navigate to="/caixa" replace />;
  return <>{children}</>;
}

function Carregando() {
  return (
    <div className="grid h-full place-items-center text-[14px] text-ink-faint">Carregando…</div>
  );
}

export const roteador = createBrowserRouter([
  { path: '/entrar', element: <TelaEntrar /> },
  {
    path: '/',
    element: (
      <ExigeLogin>
        <Shell />
      </ExigeLogin>
    ),
    children: [
      { index: true, element: <Navigate to="/venda" replace /> },
      {
        path: 'venda',
        element: (
          <ExigeCaixa>
            <TelaVenda />
          </ExigeCaixa>
        ),
      },
      { path: 'catalogo', element: <EmConstrucao titulo="Catálogo visual" fase="Fase 3" /> },
      { path: 'produto/:id', element: <EmConstrucao titulo="Consulta de produto" fase="Fase 4" /> },
      { path: 'historico', element: <EmConstrucao titulo="Histórico de vendas" fase="Fase 5" /> },
      { path: 'caixa', element: <TelaCaixa /> },
      { path: 'caixa/fechar', element: <EmConstrucao titulo="Fechamento de caixa" fase="Fase 6" /> },
      { path: 'caixa/movimento', element: <EmConstrucao titulo="Sangria e suprimento" fase="Fase 7" /> },
      { path: 'estoque', element: <EmConstrucao titulo="Estoque e produtos" fase="Fase 8" /> },
      { path: 'clientes', element: <EmConstrucao titulo="Clientes e fiado" fase="Fase 9" /> },
      { path: 'relatorios', element: <EmConstrucao titulo="Relatórios" fase="Fase 10" /> },
      { path: 'configuracoes', element: <EmConstrucao titulo="Configurações" fase="Fase 11" /> },
      { path: 'design', element: <DesignSystem /> },
    ],
  },
  { path: '*', element: <Navigate to="/venda" replace /> },
]);
