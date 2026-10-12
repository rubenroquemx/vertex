// Almacenamiento en PostgreSQL.
// La base es la fuente de verdad: cada escritura se confirma en la base antes de reflejarse
// en la copia en memoria, que sirve las lecturas sin consultar la base en cada petición.
// (Requiere una sola instancia de la app, como en el despliegue actual.)
const crypto = require('crypto');
const { query, tx } = require('./db');

const cache = {
  users: new Map(), // id → usuario
  sessions: new Map(), // hash del token → sesión
  promovidos: [],
};

// --- Conversión fila ↔ objeto ----------------------------------------------
const COLS = new Set(['id', 'role', 'parentId', 'username', 'name', 'createdAt', 'updatedAt']);

function fromRow(r) {
  return {
    ...r.data,
    id: r.id,
    role: r.role,
    parentId: r.parent_id,
    username: r.username,
    name: r.name,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at ? r.updated_at.toISOString() : undefined,
  };
}

function dataOf(u) {
  const data = {};
  for (const [k, v] of Object.entries(u)) if (!COLS.has(k) && v !== undefined) data[k] = v;
  return data;
}

async function writeUser(u, client = { query }) {
  await client.query(
    `INSERT INTO users (id, role, parent_id, username, name, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET role = $2, parent_id = $3, username = $4, name = $5, data = $6, updated_at = $8`,
    [u.id, u.role, u.parentId || null, u.username || null, u.name, dataOf(u), u.createdAt, u.updatedAt || null]
  );
}

function newUser({ name, role, parentId = null, phone = '', email = '', ...extra }) {
  return {
    ...extra,
    id: crypto.randomUUID(),
    name,
    role,
    parentId,
    phone,
    email,
    createdAt: new Date().toISOString(),
  };
}

// --- Usuarios --------------------------------------------------------------
const users = {
  all: () => [...cache.users.values()],
  get: (id) => (id ? cache.users.get(id) || null : null),
  byUsername: (username) => {
    const u = String(username || '').trim().toLowerCase();
    if (!u) return null;
    for (const x of cache.users.values()) if (x.username === u) return x;
    return null;
  },
  async create(data) {
    const u = newUser(data);
    await writeUser(u);
    cache.users.set(u.id, u);
    return u;
  },
  async update(id, patch) {
    const current = cache.users.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
    await writeUser(next);
    Object.assign(current, next);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete current[k];
    return current;
  },
  // Borra cuentas (las sesiones y fotos se borran en cascada en la base)
  async removeMany(ids) {
    const list = [...ids];
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [list]);
    for (const id of list) cache.users.delete(id);
    for (const [h, s] of cache.sessions) if (ids.has(s.userId)) cache.sessions.delete(h);
  },
};

// --- Sesiones --------------------------------------------------------------
// Se guarda solo el hash SHA-256 del token; el token en claro vive únicamente en la cookie.
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const sessions = {
  async create(userId, ttlMs) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const s = { userId, godAs: null, createdAt: now, expiresAt: now + ttlMs };
    const h = tokenHash(token);
    await query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      h,
      userId,
      new Date(now),
      new Date(s.expiresAt),
    ]);
    cache.sessions.set(h, s);
    // Limpieza de sesiones vencidas
    await query('DELETE FROM sessions WHERE expires_at < now()');
    for (const [k, x] of cache.sessions) if (x.expiresAt < now) cache.sessions.delete(k);
    return token;
  },
  get(token) {
    if (!token) return null;
    const s = cache.sessions.get(tokenHash(token));
    return s && s.expiresAt > Date.now() ? s : null;
  },
  async update(token, patch) {
    const h = tokenHash(token);
    const s = cache.sessions.get(h);
    if (!s) return;
    if ('godAs' in patch) await query('UPDATE sessions SET god_as = $2 WHERE token_hash = $1', [h, patch.godAs]);
    Object.assign(s, patch);
  },
  async destroy(token) {
    if (!token) return;
    const h = tokenHash(token);
    await query('DELETE FROM sessions WHERE token_hash = $1', [h]);
    cache.sessions.delete(h);
  },
  async destroyAllFor(userId) {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    for (const [h, s] of cache.sessions) if (s.userId === userId) cache.sessions.delete(h);
  },
};

