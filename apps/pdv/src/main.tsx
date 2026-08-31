/**
 * Ponto de entrada.
 *
 * Ordem importa: o tema é aplicado ANTES do primeiro render (o `index.html`
 * já vem com `light`, aqui só reaplicamos uma escolha manual salva), e o
 * motor de sincronização sobe acima das rotas — a fila de vendas precisa
 * continuar subindo mesmo quando a operadora sai da tela de venda.
 */

import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/karla/400.css';
import '@fontsource/karla/500.css';
import '@fontsource/karla/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './estilo.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { iniciarTema } from './design/tema.js';
import { roteador } from './rotas.js';

iniciarTema();

const clienteQuery = new QueryClient({
  defaultOptions: {
    queries: {
      // O catálogo local (IndexedDB) é a fonte de verdade para vender. O que
      // vem da rede é complemento — refetch agressivo só gastaria banda da
      // loja sem melhorar a operação.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/*
 * O motor de sincronização NÃO sobe aqui. Sem operadora logada não há token,
 * e ele saía batendo na API tomando 401 antes de alguém entrar. Quem o liga é
 * o Shell, que só existe depois do login.
 */

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Elemento #raiz não encontrado no index.html');

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={clienteQuery}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>
  </StrictMode>,
);
