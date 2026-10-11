// Configuración del sistema (clave → valor JSON) en PostgreSQL, con copia en memoria.
const { query } = require('./db');

const cache = new Map();

async function init() {
  const { rows } = await query('SELECT key, value, updated_at, updated_by FROM settings');
  cache.clear();
  for (const r of rows) cache.set(r.key, { value: r.value, updatedAt: r.updated_at.toISOString(), updatedBy: r.updated_by });
}

const get = (key) => cache.get(key)?.value ?? null;
const meta = (key) => {
  const x = cache.get(key);
  return x ? { updatedAt: x.updatedAt, updatedBy: x.updatedBy } : null;
};

async function set(key, value, userId = null) {
  const { rows } = await query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now(), updated_by = $3
     RETURNING updated_at`,
    [key, value, userId]
  );
  cache.set(key, { value, updatedAt: rows[0].updated_at.toISOString(), updatedBy: userId });
}

module.exports = { init, get, meta, set };
