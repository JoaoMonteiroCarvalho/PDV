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
import { Botao, Selo, cx } from '../componentes/base.js';
import { useSessao, ehGerente } from '../estado/sessaoStore.js';
import { useCaixa } from '../estado/caixaStore.js';
import { motorSincronizacao } from '../sincronizacao/motorGlobal.js';
import { sincronizarLoja } from '../impressao/loja.js';
import { sincronizarVendedores } from '../venda/vendedores.js';

/**
 * `soGerente` esconde do menu o que a API já recusaria de qualquer forma.
 *
 * Esconder não é a proteção — a proteção é o `exigirAdministrador` na rota.
 * Aqui o motivo é outro: menu com item que dá 403 ao ser clicado ensina a
 * operadora a ignorar mensagem de erro, e é esse hábito que faz o erro que
 * importa passar despercebido.
 */
const NAVEGACAO = [
  { para: '/venda', rotulo: 'Venda' },
  { para: '/catalogo', rotulo: 'Catálogo' },
  { para: '/historico', rotulo: 'Histórico' },
  { para: '/caixa', rotulo: 'Caixa' },
  { para: '/clientes', rotulo: 'Clientes' },
  { para: '/estoque', rotulo: 'Estoque' },
  { para: '/produtos', rotulo: 'Produtos' },
  { para: '/relatorios', rotulo: 'Relatórios', soGerente: true },
  { para: '/contas-a-receber', rotulo: 'A receber', soGerente: true },
  { para: '/auditoria', rotulo: 'Auditoria', soGerente: true },
  { para: '/configuracoes', rotulo: 'Configurações' },
] as const;

export function Shell() {
  const operadora = useSessao((estado) => estado.operadora);
  const gerente = ehGerente(operadora);
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
    // Os dados da loja saem no comprovante, inclusive offline: busca uma vez
    // ao entrar e guarda localmente. Falha aqui não interrompe nada.
    void sincronizarLoja();
    // Quem pode ser marcada como vendedora. Cacheada, porque a venda fecha
    // offline e escolher quem atendeu não pode depender de rede.
    void sincronizarVendedores();
    motorSincronizacao.iniciar();
    return () => motorSincronizacao.parar();
  }, [sincronizarCaixa]);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-surface px-5 py-2.5">
        {/*
          A marca na barra: SÍMBOLO + nome em texto vivo, não o logo
          horizontal fechado.

          O manual manda o horizontal no cabeçalho, mas esta barra tem 40px
          de altura — que é o caso de "espaço pequeno" do próprio manual. O
          lockup inteiro reduzido a essa altura deixa o símbolo do tamanho de
          um ponto e "MODA ÍNTIMA" ilegível; foi testado e é o que acontece.
          Assim o símbolo mantém o tamanho mínimo em que ainda se lê, e o
          nome vem na Cormorant, que é a fonte da marca.

          O arquivo usado é a versão "compacta": mesma geometria e mesmo
          traço do símbolo oficial, com o viewBox recortado. O arquivo
          original reserva dois terços do quadro para margem — ótimo quando
          ele aparece sozinho e grande, mas num ícone de 28px sobra um
          desenho de 9px. Recortar margem não é distorcer.
        */}
        <a
          href="/venda"
          className="flex shrink-0 items-center gap-2.5"
          /*
           * O rótulo NÃO pode conter "Venda": há um item de menu com esse
           * nome, e dois links com nomes acessíveis que se sobrepõem deixam
           * quem usa leitor de tela sem saber qual é qual (o teste E2E pegou
           * isso primeiro, batendo em dois elementos).
           */
          aria-label="RM Moda Íntima — início"
        >
          <img src="/marca/rm-icone-compacto-cor.svg" alt="" className="marca-clara size-7" />
          <img src="/marca/rm-icone-compacto-branco.svg" alt="" className="marca-escura size-7" />
          <span className="font-titulo text-[15px] tracking-[0.14em] text-ink">
            RM MODA ÍNTIMA
          </span>
        </a>

        <nav className="flex items-center gap-0.5">
          {NAVEGACAO.filter((item) => !('soGerente' in item && item.soGerente) || gerente).map((item) => (
            <NavLink
              key={item.para}
              to={item.para}
              className={({ isActive }) =>
                cx(
                  'rounded-[8px] px-3 py-1.5 text-[14px] transition-colors duration-200',
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

        {/*
          Estado do caixa como SELO, igual ao da conexão logo ao lado.

          Os dois dizem a mesma classe de coisa — "em que condição o sistema
          está agora" — e vinham em formatos diferentes: um era pílula com cor
          e fundo, o outro texto solto e apagado. Quem olha a barra de estado
          lê os dois de uma vez; formatos diferentes obrigam a ler duas vezes.

          Tom NEUTRO, não verde. Verde é a cor de "deu certo", e o selo ao lado
          já usa: dois verdes lado a lado se anulam. Caixa aberto não é sucesso,
          é o modo em que a loja está — fato, não conquista.
        */}
        {sessaoCaixa && <Selo tom="neutro">Caixa aberto</Selo>}

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
