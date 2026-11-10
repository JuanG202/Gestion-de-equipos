/* ═══════════════════════════════════════════
   SERVICE WORKER — El Mundo de la Tecnología
   Versión de caché: actualiza este número
   cada vez que hagas cambios al código.
   ═══════════════════════════════════════════ */
const CACHE_NAME = 'mundotec-v1';

/* Archivos que se guardan en caché al instalar */
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './precios.html',
  './styles.css',
  './Script.js',
  './manifest.json',
  './assests/trabajando-en-casa.png',
  './assests/El Mundo de la Tecnologia sin fondo.png'
];

/* ── Instalación: pre-cachear todos los archivos ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Guardando archivos en caché...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

/* ── Activación: eliminar cachés viejas ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Eliminando caché vieja:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Estrategia: Network First con fallback a caché ──
   - Intenta siempre traer la versión más reciente de la red.
   - Si no hay conexión, usa la caché guardada.
   - Las llamadas a la API siempre van directo a la red.
*/
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Las peticiones a la API siempre van a la red (sin caché) */
  if (
    url.hostname.includes('vercel.app') ||
    url.hostname.includes('googleapis.com') ||
    url.protocol === 'chrome-extension:'
  ) {
    return; /* dejar pasar sin interceptar */
  }

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        /* Si la respuesta fue exitosa, actualiza la caché */
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => {
        /* Sin conexión: servir desde caché */
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          /* Si no hay caché para esta ruta, devolver index.html */
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

/* ── Notificación de nueva versión disponible ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
