/**
 * Tema da interface.
 *
 * Regra central: o tema NUNCA é herdado do sistema operacional. Nada aqui lê
 * `prefers-color-scheme`. O padrão é claro e só muda se a operadora escolher
 * escuro em Configurações — a tela do balcão abrindo escura sozinha, porque
 * o Windows estava em modo escuro, já confundiu gente de verdade.
 *
 * O atributo já vem `light` do `index.html`, então não há flash na abertura;
 * este módulo só aplica uma escolha manual salva.
 */

export type Tema = 'light' | 'dark';

const CHAVE_TEMA = 'pdv.tema';
export const TEMA_PADRAO: Tema = 'light';

function ehTemaValido(valor: string | null): valor is Tema {
  return valor === 'light' || valor === 'dark';
}

/** Tema escolhido manualmente, ou o padrão claro. Nunca consulta o SO. */
export function temaSalvo(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE_TEMA);
    return ehTemaValido(salvo) ? salvo : TEMA_PADRAO;
  } catch {
    // localStorage bloqueado (modo privado, política do navegador): o app
    // continua funcionando no tema padrão em vez de quebrar na inicialização.
    return TEMA_PADRAO;
  }
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.theme = tema;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', tema === 'dark' ? '#000000' : '#FBFBFD');
  try {
    localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    // Sem persistência, o tema vale só para esta sessão — aceitável.
  }
}

/** Chamado uma vez na inicialização, antes do primeiro render. */
export function iniciarTema(): Tema {
  const tema = temaSalvo();
  document.documentElement.dataset.theme = tema;
  return tema;
}
