import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { OAuthCallback } from './OAuthCallback';
import './styles.css';

const root = document.getElementById('root')!;
const path = window.location.pathname.replace(/\/$/, '') || '/';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    },
    { once: true },
  );
}

createRoot(root).render(
  <StrictMode>
    {path === '/oauth/callback' ? (
      <OAuthCallback />
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
);
