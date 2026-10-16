// Service worker de VERTEX
// Incrementa la versión al cambiar archivos del "app shell".
const VERSION = 'v89';
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
  '/js/promovidos.js',
  '/js/ine-camara.js',
  '/js/notificaciones.js',
  '/js/material.js',
  '/js/panel-sa.js',
  '/js/escritorio-zona.js',
  '/js/escritorio-seccion.js',
  '/js/revision.js',
  '/js/escritorio-promotor.js',
  '/js/informe.js',
  '/js/agenda.js',
  '/js/offline.js',
  '/js/pendientes.js',
  '/js/bitacora.js',
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

  // Navegación: red primero, con respaldo al shell en caché (SPA offline). Con señal débil no
  // se espera más de 4 s: se abre la versión guardada para poder capturar.
  if (request.mode === 'navigate') {
    event.respondWith(redOCache(request, '/index.html'));
    return;
  }

  // Estáticos: red primero (siempre la versión más reciente en línea), caché si no hay conexión
  event.respondWith(redOCache(request));
});

// Red primero; si no hay red, o tarda más de 4 s y ya hay copia guardada, se usa la caché.
// La respuesta de la red, cuando llega, actualiza la caché de los estáticos.
function redOCache(request, respaldo = null) {
  const red = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res.ok && !respaldo) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  });
  return new Promise((ok, fail) => {
    let listo = false;
    const usar = (r) => {
      if (!listo) {
        listo = true;
        ok(r);
      }
    };
    const t = setTimeout(async () => {
      const c = await caches.match(respaldo || request);
      if (c) usar(c);
    }, 4000);
    red.then(
      (r) => {
        clearTimeout(t);
        usar(r);
      },
      async (e) => {
        clearTimeout(t);
        const c = await caches.match(respaldo || request);
        if (c) usar(c);
        else if (!listo) {
          listo = true;
          fail(e);
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Envío en segundo plano de los promovidos capturados sin internet (Android/Chrome).
// Misma base que public/js/offline.js (vertex-offline · pendientes).
// ---------------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag === 'vx-pendientes') event.waitUntil(enviarPendientes());
});

function idb() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open('vertex-offline', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { keyPath: 'clientId' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
function operar(db, modo, fn) {
  return new Promise((ok, fail) => {
    const t = db.transaction('pendientes', modo);
    const r = fn(t.objectStore('pendientes'));
    t.oncomplete = () => ok(r && r.result);
    t.onerror = () => fail(t.error);
  });
}

async function enviarPendientes() {
  const db = await idb();
  const lista = ((await operar(db, 'readonly', (s) => s.getAll())) || []).filter((p) => p.estado !== 'error').sort((a, b) => a.creado.localeCompare(b.creado));
  let cambios = false;
  for (const p of lista) {
    let r;
    try {
      r = await fetch('/api/promovidos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.body) });
    } catch (err) {
      // Sin señal todavía: el navegador reintentará
      throw err;
    }
    if (r.ok) {
      await operar(db, 'readwrite', (s) => s.delete(p.clientId));
      cambios = true;
    } else if (r.status === 401 || r.status >= 500) {
      break; // se envía al abrir la app (sesión) o en el siguiente intento
    } else {
      const data = await r.json().catch(() => ({}));
      const detalle = data.fields ? Object.values(data.fields)[0] : null;
      await operar(db, 'readwrite', (s) => s.put({ ...p, estado: 'error', error: detalle || data.error || 'No se pudo guardar', fields: data.fields || null }));
      cambios = true;
    }
  }
  if (cambios) {
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ tipo: 'pendientes' });
  }
}

// ---------------------------------------------------------------------------
// Notificaciones push: se muestran aunque la app esté cerrada; al tocarlas se abre su pantalla
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { titulo: event.data ? event.data.text() : 'VERTEX' };
  }
  event.waitUntil(
    self.registration.showNotification(d.titulo || 'VERTEX', {
      body: d.cuerpo || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      data: { url: d.url || '/notificaciones' },
      tag: d.url || undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of ventanas) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          c.postMessage({ tipo: 'abrir', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
