import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Support being served under a sub-path (e.g. the Rancher cluster Service proxy
// at /k8s/clusters/<id>/api/v1/namespaces/<ns>/services/http:<svc>:<port>/proxy/).
// The app makes absolute "/api/..." requests; rewrite them to be relative to
// wherever index.html was loaded from so they reach the backend through the
// proxy. At the app root this is a no-op (apiBase is empty), so direct
// NodePort/Ingress access is unaffected. Static assets use relative paths via
// "homepage": "." in package.json.
const apiBase = window.location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '');
if (apiBase) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = apiBase + input;
    }
    return originalFetch(input, init);
  };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
