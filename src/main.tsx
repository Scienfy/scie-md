import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles/app.css';
import './styles/scientific-document.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
