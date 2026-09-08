/**
 * Recorte de DIA da loja — não de instante.
 *
 * O servidor trata período como dia civil no fuso dele, e o caixa precisa
 * falar a mesma língua: mandar um ISO com hora (`toISOString()`) faria o dia
 * virar em UTC e a venda das 22h cair no relatório de amanhã.
 *
 * Estas duas funções viviam soltas dentro da tela de relatórios. Saíram de lá
 * quando o atalho de mais vendidos passou a precisar do mesmo recorte: duas
 * cópias de uma regra de fuso é o tipo de coisa que só diverge quando alguém
 * corrige uma delas.
 */

/** `YYYY-MM-DD` no fuso local — o mesmo recorte de dia que o servidor usa. */
export function dataLocal(data: Date): string {
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

/** `YYYY-MM-DD` de N dias atrás, contando a partir de `agora`. */
export function diasAtras(dias: number, agora = new Date()): string {
  const data = new Date(agora);
  data.setDate(data.getDate() - dias);
  return dataLocal(data);
}
