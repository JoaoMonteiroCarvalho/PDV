import type { Config } from 'tailwindcss';

/**
 * Tokens de design do PDV.
 *
 * Poucas cores, alto contraste — pensado para operador em pé, com o cliente
 * na frente, sob luz de loja ruim. Nunca cinza-claro sobre branco: o texto
 * secundário mais fraco (--texto-secundario) ainda passa em contraste AA
 * contra o fundo escuro.
 *
 * Cores semânticas (perigo/sucesso/alerta) são as ÚNICAS variações de matiz
 * além do acento — tudo o mais é escala de cinza-azulado. Isso é proposital:
 * numa tela de venda, cor precisa significar alguma coisa, não decorar.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fundo: '#0B1220',
        superficie: '#151E32',
        'superficie-alta': '#1E2A47',
        borda: '#2A3752',
        texto: '#F5F7FA',
        'texto-secundario': '#9AA6BF',
        acento: {
          DEFAULT: '#4F7CFF',
          hover: '#6B90FF',
          texto: '#0B1220',
        },
        perigo: {
          DEFAULT: '#F0475C',
          hover: '#F5677A',
        },
        sucesso: {
          DEFAULT: '#2FBF71',
          hover: '#4ED68C',
        },
        alerta: {
          DEFAULT: '#F5A623',
          hover: '#F7B84D',
        },
      },
      fontSize: {
        // Escala curta e nomeada pelo USO, não por T-shirt size — quem for
        // usar sabe exatamente onde aplicar cada tamanho.
        total: ['40px', { lineHeight: '1.1', fontWeight: '700' }],
        valor: ['20px', { lineHeight: '1.3', fontWeight: '600' }],
        corpo: ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        rotulo: ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      spacing: {
        // Escala de 4px. Tailwind já cobre isso por padrão (1 = 4px), mas o
        // alvo mínimo de toque/clique (44px) ganha um nome para não virar
        // "h-11" mágico espalhado pelo código.
        alvo: '44px',
      },
      borderRadius: {
        // Escala mais arredondada de propósito — nada de canto vivo no
        // sistema. `lg` é o raio que praticamente todo card/modal/painel usa
        // (`rounded-lg`), então subir esse valor sozinho já suaviza o app
        // inteiro sem precisar tocar em cada tela.
        DEFAULT: '14px',
        lg: '22px',
        xl: '28px',
      },
      boxShadow: {
        // Sombra ambiente suave em vez de borda dura — a profundidade vem de
        // luz, não de linha. Usada nos cards via globals.css (`.border-borda`)
        // e disponível como utilitário (`shadow-suave`) pra quem precisar.
        suave: '0 8px 24px -8px rgb(4 8 20 / 0.45), 0 2px 8px -2px rgb(4 8 20 / 0.3)',
        'suave-lg': '0 20px 48px -12px rgb(4 8 20 / 0.55), 0 8px 20px -6px rgb(4 8 20 / 0.35)',
        foco: '0 0 0 4px rgb(79 124 255 / 0.25)',
      },
    },
  },
  plugins: [],
} satisfies Config;
