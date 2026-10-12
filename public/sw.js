// Service worker de VERTEX
// Incrementa la versión al cambiar archivos del "app shell".
const VERSION = 'v65';
const CACHE = `vertex-${VERSION}`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/lib.js',
  '/js/coordinador.js',
  '/js/eliminar.js',
  '/js/zonas.js',
  '/js/escritorio-cpv.js',
  '/js/responsables.js',
  '/js/configuracion-cpv.js',
  '/js/configuracion-sa.js',
  '/js/panel-seccion.js',
  '/js/promovidos.js',
  '/js/ine-camara.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
  '/brand/logo-oscuro.svg',
  '/brand/icono.svg',
  '/brand/logo-claro.svg',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: siempre red (los datos no se cachean aquí)
  if (url.pathname.startsWith('/api/')) return;

  // Navegación: red primero, con respaldo al shell en caché (SPA offline)
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-cache' }).catch(() => caches.match('/index.html')));
    return;
  }

  // Estáticos: red primero (siempre la versión más reciente en línea), caché si no hay conexión
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
