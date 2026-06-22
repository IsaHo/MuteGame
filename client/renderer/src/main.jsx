import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';

/*
 * B2.2 — capture any window-level error / unhandledrejection that
 * escapes React. Sent via IPC to main → crash_log via server.
 * window.onerror catches sync errors outside React; the
 * unhandledrejection handler catches stray promise rejections that
 * aren't awaited inside React boundaries.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    try {
      const ipc = window.electron;
      if (ipc && typeof ipc.reportRendererCrash === 'function') {
        ipc.reportRendererCrash({
          message: (e && e.message) || 'window.onerror',
          stack: (e && e.error && e.error.stack) || '',
          details: {
            kind: 'window.error',
            filename: e && e.filename,
            lineno: e && e.lineno,
            colno: e && e.colno,
          },
        });
      }
    } catch (_) { /* don't throw from error handler */ }
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const ipc = window.electron;
      if (ipc && typeof ipc.reportRendererCrash === 'function') {
        const reason = e && e.reason;
        ipc.reportRendererCrash({
          message: (reason && reason.message) || String(reason),
          stack: (reason && reason.stack) || '',
          details: { kind: 'window.unhandledrejection' },
        });
      }
    } catch (_) {}
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
