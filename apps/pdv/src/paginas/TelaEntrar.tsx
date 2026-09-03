/**
 * Login / seleção de operadora.
 *
 * Composição no espírito de uma página de produto: o objeto ocupa o palco
 * grande à esquerda como protagonista, e o formulário fica pequeno e discreto
 * ao lado — nunca por cima da cena, competindo com ela.
 *
 * A cena 3D entra por `lazy`: o formulário renderiza e recebe foco antes de
 * qualquer byte de Three.js chegar. Quem só quer bater o ponto e abrir o
 * caixa não espera a peça carregar.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { Suspense, lazy, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Botao, Campo, Cartao, Erro } from '../componentes/base.js';
import { useSessao } from '../estado/sessaoStore.js';
import { PalcoDaMarca } from '../tres/PalcoDaMarca.js';
import { COR_MARCA, COR_MARCA_SOBRE_ESCURO } from '../tres/formaDaMarca.js';
import { temaSalvo } from '../design/tema.js';
import { podeRenderizar3d } from '../tres/capacidade.js';

const CenaLogin = lazy(() => import('../tres/CenaLogin.js'));

const esquema = z.object({
  login: z.string().min(1, 'Informe o usuário'),
  senha: z.string().min(1, 'Informe a senha'),
});
type Entrada = z.infer<typeof esquema>;

function saudacao(hora = new Date().getHours()): string {
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function TelaEntrar() {
  const operadora = useSessao((estado) => estado.operadora);
  const entrar = useSessao((estado) => estado.entrar);
  const erro = useSessao((estado) => estado.erro);
  const entrando = useSessao((estado) => estado.entrando);
  const navegar = useNavigate();
  const local = useLocation();

  // Decidido uma vez: a capacidade do computador não muda no meio da sessão.
  const usar3d = useMemo(() => podeRenderizar3d(), []);

  /*
   * Qual versão da marca vai ao palco.
   *
   * Regra do manual: fundo escuro pede a versão branca. Lido uma vez, na
   * montagem, e isso basta — o interruptor de tema mora dentro do sistema, e
   * para chegar até ele é preciso já estar logado, ou seja, esta tela não
   * está na frente de ninguém quando o tema muda.
   */
  const corDaMarca = useMemo(
    () => (temaSalvo() === 'dark' ? COR_MARCA_SOBRE_ESCURO : COR_MARCA),
    [],
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Entrada>({ resolver: zodResolver(esquema) });

  if (operadora) {
    const destino = (local.state as { de?: string } | null)?.de ?? '/venda';
    return <Navigate to={destino} replace />;
  }

  async function submeter(dados: Entrada) {
    try {
      await entrar(dados.login, dados.senha);
      navegar((local.state as { de?: string } | null)?.de ?? '/venda', { replace: true });
    } catch {
      // O store já guardou a mensagem; ela aparece junto ao formulário.
    }
  }

  return (
    <div className="grid h-screen grid-cols-1 bg-bg lg:grid-cols-[1.45fr_1fr]">
      {/*
        Palco em BLUSH, que o manual descreve como "fundo delicado" — é
        exatamente o papel deste painel. Antes era o cinza rebaixado genérico,
        e o login ficava bege sobre bege, sem nada da marca no fundo.

        No tema escuro o mesmo token vira o vinho profundo acinzentado, então
        o painel continua sendo da família da marca em vez de virar um
        retângulo preto.
      */}
      <section className="relative hidden overflow-hidden bg-accent-soft lg:block">
        {/*
          Filete de ouro na emenda dos dois painéis.

          Fica DENTRO do palco, encostado na borda direita, e não como
          `border-r` da seção: assim ele some nas duas pontas em vez de bater
          no topo e no rodapé da tela. É o mesmo tratamento do filete que
          separa símbolo e nome no logo horizontal — o ouro entra como
          detalhe de 1px, nunca como régua.
        */}
        <div className="filete-ouro-vertical absolute inset-y-0 right-0 z-10" aria-hidden />
        {usar3d ? (
          <Suspense fallback={<PalcoDaMarca cor={corDaMarca} />}>
            <CenaLogin cor={corDaMarca} />
          </Suspense>
        ) : (
          <PalcoDaMarca cor={corDaMarca} />
        )}

        {/*
          O wordmark embaixo da peça, não sobre ela.

          O manual pede respiro em volta do símbolo; sobrepor texto ao 3D
          comeria esse respiro e ainda brigaria com a peça girando. Aqui o
          bloco fica ancorado no rodapé do palco, com o filete de ouro
          separando marca e assinatura — que é o papel do ouro na identidade:
          detalhe, não área.
        */}
        <div className="pointer-events-none absolute inset-x-0 bottom-10 flex flex-col items-center gap-3">
          <p className="font-titulo text-[22px] tracking-[0.18em] text-ink">RM MODA ÍNTIMA</p>
          <div className="filete-ouro w-40" aria-hidden />
          {/* Pinyon Script vive SÓ aqui — nunca em texto corrido. */}
          <p className="assinatura text-[19px] text-ink-soft">by Regiane Carvalho</p>

          {usar3d && (
            <p className="mt-3 text-[12px] text-ink-faint">Arraste para girar</p>
          )}
        </div>
      </section>

      <section className="grid place-items-center px-8 py-10">
        {/*
          O formulário num cartão.

          Era o único bloco do sistema flutuando solto sobre o fundo — em
          todas as outras telas, conteúdo mora sobre superfície branca com
          borda e sombra. Sem o cartão a coluna da direita lia como espaço
          vazio com três campos no meio; com ele, o bloco tem peso e a tela
          passa a falar a mesma língua do resto.
        */}
        <Cartao className="moldura-ouro w-full max-w-[380px] p-9">
          <form onSubmit={handleSubmit(submeter)}>
            <h1 className="text-[34px]">{saudacao()}</h1>
            <p className="mt-1 text-[15px] text-ink-soft">Identifique-se para abrir o caixa</p>

            {/*
              O filete separa o cumprimento dos campos. Não é só enfeite: ele
              divide a parte que se LÊ da parte que se PREENCHE, e é aí que o
              ouro pode aparecer sem disputar com o botão vinho, que continua
              sendo a única coisa que se clica.
            */}
            <div className="filete-ouro my-7 w-full" aria-hidden />

            <div className="flex flex-col gap-4">
              <Campo
                rotulo="Operadora"
                autoFocus
                autoComplete="username"
                erro={errors.login?.message}
                {...register('login')}
              />
              <Campo
                rotulo="Senha"
                type="password"
                autoComplete="current-password"
                erro={errors.senha?.message}
                {...register('senha')}
              />

              {erro && <Erro>{erro}</Erro>}

              <Botao
                type="submit"
                variante="primario"
                tamanho="grande"
                disabled={entrando}
                className="mt-2 w-full"
              >
                {entrando ? 'Entrando…' : 'Entrar'}
              </Botao>
            </div>
          </form>
        </Cartao>
      </section>
    </div>
  );
}
