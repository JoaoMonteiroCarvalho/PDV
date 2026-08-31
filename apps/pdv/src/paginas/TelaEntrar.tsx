/**
 * Login / seleção de operadora.
 *
 * VERSÃO DA FASE 0 — funcional, mas ainda sem a cena 3D. A composição já é a
 * final: o palco do objeto à esquerda ocupando a maior parte da tela, o
 * formulário pequeno e discreto ao lado, nunca por cima. Na Fase 1 o painel
 * neutro vira a cena 3D, sem mexer no formulário.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Botao, Campo, Erro } from '../componentes/base.js';
import { useSessao } from '../estado/sessaoStore.js';

const esquema = z.object({
  login: z.string().min(1, 'Informe o usuário'),
  senha: z.string().min(1, 'Informe a senha'),
});
type Entrada = z.infer<typeof esquema>;

export function TelaEntrar() {
  const operadora = useSessao((estado) => estado.operadora);
  const entrar = useSessao((estado) => estado.entrar);
  const erro = useSessao((estado) => estado.erro);
  const entrando = useSessao((estado) => estado.entrando);
  const navegar = useNavigate();
  const local = useLocation();

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
    <div className="grid h-screen grid-cols-1 bg-bg lg:grid-cols-[1.4fr_1fr]">
      {/*
        Palco do objeto. Na Fase 1 recebe a cena 3D; por ora, o mesmo respiro
        visual com um fundo neutro — nunca um placeholder cinza feio.
      */}
      <section className="relative hidden place-items-center overflow-hidden bg-sunken lg:grid">
        <div className="size-64 rounded-[32px] bg-surface elevado" aria-hidden />
        <p className="absolute bottom-8 text-[13px] text-ink-faint">
          Cena 3D entra na Fase 1
        </p>
      </section>

      <section className="grid place-items-center px-8">
        <form onSubmit={handleSubmit(submeter)} className="w-full max-w-[320px]">
          <h1 className="text-[26px]">Bom dia</h1>
          <p className="mt-1 mb-8 text-[15px] text-ink-soft">Identifique-se para abrir o caixa</p>

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

            <Botao type="submit" variante="primario" tamanho="grande" disabled={entrando} className="mt-2 w-full">
              {entrando ? 'Entrando…' : 'Entrar'}
            </Botao>
          </div>
        </form>
      </section>
    </div>
  );
}
