import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/shell.css';
import './ui/styles/components.css';
import './ui/styles/screens.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소를 찾지 못했습니다');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
