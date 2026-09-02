/**
 * Regras da tela de Configurações que não dependem de DOM nem de rede.
 *
 * O servidor valida tudo de novo — estas funções existem para a mensagem
 * aparecer NO CAMPO enquanto a pessoa digita, em vez de voltar como erro 400
 * depois de um clique. Validação de cliente é conveniência; a do servidor é a
 * que vale.
 */

export type Papel = 'OPERADOR' | 'GERENTE' | 'ADMIN';

/** O que cada papel pode, em uma linha, para quem está criando o usuário. */
export const DESCRICAO_DO_PAPEL: Record<Papel, string> = {
  OPERADOR: 'Vende e fecha o caixa.',
  GERENTE: 'Também autoriza sangria, devolução e desconto acima da alçada.',
  ADMIN: 'Tudo do gerente, mais a configuração do sistema.',
};

/**
 * Login é o que se digita com pressa no balcão: minúsculo, sem espaço, sem
 * acento. Normalizar aqui evita o caso em que a pessoa cadastra "Maria " e
 * depois não consegue entrar digitando "maria".
 */
export function normalizarLogin(bruto: string): string {
  return (
    bruto
      .trim()
      .toLowerCase()
      .normalize('NFD')
      // `\p{M}` = marcas de combinação. Depois do NFD, "joão" vira "joa~o" e o
      // til sai aqui, resultando em "joao" — que é o que a pessoa vai digitar.
      .replace(/\p{M}/gu, '')
  );
}

export interface ErrosDeUsuario {
  nome?: string;
  login?: string;
  senha?: string;
  limite?: string;
}

export interface EntradaDeUsuario {
  readonly nome: string;
  readonly login: string;
  readonly senha: string;
  readonly limite: string;
}

/**
 * Valida o formulário de novo usuário. Devolve um objeto vazio quando está
 * tudo certo — a tela testa `Object.keys(erros).length === 0`.
 */
export function validarNovoUsuario(entrada: EntradaDeUsuario): ErrosDeUsuario {
  const erros: ErrosDeUsuario = {};

  if (entrada.nome.trim().length < 2) {
    erros.nome = 'Informe o nome de quem vai usar o sistema.';
  }

  const login = normalizarLogin(entrada.login);
  if (login.length < 3) {
    erros.login = 'O login precisa de pelo menos 3 caracteres.';
  } else if (!/^[a-z0-9._-]+$/.test(login)) {
    erros.login = 'Use apenas letras sem acento, números, ponto, hífen ou sublinhado.';
  }

  if (entrada.senha.length < 6) {
    erros.senha = 'A senha precisa de pelo menos 6 caracteres.';
  }

  const limite = validarLimiteDesconto(entrada.limite);
  if (limite.erro) erros.limite = limite.erro;

  return erros;
}

/**
 * Limite de desconto digitado em PORCENTO, guardado em pontos-base.
 *
 * A operadora pensa em "5%", o banco guarda 500. A conversão fica aqui e não
 * espalhada pela tela, porque errar a escala uma vez só já daria a alguém cem
 * vezes a alçada pretendida.
 */
export function validarLimiteDesconto(bruto: string): {
  bps: number;
  erro?: string;
} {
  const texto = bruto.trim().replace(',', '.');
  if (texto.length === 0) return { bps: 0 };

  const numero = Number(texto);
  if (!Number.isFinite(numero)) {
    return { bps: 0, erro: 'Informe um número, por exemplo 5 para 5%.' };
  }
  if (numero < 0) return { bps: 0, erro: 'O limite não pode ser negativo.' };
  if (numero > 100) return { bps: 0, erro: 'O limite não passa de 100%.' };

  const bps = Math.round(numero * 100);
  return { bps };
}

/** 500 bps → "5" e 1250 → "12,5", para preencher o campo ao editar. */
export function bpsParaCampo(bps: number): string {
  if (bps === 0) return '';
  return String(bps / 100).replace('.', ',');
}

/** 500 → "5%". Usado na lista, onde não se digita. */
export function bpsParaTexto(bps: number): string {
  if (bps === 0) return 'sem alçada';
  return `${String(bps / 100).replace('.', ',')}%`;
}
