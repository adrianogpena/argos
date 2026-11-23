// Argos service worker: keeps the app shell available offline.
// Live arrivals (/api/...) are never cached and never intercepted.
const CACHE = 'argos-v15';
const SHELL = ['./', './index.html', './onibus.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './carro.html', './gastos.html', './saude.html', './faturas.html', './lib/qr-invoice.js', './lib/receipt.js', './cartao.html', './lib/card-forecast.js', './lib/expenses-report.js', './lib/health-core.js', './lib/expenses-core.js', './lib/classify.js', './lib/vault.js', './lib/car-core.js', './lib/home-core.js', './lib/home-bus.js', './lib/home-view.js', './lib/bus-core.js', './lib/bus-net.js', './lib/argos.css', './lib/nav.js', './lib/theme.js', './lib/fonts/hanken-latin.woff2', './lib/fonts/hanken-latin-ext.woff2', './lib/fonts/saira-600-latin.woff2', './lib/fonts/saira-600-latin-ext.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/') || url.pathname.startsWith('/v1/')) return;   // live data: straight to the network
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;
  // Network first for the page (so updates arrive), cache first for fonts and icons.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
    return;
  }
  if (/\.(js|html|css)$/.test(url.pathname) && url.origin === location.origin) {   // código: rede primeiro, para as correções chegarem
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  })));
});
