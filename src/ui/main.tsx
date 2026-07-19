import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginGate } from '../obr/client';
import { App } from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <PluginGate fallback={<App outsideOwlbear />}>
      <App />
    </PluginGate>
  </StrictMode>,
);