// --- Promovidos (los captura el Promotor Territorial) ---------------------
// Registro: { id, promotorId, seccion, createdAt, ... }. La captura se construirá en el módulo del Promotor.
const promovidos = {
  all: () => cache.promovidos,
  // Registra en caché un promovido recién guardado (ver src/promovidos.js)
  remember: (p) => cache.promovidos.push(p),
};

// --- Bitácora de acciones sensibles ----------------------------------------
const audit = {
  async add({ action, by = null, as = null, ...data }) {
    await query('INSERT INTO audit (action, by_user, as_user, data) VALUES ($1, $2, $3, $4)', [action, by, as, data]);
  },
  // Últimos registros de una acción (opcionalmente de una cuenta)
  async query({ action, as, limit = 20 }) {
    const params = [action, limit];
    let where = 'action = $1';
    if (as) {
      params.push(as);
      where += ' AND as_user = $3';
    }
    const { rows } = await query(`SELECT at, action, by_user, as_user, data FROM audit WHERE ${where} ORDER BY id DESC LIMIT $2`, params);
    return rows.map((r) => ({ ...r.data, at: r.at.toISOString(), action: r.action, by: r.by_user, as: r.as_user }));
  },
};

// --- Fotos de perfil -------------------------------------------------------
const avatars = {
  async get(id) {
    const { rows } = await query('SELECT image FROM avatars WHERE user_id = $1', [id]);
    return rows[0]?.image || null;
  },
  async save(id, buffer) {
    await query(
      `INSERT INTO avatars (user_id, image, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET image = $2, updated_at = now()`,
      [id, buffer]
    );
  },
  async remove(id) {
    await query('DELETE FROM avatars WHERE user_id = $1', [id]);
  },
};

// --- Contraseñas (scrypt con sal aleatoria) --------------------------------
const passwords = {
  hash(plain) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
  },
  verify(plain, stored) {
    if (!stored) return false;
    const [, salt, hash] = stored.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(plain, salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
  },
};

// --- Arranque ----------------------------------------------------------------
// Carga la copia en memoria. Si la base está vacía, crea el Super administrador
// (y en desarrollo, cuentas de demostración).
async function init({ seedIfEmpty = true } = {}) {
  const { rows } = await query('SELECT * FROM users ORDER BY created_at');
  cache.users = new Map(rows.map((r) => [r.id, fromRow(r)]));

  if (!cache.users.size && seedIfEmpty) await seed();

  const ses = await query('SELECT * FROM sessions WHERE expires_at > now()');
  cache.sessions = new Map(
    ses.rows.map((r) => [r.token_hash, { userId: r.user_id, godAs: r.god_as, createdAt: r.created_at.getTime(), expiresAt: r.expires_at.getTime() }])
  );
  // En memoria solo lo necesario para contar avance; los datos personales se quedan en la base
  const prom = await query('SELECT id, promotor_id, responsable_id, seccion, created_at FROM promovidos');
  cache.promovidos = prom.rows.map((r) => ({ id: r.id, promotorId: r.promotor_id, responsableId: r.responsable_id, seccion: r.seccion, createdAt: r.created_at.toISOString() }));
}

async function seed() {
  const list = [];
  const add = (name, role, parent) => {
    const u = newUser({ name, role, parentId: parent ? parent.id : null });
    list.push(u);
    return u;
  };
  const sa = add('Administrador General', 'superadmin');
  // En producción solo se crea el Super administrador (sin cuentas de demostración)
  if (process.env.NODE_ENV !== 'production') {
    const cp1 = add('Demo Coordinación Promoción A', 'coord_promocion', sa);
    const cp2 = add('Demo Coordinación Promoción B', 'coord_promocion', sa);
    const cz1 = add('Demo Zona A1', 'coord_zona', cp1);
    const cz2 = add('Demo Zona A2', 'coord_zona', cp1);
    add('Demo Zona B1', 'coord_zona', cp2);
    const rs1 = add('Demo Sección A1-1', 'resp_seccion', cz1);
    const rs2 = add('Demo Sección A2-1', 'resp_seccion', cz2);
    add('Demo Promotor A1-1-a', 'promotor', rs1);
    add('Demo Promotor A1-1-b', 'promotor', rs1);
    add('Demo Promotor A2-1-a', 'promotor', rs2);
  }
  await tx(async (c) => {
    for (const u of list) await writeUser(u, c);
  });
  for (const u of list) cache.users.set(u.id, u);
}

module.exports = { init, users, avatars, passwords, audit, sessions, promovidos, writeUser };
