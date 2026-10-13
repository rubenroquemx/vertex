// Compresión de fotos (INE y evidencia de material): se guardan en WebP de tamaño moderado.
// El teléfono envía JPEG (todos los navegadores lo generan); el servidor lo convierte al recibirlo.
// Una INE pasa de ~200-250 KB (JPEG 1400 px) a ~60-90 KB (WebP 1100 px) y se sigue leyendo bien.
const sharp = require('sharp');
const { query } = require('./db');
const settings = require('./settings');

const INE = { ancho: 1100, calidad: 75 };
const EVIDENCIA = { ancho: 1280, calidad: 70 };
const AVATAR = { ancho: 400, calidad: 80 };

const esWebp = (b) => Boolean(b) && b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
const tipo = (b) => (esWebp(b) ? 'image/webp' : 'image/jpeg');

// Convierte a WebP (sin agrandar); si por alguna razón no conviene, se queda la original
async function comprimir(buf, { ancho, calidad } = INE) {
  if (!buf || esWebp(buf)) return buf;
  try {
    const out = await sharp(buf).rotate().resize({ width: ancho, height: ancho, fit: 'inside', withoutEnlargement: true }).webp({ quality: calidad, effort: 4 }).toBuffer();
    return out.length < buf.length ? out : buf;
  } catch {
    return buf;
  }
}

// El generador de PDF solo acepta JPEG o PNG
const aJpeg = async (buf) => (esWebp(buf) ? sharp(buf).jpeg({ quality: 85 }).toBuffer() : buf);

// ---------- Compactación de las fotos ya guardadas (una sola vez, en segundo plano) ----------
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const MARCA = 'fotos.webp';

async function compactarTabla({ nombre, select, update, opciones }) {
  let ultimo = null;
  let convertidas = 0;
  let antes = 0;
  let despues = 0;
  for (;;) {
    const { rows } = await query(select, [ultimo]);
    if (!rows.length) break;
    for (const r of rows) {
      ultimo = r.k;
      if (esWebp(r.image)) continue;
      const nueva = await comprimir(r.image, opciones);
      if (nueva === r.image) continue;
      await query(update, [r.k, nueva]);
      convertidas += 1;
      antes += r.image.length;
      despues += nueva.length;
    }
    await espera(150); // sin acaparar el servidor
  }
  if (convertidas) {
    await query(`VACUUM ${nombre}`).catch(() => {});
    console.log(`Fotos: ${convertidas} en ${nombre} a WebP · ${(antes / 1048576).toFixed(1)} MB → ${(despues / 1048576).toFixed(1)} MB`);
  }
}

async function compactarExistentes() {
  if (settings.get(MARCA)) return;
  try {
    await compactarTabla({
      nombre: 'promovido_ine',
      // Llave compuesta como texto para recorrer por páginas
      select: `SELECT promovido_id::text || ':' || lado AS k, image FROM promovido_ine
               WHERE $1::text IS NULL OR promovido_id::text || ':' || lado > $1 ORDER BY 1 LIMIT 25`,
      update: `UPDATE promovido_ine SET image = $2 WHERE promovido_id::text || ':' || lado = $1`,
      opciones: INE,
    });
    await compactarTabla({
      nombre: 'material_evidencias',
      select: `SELECT id::text AS k, image FROM material_evidencias WHERE $1::text IS NULL OR id > $1::bigint ORDER BY id LIMIT 25`,
      update: 'UPDATE material_evidencias SET image = $2 WHERE id = $1::bigint',
      opciones: EVIDENCIA,
    });
    await settings.set(MARCA, { at: new Date().toISOString() });
  } catch (err) {
    console.error('No se pudieron compactar las fotos:', err.message);
  }
}

module.exports = { INE, EVIDENCIA, AVATAR, esWebp, tipo, comprimir, aJpeg, compactarExistentes };
