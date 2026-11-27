import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@langai/ui/styles/popup.css';
import { PopupApp } from '@langai/ui';
import { SERVICE_DESCRIPTORS } from '../registry';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <PopupApp services={SERVICE_DESCRIPTORS} />
    </StrictMode>
  );
}
