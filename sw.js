/**
 * ============================================================
 * ARISANKITA - SERVICE WORKER v4
 * ============================================================
 * Strategi:
 * - Cache shell (HTML/CSS/JS) → load cepat
 * - JANGAN cache request ke Apps Script (data selalu fresh)
 * - Network-first untuk HTML/CSS/JS → selalu coba server dulu
 * - Fallback ke cache kalau offline
 * ============================================================
 */

const CACHE_NAME = 'arisan-kita-v20';
const CACHE_VERSION = 20;
const SHELL_ASSETS = [
  './',
  './index.html',
  './login.html',
  './dashboard.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ============================================================
   INSTALL: Cache shell assets
   ============================================================ */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching shell assets');
        return cache.addAll(SHELL_ASSETS).catch(err => {
          console.warn('[SW] Cache partial fail:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

/* ============================================================
   ACTIVATE: Hapus cache lama
   ============================================================ */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

/* ============================================================
   FETCH: Strategi per jenis resource
   ============================================================ */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. SKIP: request ke Apps Script (data harus fresh)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }

  // 2. SKIP: request POST/PUT/DELETE (hanya GET yang di-cache)
  if (event.request.method !== 'GET') return;

  // 3. SKIP: cross-origin request
  if (url.origin !== self.location.origin) return;

  // 4. NETWORK-FIRST: coba server dulu, fallback cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Simpan versi terbaru ke cache
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline → fallback ke cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback halaman offline untuk navigasi
          if (event.request.mode === 'navigate') {
            return caches.match('./dashboard.html');
          }
          return new Response('Offline', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});

/* ============================================================
   MESSAGE: Force update dari client
   ============================================================ */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache cleared');
    });
  }
});
