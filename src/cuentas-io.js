// Exportar e importar todas las cuentas (para replicar las cuentas de un entorno en otro).
// Incluye contraseñas cifradas y fotos de perfil. NO incluye promovidos, cartografía,
// padrón, configuración ni bitácora.
// Importar REEMPLAZA todas las cuentas: se borran las existentes (y sus sesiones).
const { query, tx } = require('./db');
const { ROLES } = require('./roles');

const FORMATO = 'vertex-cuentas';
const VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_KEYS = new Set(ROLES.map((r) => r.key));

class CuentasError extends Error {}

async function exportar() {
  const u = await query('SELECT id, role, parent_id, username, name, data, created_at, updated_at FROM users ORDER BY created_at');
  const a = await query('SELECT user_id, image, updated_at FROM avatars');
  return {
    formato: FORMATO,
    version: VERSION,
    exportadoEn: new Date().toISOString(),
    users: u.rows.map((r) => ({
      id: r.id,
      role: r.role,
      parentId: r.parent_id,
      username: r.username,
      name: r.name,
      data: r.data,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
    })),
    avatars: a.rows.map((r) => ({ userId: r.user_id, image: r.image.toString('base64'), updatedAt: r.updated_at.toISOString() })),
  };
}

function validar(archivo) {
  if (!archivo || archivo.formato !== FORMATO || archivo.version !== VERSION || !Array.isArray(archivo.users)) {
    throw new CuentasError('El archivo no es una exportación de cuentas de VERTEX.');
  }
  const ids = new Set();
  const usernames = new Set();
  for (const u of archivo.users) {
    if (!UUID_RE.test(String(u.id)) || !ROLE_KEYS.has(u.role) || !String(u.name || '').trim() || !u.data || typeof u.data !== 'object') {
      throw new CuentasError('El archivo tiene cuentas con datos incompletos o no válidos.');
    }
    if (ids.has(u.id)) throw new CuentasError('El archivo tiene cuentas repetidas.');
    ids.add(u.id);
    if (u.username) {
      if (usernames.has(u.username)) throw new CuentasError(`El usuario "${u.username}" aparece dos veces.`);
      usernames.add(u.username);
    }
  }
  for (const u of archivo.users) {
    if (u.parentId && !ids.has(u.parentId)) throw new CuentasError(`La cuenta "${u.name}" depende de una cuenta que no viene en el archivo.`);
  }
  const admins = archivo.users.filter((u) => u.role === 'superadmin');
  if (!admins.length) throw new CuentasError('El archivo no trae ningún Super administrador.');
  if (!admins.some((u) => u.username && u.data?.passwordHash)) {
    throw new CuentasError('El Super administrador del archivo no tiene usuario y contraseña; nadie podría entrar.');
  }
  for (const a of archivo.avatars || []) {
    if (!ids.has(a.userId) || typeof a.image !== 'string') throw new CuentasError('El archivo tiene fotos de perfil no válidas.');
  }
}

// Reemplaza todas las cuentas por las del archivo, en una sola transacción
async function importar(archivo) {
  validar(archivo);
  // Padres antes que hijos (la tabla exige que el superior exista)
  const porId = new Map(archivo.users.map((u) => [u.id, u]));
  const nivel = (u) => {
    let n = 0;
    for (let p = u; p?.parentId; p = porId.get(p.parentId)) n++;
    return n;
  };
  const ordenados = [...archivo.users].sort((a, b) => nivel(a) - nivel(b));

  await tx(async (c) => {
    // Al borrar las cuentas se borran en cascada sesiones, fotos de perfil y códigos de
    // restablecimiento; los promovidos y la configuración conservan sus datos (referencia en nulo).
    await c.query('DELETE FROM users');
    for (const u of ordenados) {
      await c.query(
        `INSERT INTO users (id, role, parent_id, username, name, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [u.id, u.role, u.parentId || null, u.username || null, u.name, u.data, u.createdAt || new Date().toISOString(), u.updatedAt || null]
      );
    }
    for (const a of archivo.avatars || []) {
      await c.query('INSERT INTO avatars (user_id, image, updated_at) VALUES ($1, $2, $3)', [a.userId, Buffer.from(a.image, 'base64'), a.updatedAt || new Date().toISOString()]);
    }
  });
  return { cuentas: archivo.users.length, fotos: (archivo.avatars || []).length };
}

module.exports = { exportar, importar, CuentasError };
