import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // O caixa precisa abrir mesmo sem rede: o shell do app é pré-cacheado.
      workbox: {
        // .glb entra no pre-cache: o preview 3D precisa funcionar se a
        // internet cair no meio do expediente.
        globPatterns: ['**/*.{js,css,html,svg,woff2,glb}'],
        // Modelos 3D sao maiores que o teto padrao de 2 MB do Workbox.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Nunca cachear a API: dado de venda e catálogo tem caminho próprio
        // (IndexedDB). Cache de resposta HTTP aqui só criaria preço fantasma.
        navigateFallbackDenylist: [/^\/api/],
      },
      manifest: {
        name: 'PDV — Caixa',
        short_name: 'Caixa',
        description: 'Ponto de venda offline-first',
        theme_color: '#FBFBFD',
        background_color: '#FBFBFD',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: '/',
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
});
