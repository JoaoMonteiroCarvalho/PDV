import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // O caixa precisa abrir mesmo sem rede: o shell do app é pré-cacheado.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Nunca cachear resposta de API: dado de venda e catálogo têm caminho
        // próprio (IndexedDB). Cache HTTP aqui só criaria preço fantasma.
        navigateFallbackDenylist: [/^\/api/],
      },
      manifest: {
        name: 'PDV — Caixa',
        short_name: 'Caixa',
        description: 'Ponto de venda para loja de moda íntima',
        theme_color: '#0B1220',
        background_color: '#0B1220',
        // Terminal dedicado de notebook: sem barra de endereço, para o
        // operador não fechar a aba sem querer no meio de uma venda.
        display: 'fullscreen',
        start_url: '/',
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Porta diferente da do frontend antigo (5173), para os dois poderem
    // rodar lado a lado durante a transição.
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
});
