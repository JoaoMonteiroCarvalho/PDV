/**
 * Identificação da gerente para liberar uma operação pontual.
 *
 * Usa `entrarSemTrocarSessao`: a operadora continua logada. Quem está vendendo
 * continua sendo quem está vendendo — a gerente só prova identidade para
 * AQUELA operação. Trocar o token da sessão aqui deslogaria a operadora no
 * meio do expediente.
 *
 * O que fica guardado é o TOKEN assinado que o servidor devolveu, não o id da
 * gerente. O servidor lê quem autorizou da assinatura; o id sozinho não
 * autoriza nada, e foi exatamente por confiar no id que a autorização já foi
 * forjável uma vez.
 */

import { useState } from 'react';
import { clienteApi, type AutorizacaoGerente as Autorizacao } from '../api/cliente.js';
import { ehPapelAutorizador } from '../caixa/movimento.js';
import { Botao, Campo, Cartao, Erro, Selo } from './base.js';

interface Props {
  readonly autorizacao: Autorizacao | null;
  readonly aoAutenticar: (autorizacao: Autorizacao) => void;
  readonly aoSair: () => void;
  /** Por que a liberação está sendo pedida. Some quando já foi concedida. */
  readonly explicacao?: string;
  readonly className?: string;
}

export function AutorizacaoGerente({
  autorizacao,
  aoAutenticar,
  aoSair,
  explicacao = 'A operadora continua logada — a gerente só confirma a identidade para esta operação.',
  className = 'mt-5',
}: Props) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  async function autenticar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setVerificando(true);
    try {
      const { operador, tokenAutorizacao } = await clienteApi.entrarSemTrocarSessao(
        login.trim(),
        senha,
      );
      if (!ehPapelAutorizador(operador.papel)) {
        // Credencial correta, papel errado: dizer isso é mais útil que
        // "credenciais inválidas", e não vaza nada que a pessoa não saiba.
        setErro(`${operador.nome} não tem perfil de gerente e não pode autorizar.`);
        return;
      }
      aoAutenticar({ operador, tokenAutorizacao });
      setLogin('');
      setSenha('');
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível autenticar.');
    } finally {
      setVerificando(false);
    }
  }

  if (autorizacao) {
    return (
      <div
        className={`${className} flex flex-wrap items-center gap-3 rounded-[8px] border border-ok/30 bg-ok/5 px-4 py-3`}
      >
        <Selo tom="ok">Autorizado</Selo>
        <span className="flex-1 text-[14px] text-ink">{autorizacao.operador.nome}</span>
        <Botao variante="discreto" onClick={aoSair} className="h-8 px-3 text-[13px]">
          Trocar
        </Botao>
      </div>
    );
  }

  return (
    <Cartao className={`${className} p-5`}>
      <h2 className="font-titulo text-[16px] font-medium">Autorização da gerente</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">{explicacao}</p>

      <form onSubmit={(evento) => void autenticar(evento)} className="mt-4 flex flex-wrap gap-3">
        <div className="min-w-[10rem] flex-1">
          <Campo
            rotulo="Gerente"
            name="gerente-login"
            autoComplete="off"
            value={login}
            onChange={(evento) => setLogin(evento.target.value)}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Campo
            rotulo="Senha"
            name="gerente-senha"
            type="password"
            autoComplete="off"
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
          />
        </div>
        <Botao
          type="submit"
          variante="neutro"
          className="self-end"
          disabled={verificando || login.trim() === '' || senha === ''}
        >
          {verificando ? 'Verificando…' : 'Autorizar'}
        </Botao>
      </form>

      {erro && (
        <div className="mt-4">
          <Erro>{erro}</Erro>
        </div>
      )}
    </Cartao>
  );
}
