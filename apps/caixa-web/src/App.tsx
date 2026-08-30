import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { iniciarMotorSincronizacao } from '@/banco-local/motorSincronizacao.js';
import { PortaDeEntrada } from '@/app/PortaDeEntrada.js';
import { clienteQuery } from '@/servicos/clienteQuery.js';

export function App() {
  useEffect(() => {
    // Uma vez por carregamento da página. A primeira chamada interna a
    // processarFila() É a retomada da fila: se havia venda pendente de uma
    // sessão anterior (página recarregada, navegador fechado offline), ela
    // volta a tentar sozinha a partir daqui.
    iniciarMotorSincronizacao();
  }, []);

  return (
    <QueryClientProvider client={clienteQuery}>
      <BrowserRouter>
        <Routes>
          {/* Login, terminal e abertura de caixa são PRÉ-REQUISITO da venda,
              não passos que o operador navega — por isso ficam dentro do
              mesmo portão condicional, não em rotas próprias. Rotas
              distintas (produtos, clientes, relatórios...) chegam nas
              próximas fases, quando existirem telas de fato para navegar. */}
          <Route path="*" element={<PortaDeEntrada />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
