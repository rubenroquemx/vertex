// Captura sin internet (Promotor Territorial):
//  - Base de datos local (IndexedDB) con los promovidos por enviar, el borrador de la captura y
//    lo necesario para capturar sin señal (contexto de la sección y catálogo de códigos postales).
//  - Envío automático al recuperar internet (y en segundo plano en Android), o manual.
//  - Cada captura lleva un identificador propio (clientId): si un envío se repite, el servidor
//    no la duplica.
// El service worker (sw.js) usa la misma base para enviar en segundo plano: si cambias el
// esquema aquí, cámbialo también allá.
const DB = 'vertex-offline';
const VERSION = 1;
export const SYNC_TAG = 'vx-pendientes';

// Cuenta en uso (la fija app.js al iniciar): cada pendiente se guarda a su nombre
export const sesion = { userId: null };

let dbPromise = null;
function abrir() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador no permite guardar sin conexión.'));
  dbPromise ||= new Promise((ok, fail) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { keyPath: 'clientId' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
  return dbPromise;
}
async function tx(store, modo, fn) {
  const db = await abrir();
  return new Promise((ok, fail) => {
    const t = db.transaction(store, modo);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => ok(r?.result);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
  });
}

// ---------- Llave-valor: contexto, catálogo de CP, borrador ----------
export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => s.get(k)).catch(() => undefined),
  set: (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)).catch(() => {}),
  del: (k) => tx('kv', 'readwrite', (s) => s.delete(k)).catch(() => {}),
};

// ---------- Promovidos por enviar ----------
const avisar = () => window.dispatchEvent(new CustomEvent('vx:pendientes'));
export const pendientes = {
  async todos(ownerId) {
    const lista = (await tx('pendientes', 'readonly', (s) => s.getAll()).catch(() => [])) || [];
    return lista.filter((p) => !ownerId || p.ownerId === ownerId).sort((a, b) => a.creado.localeCompare(b.creado));
  },
  get: (id) => tx('pendientes', 'readonly', (s) => s.get(id)).catch(() => undefined),
  async poner(item) {
    await tx('pendientes', 'readwrite', (s) => s.put(item));
    avisar();
  },
  async quitar(id) {
    await tx('pendientes', 'readwrite', (s) => s.delete(id)).catch(() => {});
    avisar();
  },
  async borrarTodo() {
    await tx('pendientes', 'readwrite', (s) => s.clear()).catch(() => {});
    avisar();
  },
};

// Al cerrar sesión: se borra todo lo guardado en el teléfono
export async function borrarDatosLocales() {
  await pendientes.borrarTodo();
  await tx('kv', 'readwrite', (s) => s.clear()).catch(() => {});
}

// Error de red (sin señal o servidor inalcanzable), distinto de un error que respondió el servidor
export const esErrorDeRed = (err) => !err?.status;

// ---------- Preparación (con internet): contexto, catálogo de CP y almacenamiento persistente ----------
export async function prepararSinConexion(api) {
  try {
    navigator.storage?.persist?.().catch(() => {});
    const ctx = await api('/api/promovidos/contexto');
    await kv.set('contexto', ctx);
    const cat = await kv.get('cpCatalogo');
    if (!cat || cat.entidad !== ctx.entidad.clave || Date.now() - (cat.guardado || 0) > 7 * 86400000) {
      const c = await api(`/api/cp/estado/${ctx.entidad.clave}`);
      await kv.set('cpCatalogo', { ...c, guardado: Date.now() });
    }
  } catch {
    // Sin internet o sin sección: se usa lo que ya esté guardado
  }
}

// Código postal desde el catálogo guardado (mismo formato que /api/cp/:cp)
export async function buscarCPLocal(cp) {
  const cat = await kv.get('cpCatalogo');
  const x = cat?.cps?.[cp];
  if (!x) return null;
  return { cp, municipio: x[0], estado: x[1], ciudad: x[2], asentamientos: x[3].map(([nombre, tipo]) => ({ nombre, tipo })) };
}

// ---------- Envío ----------
let enviando = null;
let sesionVencida = false;
export const estadoSync = () => ({ enviando: Boolean(enviando), sesionVencida });

// Envía los pendientes del usuario, uno por uno y en orden. Devuelve { enviados, errores }.
export function sincronizar(ownerId) {
  if (enviando) return enviando;
  enviando = (async () => {
    const res = { enviados: 0, errores: 0 };
    if (!navigator.onLine || !ownerId) return res;
    for (const p of await pendientes.todos(ownerId)) {
      if (p.estado === 'error') continue;
      await pendientes.poner({ ...p, estado: 'enviando' });
      let r;
      try {
        r = await fetch('/api/promovidos', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p.body),
        });
      } catch {
        // Sin señal: se queda pendiente para el siguiente intento
        await pendientes.poner({ ...p, estado: 'pendiente' });
        break;
      }
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        await pendientes.quitar(p.clientId);
        res.enviados += 1;
        sesionVencida = false;
      } else if (r.status === 401) {
        sesionVencida = true;
        await pendientes.poner({ ...p, estado: 'pendiente' });
        break;
      } else if (r.status >= 500) {
        await pendientes.poner({ ...p, estado: 'pendiente' });
        break;
      } else {
        // Datos rechazados por el servidor (p. ej. ya registrado por otro promotor): lo corrige el promotor
        // El primer campo con problema dice más que el mensaje general («Revisa los datos marcados»)
        const detalle = data.fields ? Object.values(data.fields)[0] : null;
        await pendientes.poner({ ...p, estado: 'error', error: detalle || data.error || 'No se pudo guardar', fields: data.fields || null });
        res.errores += 1;
      }
    }
    return res;
  })().finally(() => {
    enviando = null;
    avisar();
  });
  return enviando;
}

// Pide al navegador enviar en segundo plano en cuanto haya señal (Android/Chrome; iOS no lo permite)
export async function pedirEnvioEnSegundoPlano() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    await reg?.sync?.register(SYNC_TAG);
  } catch {
    // Sin soporte: se envía al abrir la app con internet
  }
}

// Reintentos automáticos: al volver la señal, al regresar a la app y cada minuto si hay pendientes
export function iniciarSincronizacion(ownerId, alTerminar) {
  const intentar = async () => {
    const r = await sincronizar(ownerId);
    if (r.enviados || r.errores) alTerminar?.(r);
  };
  window.addEventListener('online', intentar);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && intentar());
  setInterval(async () => {
    if ((await pendientes.todos(ownerId)).some((p) => p.estado !== 'error')) intentar();
  }, 60000);
  // El service worker avisa cuando envió algo en segundo plano
  navigator.serviceWorker?.addEventListener('message', (e) => e.data?.tipo === 'pendientes' && avisar());
  intentar();
}
