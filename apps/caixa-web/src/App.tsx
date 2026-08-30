import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { clienteQuery } from '@/servicos/clienteQuery.js';
import { EsbocoTokens } from '@/telas/EsbocoTokens.js';

export function App() {
  return (
    <QueryClientProvider client={clienteQuery}>
      <BrowserRouter>
        <Routes>
          {/* Fase 1 substitui isto por /login, /abertura-de-caixa, /venda... */}
          <Route path="/" element={<EsbocoTokens />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
