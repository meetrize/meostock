import { installBrowserTranslationGuard } from './utils/browserTranslationGuard';
import './instrumentation';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// 在 createRoot 前安装：挡住翻译插件导致的 removeChild NotFoundError
installBrowserTranslationGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
