/**
 * CPF: validação e formatação.
 *
 * Mora no `shared` porque os DOIS lados precisam concordar. Se o caixa
 * aceitasse um CPF que a API recusa, a operadora cadastraria a cliente, veria
 * "ok", e o cadastro nunca chegaria ao servidor — o pior tipo de erro, porque
 * ninguém percebe na hora.
 *
 * A validação é o dígito verificador de verdade, não "tem 11 números". Num
 * cadastro de crediário o CPF é o que liga a dívida a uma pessoa: aceitar
 * qualquer sequência de 11 dígitos cria fiado no nome de ninguém, e é
 * exatamente aí que a loja não consegue cobrar.
 *
 * O CPF é OPCIONAL no cadastro — a loja atende quem não quer informar, e
 * exigi-lo perderia venda. Mas quando informado, tem que ser válido.
 */

export class ErroCpf extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroCpf';
  }
}

/** Tira ponto, traço e espaço. O que sobra é o que se valida e o que se guarda. */
export function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

/**
 * Sequências como 111.111.111-11 passam no cálculo do dígito verificador.
 * São inválidas na prática e é o que alguém digita para "pular" o campo.
 */
function todosIguais(digitos: string): boolean {
  return /^(\d)\1{10}$/.test(digitos);
}

function calcularDigito(digitos: string, pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < pesoInicial - 1; i += 1) {
    soma += Number(digitos[i]) * (pesoInicial - i);
  }
  const resto = (soma * 10) % 11;
  // 10 e 11 viram 0: é a regra da Receita, não um atalho.
  return resto >= 10 ? 0 : resto;
}

export function cpfValido(entrada: string | null | undefined): boolean {
  if (!entrada) return false;
  const digitos = somenteDigitos(entrada);

  if (digitos.length !== 11) return false;
  if (todosIguais(digitos)) return false;

  return (
    calcularDigito(digitos, 10) === Number(digitos[9]) &&
    calcularDigito(digitos, 11) === Number(digitos[10])
  );
}

/**
 * Normaliza para gravar: só dígitos.
 *
 * Guardar formatado criaria dois CPFs diferentes para a mesma pessoa
 * ("123.456.789-09" e "12345678909") e a busca por um não acharia o outro —
 * com o índice único do banco deixando passar a duplicata.
 */
export function normalizarCpf(entrada: string): string {
  const digitos = somenteDigitos(entrada);
  if (!cpfValido(digitos)) {
    throw new ErroCpf('CPF inválido. Confira os números com a cliente.');
  }
  return digitos;
}

/** Formata para exibir: 123.456.789-09. Nunca para gravar. */
export function formatarCpf(digitos: string): string {
  const limpo = somenteDigitos(digitos);
  if (limpo.length !== 11) return digitos;
  return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
}

/**
 * Máscara progressiva, para o campo ir formatando enquanto se digita.
 * Aceita entrada parcial sem reclamar — quem está digitando ainda não errou.
 */
export function mascararCpf(entrada: string): string {
  const d = somenteDigitos(entrada).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
