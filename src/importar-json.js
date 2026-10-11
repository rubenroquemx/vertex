// Importación única de los datos que la app guardaba en archivos (data/) a PostgreSQL.
// Se ejecuta al arrancar solo si la base no tiene usuarios y existe data/db.json.
// Al terminar, db.json se renombra a db.json.migrado (respaldo); geo/ y padron/ se conservan.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { query, tx } = require('./db');
const { writeUser } = require('./store');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

async function importarSiHaceFalta() {
  const dbFile = path.join(DATA_DIR, 'db.json');
  if (!fs.existsSync(dbFile)) return false;
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return false;

  console.log('VERTEX: importando datos de archivos a PostgreSQL…');
  const db = readJson(dbFile);
  const users = db.users || [];

  // Padres antes que hijos (llave foránea parent_id)
  const byId = new Map(users.map((u) => [u.id, u]));
  const ordered = [];
  const seen = new Set();
  const visit = (u) => {
    if (seen.has(u.id)) return;
    if (u.parentId && byId.has(u.parentId)) visit(byId.get(u.parentId));
    seen.add(u.id);
    ordered.push(u);
  };
  users.forEach(visit);

  const resumen = { cuentas: 0, bitacora: 0, fotos: 0, entidades: 0, padron: 0 };
  await tx(async (c) => {
    for (const u of ordered) {
      await writeUser({ ...u, parentId: u.parentId && byId.has(u.parentId) ? u.parentId : null }, c);
      resumen.cuentas += 1;
    }
    for (const a of db.audit || []) {
      const { at, action, by = null, as = null, ...data } = a;
      await c.query('INSERT INTO audit (at, action, by_user, as_user, data) VALUES ($1, $2, $3, $4, $5)', [at, action, by, as, data]);
      resumen.bitacora += 1;
    }
    for (const p of db.promovidos || []) {
      const { id, promotorId = null, seccion = null, createdAt, ...data } = p;
      await c.query('INSERT INTO promovidos (id, promotor_id, seccion, data, created_at) VALUES ($1, $2, $3, $4, $5)', [
        id,
        byId.has(promotorId) ? promotorId : null,
        seccion,
        data,
        createdAt || new Date(),
      ]);
    }

    // Fotos de perfil
    const avDir = path.join(DATA_DIR, 'avatars');
    if (fs.existsSync(avDir)) {
      for (const f of fs.readdirSync(avDir)) {
        const id = f.replace(/\.jpg$/, '');
        if (!byId.has(id)) continue;
        await c.query('INSERT INTO avatars (user_id, image) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [id, fs.readFileSync(path.join(avDir, f))]);
        resumen.fotos += 1;
      }
    }

    // Cartografía: data/geo/NN/{meta.json, catalog.json, <capa>.geojson}
    const geoDir = path.join(DATA_DIR, 'geo');
    if (fs.existsSync(geoDir)) {
      for (const d of fs.readdirSync(geoDir).filter((x) => /^\d{2}$/.test(x))) {
        const dir = path.join(geoDir, d);
        if (!fs.existsSync(path.join(dir, 'meta.json'))) continue;
        const meta = readJson(path.join(dir, 'meta.json'));
        await c.query('INSERT INTO geo_states (clave, meta, catalog) VALUES ($1, $2, $3) ON CONFLICT (clave) DO NOTHING', [
          meta.clave,
          meta,
          readJson(path.join(dir, 'catalog.json')),
        ]);
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.geojson'))) {
          await c.query('INSERT INTO geo_layers (clave, layer, geojson) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
            meta.clave,
            f.replace(/\.geojson$/, ''),
            fs.readFileSync(path.join(dir, f), 'utf8'),
          ]);
        }
        resumen.entidades += 1;
      }
    }

    // Padrón: data/padron/{meta.json, NN.json}
    const padDir = path.join(DATA_DIR, 'padron');
    if (fs.existsSync(path.join(padDir, 'meta.json'))) {
      const meta = readJson(path.join(padDir, 'meta.json'));
      for (const [clave, m] of Object.entries(meta.states || {})) {
        const f = path.join(padDir, `${String(clave).padStart(2, '0')}.json`);
        if (!fs.existsSync(f)) continue;
        await c.query('INSERT INTO padron_states (clave, meta, data) VALUES ($1, $2, $3) ON CONFLICT (clave) DO NOTHING', [Number(clave), m, readJson(f)]);
        resumen.padron += 1;
      }
      await c.query('INSERT INTO padron_meta (id, last_import) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [meta.lastImport || null]);
    }
  });

  fs.renameSync(dbFile, `${dbFile}.migrado`);
  console.log(
    `VERTEX: importación terminada · ${resumen.cuentas} cuentas · ${resumen.bitacora} registros de bitácora · ${resumen.fotos} fotos · ${resumen.entidades} entidades con cartografía · ${resumen.padron} entidades con padrón. (db.json → db.json.migrado)`
  );
  return true;
}

module.exports = { importarSiHaceFalta };
