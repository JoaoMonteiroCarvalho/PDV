/**
 * Prova visual do design system.
 *
 * Não é uma tela de produto — é a página que deixa conferir, num lugar só, se
 * os tokens, a tipografia e a separação entre as duas paletas estão coerentes.
 * Fica em `/design`, fora da navegação principal.
 */

import { Botao, Campo, Cartao, Erro, Selo } from '../componentes/base.js';
import { listarCoresProduto, precisaDeContorno } from '../design/coresProduto.js';
import { aplicarTema, temaSalvo } from '../design/tema.js';

export function DesignSystem() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-12">
      <header className="mb-12">
        <p className="text-[13px] font-medium tracking-widest text-ink-faint uppercase">Fase 0</p>
        <h1 className="mt-2 text-[32px]">Design system</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-soft">
          Paleta neutra com um único destaque, tipografia com personalidade e a
          separação entre cor de interface e cor de produto.
        </p>
      </header>

      <Secao titulo="Tipografia" nota="Sora nos títulos, Karla no corpo, IBM Plex Mono em todo número que alinha em coluna.">
        <div className="flex flex-col gap-3">
          <p className="font-titulo text-[32px] font-semibold">Conjunto renda delicada</p>
          <p className="max-w-lg text-[15px] leading-relaxed text-ink-soft">
            Corpo em Karla. Espaço em branco é o material de design mais usado
            aqui — um card com a peça bem centralizada comunica mais qualidade
            que um card cheio de selos.
          </p>
          <div className="num flex gap-8 text-[20px]">
            <span>R$ 89,90</span>
            <span>R$ 129,00</span>
            <span>R$ 1.240,50</span>
          </div>
          <p className="text-[13px] text-ink-faint">
            Os três preços acima alinham na vírgula — é o que impede o total de
            "dançar" quando atualiza.
          </p>
        </div>
      </Secao>

      <Secao titulo="Paleta de interface" nota="Neutro dominante e um azul só. Muda com o tema.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Amostra nome="bg" valor="var(--bg)" />
          <Amostra nome="surface" valor="var(--surface)" />
          <Amostra nome="sunken" valor="var(--surface-sunken)" />
          <Amostra nome="line" valor="var(--line)" />
          <Amostra nome="ink" valor="var(--ink)" escura />
          <Amostra nome="ink-soft" valor="var(--ink-soft)" escura />
          <Amostra nome="accent" valor="var(--accent)" escura />
          <Amostra nome="ok" valor="var(--ok)" escura />
        </div>
      </Secao>

      <Secao
        titulo="Paleta de catálogo"
        nota="As cores reais das peças. NÃO mudam com o tema e nunca derivam do azul de destaque — um sutiã vinho é vinho em qualquer tema."
      >
        <div className="flex flex-wrap gap-5">
          {listarCoresProduto().map((cor) => (
            <div key={cor.chave} className="flex flex-col items-center gap-2">
              <span
                className="size-12 rounded-full"
                style={{
                  background: cor.hex,
                  boxShadow: precisaDeContorno(cor.hex) ? 'inset 0 0 0 1px var(--line)' : undefined,
                }}
              />
              <span className="text-[12px] text-ink-soft">{cor.rotulo}</span>
            </div>
          ))}
        </div>
      </Secao>

      <Secao titulo="Botões" nota="Mesmo raio em botão, card e modal. Destrutivo é discreto até o hover.">
        <div className="flex flex-wrap items-center gap-3">
          <Botao variante="primario">Finalizar venda</Botao>
          <Botao variante="neutro">Buscar produto</Botao>
          <Botao variante="discreto">Cancelar</Botao>
          <Botao variante="perigo">Cancelar venda</Botao>
          <Botao variante="primario" tamanho="grande">
            Ação grande
          </Botao>
          <Botao disabled>Desabilitado</Botao>
        </div>
      </Secao>

      <Secao titulo="Estados" nota="Erro aparece no lugar da ação que falhou, com o que fazer a seguir.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Selo tom="ok">Online</Selo>
            <Selo tom="alerta">Offline — vendendo normalmente</Selo>
            <Selo tom="accent">3 vendas aguardando envio</Selo>
            <Selo tom="perigo">1 com problema — chame o gerente</Selo>
          </div>
          <Erro aoTentarNovamente={() => undefined}>
            Não foi possível consultar o estoque. A venda continua possível — o
            preço usado é o do catálogo local.
          </Erro>
        </div>
      </Secao>

      <Secao titulo="Campos" nota="Alvo alto, foco visível, número com largura tabular.">
        <div className="grid max-w-md gap-4">
          <Campo rotulo="Código do produto" placeholder="EAN-13" numerico />
          <Campo rotulo="Fundo de troco" placeholder="0,00" numerico />
          <Campo rotulo="Campo com erro" defaultValue="abc" erro="Informe apenas números." />
        </div>
      </Secao>

      <Secao
        titulo="Tema"
        nota="Claro é o padrão fixo. O escuro existe como escolha manual — o app nunca herda o tema do sistema operacional sozinho."
      >
        <div className="flex gap-3">
          <Botao onClick={() => aplicarTema('light')} variante={temaSalvo() === 'light' ? 'primario' : 'neutro'}>
            Claro
          </Botao>
          <Botao onClick={() => aplicarTema('dark')} variante={temaSalvo() === 'dark' ? 'primario' : 'neutro'}>
            Escuro
          </Botao>
        </div>
        <p className="mt-3 text-[13px] text-ink-faint">
          Troque o tema e observe: os botões e o fundo mudam, os círculos de cor
          de produto acima não.
        </p>
      </Secao>
    </div>
  );
}

function Secao({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2 className="text-[19px]">{titulo}</h2>
      <p className="mt-1 mb-5 max-w-2xl text-[14px] leading-relaxed text-ink-soft">{nota}</p>
      {children}
    </section>
  );
}

function Amostra({ nome, valor, escura }: { nome: string; valor: string; escura?: boolean }) {
  return (
    <Cartao className="overflow-hidden" elevado={false}>
      <div className="h-16" style={{ background: valor }} />
      <div className="border-t border-line px-3 py-2">
        <p className="text-[13px] font-medium">{nome}</p>
        <p className="text-[11px] text-ink-faint">{escura ? 'texto claro sobre' : 'fundo'}</p>
      </div>
    </Cartao>
  );
}
