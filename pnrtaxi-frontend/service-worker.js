// ============================================================
//  Service Worker — Taxi Pointe-Noire PWA
//  Stratégie : Cache First pour les assets statiques,
//              Network Only pour les données Supabase
// ============================================================

const CACHE_NAME   = 'taxi-pnr-v3';
const CACHE_URLS   = [
  '/',
  '/index.html',
  '/driver.html',
  '/css/style.css',
  '/js/supabase-config.js',
  '/js/passenger.js',
  '/js/driver.js',
  '/js/haversine.js',
  '/manifest.json',
  // Leaflet (depuis CDN — mis en cache au premier accès)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // Fonts
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
];

// ── Installation : pré-cache des assets ──────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pré-cache des assets…');
      // On ignore les erreurs individuelles (ex: CDN offline)
      return Promise.allSettled(
        CACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] Impossible de mettre en cache:', url, err.message);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activation : nettoyage anciens caches ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie hybride ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Ignorer tout ce qui n'est pas http/https (chrome-extension://, etc.)
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // Supabase → Network Only (temps réel, WebSockets, données)
  if (url.hostname.includes('supabase.co')) {
    return; // Laisse le navigateur gérer
  }

  // Tuiles OSM → Cache First avec fallback réseau
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Assets locaux & CDN → Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (!response || !response.ok || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Fallback offline : renvoyer index.html pour navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 503 });
      });
    })
  );
});
