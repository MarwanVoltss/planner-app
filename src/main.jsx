import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Register the service worker (background-capable alarms + PWA install).
// When a new version takes control we refresh once so a stale blank cached
// shell is never served (fixes the "white/blank screen after updating" case).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshedOnControl = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshedOnControl) return;
      refreshedOnControl = true;
      // HTTPS / localhost only; do not auto-refresh on file:// (no SW there anyway).
      if (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        window.location.reload();
      }
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')).render(<App />);