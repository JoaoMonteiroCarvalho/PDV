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
import { Botao, Campo, Erro } from '../componentes/base.js';
import { CORES_PRODUTO } from '../design/coresProduto.js';
import { useSessao } from '../estado/sessaoStore.js';
import { PalcoEstatico } from '../tres/PalcoEstatico.js';
import { podeRenderizar3d } from '../tres/capacidade.js';

const CenaLogin = lazy(() => import('../tres/CenaLogin.js'));

/**
 * Cores da embalagem — da paleta de CATÁLOGO, não da interface. A caixinha
 * continua marfim com fita vinho mesmo se alguém trocar o tema do sistema.
 */
const COR_EMBALAGEM = CORES_PRODUTO.marfim.hex;
const COR_FITA = CORES_PRODUTO.vinho.hex;

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
      <section className="relative hidden overflow-hidden bg-sunken lg:block">
        {usar3d ? (
          <Suspense fallback={<PalcoEstatico cor={COR_EMBALAGEM} corFita={COR_FITA} />}>
            <CenaLogin cor={COR_EMBALAGEM} corFita={COR_FITA} />
          </Suspense>
        ) : (
          <PalcoEstatico cor={COR_EMBALAGEM} corFita={COR_FITA} />
        )}

        {usar3d && (
          <p className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-[12px] text-ink-faint">
            Arraste para girar
          </p>
        )}
      </section>

      <section className="grid place-items-center px-8">
        <form onSubmit={handleSubmit(submeter)} className="w-full max-w-[320px]">
          <h1 className="text-[26px]">{saudacao()}</h1>
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
      </section>
    </div>
  );
}
