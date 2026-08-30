import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './estilos/globals.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('elemento #raiz não encontrado');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
