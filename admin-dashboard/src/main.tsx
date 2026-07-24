import React from 'react';
import { createRoot } from 'react-dom/client';

import { AdminFeedbackProvider } from './AdminFeedback';
import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AdminFeedbackProvider>
      <App />
    </AdminFeedbackProvider>
  </React.StrictMode>,
);
