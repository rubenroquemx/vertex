// Almacenamiento de objetos para las fotos de la INE (Cloudflare R2 o cualquier servicio compatible con S3).
// Con un millón de promovidos las fotos suman ~150 GB: fuera de PostgreSQL no llenan el disco del servidor
// y los respaldos de la base siguen siendo pequeños.
//
// Se activa con estas variables de entorno (si falta alguna, las fotos se quedan en PostgreSQL como antes):
//   ALMACEN_ENDPOINT    p. ej. https://<cuenta>.r2.cloudflarestorage.com
//   ALMACEN_BUCKET      nombre del bucket (privado: las fotos solo se sirven a través de la app)
//   ALMACEN_ACCESS_KEY  y  ALMACEN_SECRET_KEY   token de API con permiso de lectura y escritura
//   ALMACEN_REGION      opcional (R2 usa "auto")
//
// Las fotos se suben con una clave única por versión (ine/<promovido>/<lado>-<aleatorio>.webp). Al borrar o
// reemplazar una foto, un disparador de la base anota la clave anterior en almacen_pendientes y un proceso en
// segundo plano la borra del bucket, así nunca se borra un objeto que la base todavía usa.
const crypto = require('crypto');
const { AwsClient } = require('aws4fetch');
const { query } = require('./db');
const { esWebp } = require('./fotos');

const cfg = {
  endpoint: (process.env.ALMACEN_ENDPOINT || '').replace(/\/+$/, ''),
  bucket: process.env.ALMACEN_BUCKET || '',
  accessKeyId: process.env.ALMACEN_ACCESS_KEY || '',
  secretAccessKey: process.env.ALMACEN_SECRET_KEY || '',
  region: process.env.ALMACEN_REGION || 'auto',
};
const activo = Boolean(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
const cliente = activo ? new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: cfg.region, retries: 4 }) : null;

class AlmacenError extends Error {}

const url = (clave) => `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${clave.split('/').map(encodeURIComponent).join('/')}`;

function pedir(metodo, clave, body, headers = {}) {
  if (!activo) throw new AlmacenError('El almacenamiento de fotos no está configurado.');
  return cliente.fetch(url(clave), { method: metodo, body, headers });
}

// Clave nueva e irrepetible para una foto de la INE
const claveIne = (promovidoId, lado, buf) => `ine/${promovidoId}/${lado}-${crypto.randomBytes(6).toString('hex')}.${esWebp(buf) ? 'webp' : 'jpg'}`;

async function guardar(clave, buf) {
  const res = await pedir('PUT', clave, buf, { 'Content-Type': esWebp(buf) ? 'image/webp' : 'image/jpeg', 'Content-Length': String(buf.length) });
  if (!res.ok) throw new AlmacenError(`No se pudo guardar la foto (${res.status}).`);
  return clave;
}

async function leer(clave) {
  const res = await pedir('GET', clave);
  if (res.status === 404) return null;
  if (!res.ok) throw new AlmacenError(`No se pudo leer la foto (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

async function borrar(clave) {
  const res = await pedir('DELETE', clave);
  if (!res.ok && res.status !== 404) throw new AlmacenError(`No se pudo borrar la foto (${res.status}).`);
}

// Sube las fotos de una captura antes de escribir en la base. Devuelve { lado: clave } y una función
// para deshacer (borrar lo subido) si la transacción falla.
async function subirIne(promovidoId, fotos) {
  const claves = {};
  for (const [lado, buf] of Object.entries(fotos)) if (buf) claves[lado] = claveIne(promovidoId, lado, buf);
  const deshacer = () => Promise.all(Object.values(claves).map((c) => borrar(c).catch(() => {})));
  const r = await Promise.allSettled(Object.entries(claves).map(([lado, clave]) => guardar(clave, fotos[lado])));
  const fallo = r.find((x) => x.status === 'rejected');
  if (fallo) {
    await deshacer();
    throw fallo.reason;
  }
  return { claves, deshacer };
}

// Foto de una fila de promovido_ine: la que esté en la base o la del bucket
async function imagenDe(fila) {
  if (fila.image) return fila.image;
  if (!fila.objeto) return null;
  if (!activo) {
    console.error('Fotos: hay fotos en el almacenamiento de objetos pero faltan las variables ALMACEN_*.');
    return null;
  }
  return leer(fila.objeto);
}

// ---------- Procesos en segundo plano ----------
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Borra del bucket las fotos que la base ya no usa
let borrando = false;
async function borrarPendientes() {
  if (!activo || borrando) return;
  borrando = true;
  try {
    for (;;) {
      const { rows } = await query('SELECT objeto FROM almacen_pendientes ORDER BY at LIMIT 200');
      if (!rows.length) break;
      const hechos = [];
      for (let i = 0; i < rows.length; i += 8) {
        const lote = rows.slice(i, i + 8);
        const r = await Promise.allSettled(lote.map((x) => borrar(x.objeto)));
        r.forEach((x, j) => x.status === 'fulfilled' && hechos.push(lote[j].objeto));
      }
      if (hechos.length) await query('DELETE FROM almacen_pendientes WHERE objeto = ANY($1)', [hechos]);
      if (hechos.length < rows.length) break; // el bucket no responde: se reintenta en la siguiente vuelta
    }
  } catch (err) {
    console.error('Fotos: no se pudieron borrar las fotos pendientes:', err.message);
  } finally {
    borrando = false;
  }
}

// Pasa al bucket las fotos de la INE que siguen guardadas en PostgreSQL, por lotes y sin acaparar el servidor
async function migrarExistentes() {
  if (!activo) return;
  let movidas = 0;
  let bytes = 0;
  try {
    for (;;) {
      const { rows } = await query('SELECT promovido_id, lado, image FROM promovido_ine WHERE image IS NOT NULL LIMIT 25');
      if (!rows.length) break;
      await Promise.all(
        rows.map(async (r) => {
          const clave = await guardar(claveIne(r.promovido_id, r.lado, r.image), r.image);
          // Si la foto cambió mientras se subía, la copia subida sobra y se anota para borrarla
          const u = await query('UPDATE promovido_ine SET objeto = $3, image = NULL WHERE promovido_id = $1 AND lado = $2 AND image = $4', [
            r.promovido_id,
            r.lado,
            clave,
            r.image,
          ]);
          if (!u.rowCount) await query('INSERT INTO almacen_pendientes (objeto) VALUES ($1) ON CONFLICT DO NOTHING', [clave]);
          else {
            movidas += 1;
            bytes += r.image.length;
          }
        })
      );
      await espera(100);
    }
    if (movidas) console.log(`Fotos: ${movidas} fotos de INE pasaron al almacenamiento de objetos (${(bytes / 1048576).toFixed(1)} MB fuera de PostgreSQL)`);
  } catch (err) {
    console.error('Fotos: no se pudieron pasar las fotos al almacenamiento de objetos:', err.message);
  }
}

function iniciar() {
  if (!activo) return;
  console.log(`Fotos de la INE: almacenamiento de objetos (${cfg.bucket})`);
  setTimeout(() => migrarExistentes().then(borrarPendientes), 15000);
  setInterval(borrarPendientes, 5 * 60000).unref();
}

module.exports = { activo, AlmacenError, subirIne, imagenDe, borrarPendientes, migrarExistentes, iniciar };
