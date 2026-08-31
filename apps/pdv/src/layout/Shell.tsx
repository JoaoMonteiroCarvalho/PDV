/**
 * Moldura da aplicação: barra de estado no topo, conteúdo abaixo.
 *
 * A barra é fina de propósito. Ela existe para responder três perguntas que a
 * operadora faz o dia todo — "estou online?", "tem venda presa?", "qual caixa
 * é este?" — sem roubar espaço da tela de trabalho.
 */

import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { IndicadorConexao } from '../componentes/IndicadorConexao.js';
import { Botao, cx } from '../componentes/base.js';
import { useSessao } from '../estado/sessaoStore.js';
import { useCaixa } from '../estado/caixaStore.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';

const NAVEGACAO = [
  { para: '/venda', rotulo: 'Venda' },
  { para: '/catalogo', rotulo: 'Catálogo' },
  { para: '/historico', rotulo: 'Histórico' },
  { para: '/caixa', rotulo: 'Caixa' },
  { para: '/clientes', rotulo: 'Clientes' },
  { para: '/estoque', rotulo: 'Estoque' },
] as const;

export function Shell() {
  const operadora = useSessao((estado) => estado.operadora);
  const sair = useSessao((estado) => estado.sair);
  const sessaoCaixa = useCaixa((estado) => estado.sessao);
  const sincronizarCaixa = useCaixa((estado) => estado.sincronizar);

  /*
   * O Shell só existe depois do login — é aqui que a sincronização começa.
   *
   * Duas coisas dependem disso e ambas quebravam quando rodavam antes:
   *   - o motor batia na API sem token e tomava 401;
   *   - o estado do caixa nunca era consultado, então o guard mandava a
   *     operadora para a abertura mesmo com caixa já aberto no servidor.
   */
  useEffect(() => {
    void sincronizarCaixa();
    motorSincronizacao.iniciar();
    return () => motorSincronizacao.parar();
  }, [sincronizarCaixa]);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-5 py-2.5">
        <span className="font-titulo text-[15px] font-semibold tracking-tight">PDV</span>

        <nav className="flex items-center gap-0.5">
          {NAVEGACAO.map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              className={({ isActive }) =>
                cx(
                  'rounded-[10px] px-3 py-1.5 text-[14px] transition-colors duration-200',
                  isActive
                    ? 'bg-accent-soft text-accent font-medium'
                    : 'text-ink-soft hover:bg-sunken hover:text-ink',
                )
              }
            >
              {item.rotulo}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <IndicadorConexao />

        {sessaoCaixa && (
          <span className="text-[13px] text-ink-faint">Caixa aberto</span>
        )}

        {operadora && (
          <>
            <span className="text-[13px] text-ink-soft">{operadora.nome}</span>
            <Botao variante="discreto" onClick={sair} className="h-8 px-3 text-[13px]">
              Sair
            </Botao>
          </>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
