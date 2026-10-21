// Apoyo de las pruebas automáticas.
//  - sinBase(): para pruebas que no tocan la base (pone una dirección ficticia; el pool no se conecta).
//  - prepararBase(): base de prueba aislada en un esquema temporal (vertex_pruebas_<pid>) del Postgres
//    de desarrollo (TEST_DATABASE_URL o DATABASE_URL). Corre las migraciones reales y, al terminar,
//    cerrarBase() borra el esquema: los datos de desarrollo no se tocan.
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const raiz = path.join(__dirname, '..', '..');
const src = (m) => path.join(raiz, 'src', m);
const ESQUEMA = `vertex_pruebas_${process.pid}`;
let urlBase = null;

function sinBase() {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://pruebas:pruebas@127.0.0.1:1/sin_base';
}

// Devuelve false si no hay Postgres disponible (las pruebas de integración se omiten)
async function prepararBase() {
  urlBase = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!urlBase) return false;
  const c = new Client({ connectionString: urlBase });
  try {
    await c.connect();
  } catch {
    return false;
  }
  await c.query(`CREATE SCHEMA ${ESQUEMA}`);
  await c.end();
  const u = new URL(urlBase);
  u.searchParams.set('options', `-c search_path=${ESQUEMA},public`);
  process.env.DATABASE_URL = u.toString();
  process.env.NODE_ENV = 'test';
  const db = require(src('db'));
  await db.migrate();
  await require(src('store')).init({ seedIfEmpty: false });
  await require(src('settings')).init();
  return true;
}

async function cerrarBase() {
  if (!urlBase) return;
  await require(src('db')).pool.end().catch(() => {});
  const c = new Client({ connectionString: urlBase });
  await c.connect();
  await c.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  await c.end();
}

// Estructura mínima: CPV → Coordinador de Zona → Responsable de Sección (sección 0421) → Promotor
async function sembrarEstructura() {
  const { users } = require(src('store'));
  const sufijo = crypto.randomBytes(3).toString('hex');
  const cpv = await users.create({ role: 'coord_promocion', name: 'CPV Prueba', username: `cpv${sufijo}` });
  const zona = await users.create({ role: 'coord_zona', parentId: cpv.id, name: 'Zona Prueba', username: `zona${sufijo}`, zona: { codigo: 'Z1', nombre: 'Zona 1', color: '#2a78d6' } });
  const rs = await users.create({
    role: 'resp_seccion',
    parentId: zona.id,
    name: 'Responsable Prueba',
    username: `rs${sufijo}`,
    territorio: { entidad: 27, tipo: 'secciones', metodo: 'manual', secciones: [421] },
  });
  const promotor = await users.create({ role: 'promotor', parentId: rs.id, name: 'Promotor Prueba', username: `pr${sufijo}` });
  const promotor2 = await users.create({ role: 'promotor', parentId: rs.id, name: 'Promotor Dos', username: `pd${sufijo}` });
  return { cpv, zona, rs, promotor, promotor2 };
}

// Foto JPEG válida (como la que manda el teléfono)
async function fotoJpeg(color = '#c08') {
  const sharp = require(path.join(raiz, 'node_modules', 'sharp'));
  const buf = await sharp({ create: { width: 640, height: 404, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

module.exports = { raiz, src, sinBase, prepararBase, cerrarBase, sembrarEstructura, fotoJpeg };
