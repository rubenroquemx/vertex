// Almacenamiento temporal en archivo JSON (se reemplazará por una base de datos).
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const crypto = require('crypto');
const { atomicWrite } = require('./fsutil');

const FILE = path.join(DATA_DIR, 'db.json');

let db = null;

function load() {
  if (db) return db;
  if (fs.existsSync(FILE)) {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } else {
    db = seed();
    save();
  }
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  atomicWrite(FILE, JSON.stringify(db, null, 2));
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

// Datos de demostración: dos ramas para comprobar que los niveles laterales no se ven entre sí.
function seed() {
  const users = [];
  const add = (name, role, parent) => {
    const u = newUser({ name, role, parentId: parent ? parent.id : null });
    users.push(u);
    return u;
  };
  const sa = add('Administrador General', 'superadmin');
  // En producción solo se crea el Super administrador (sin cuentas de demostración)
  if (process.env.NODE_ENV === 'production') return { users };
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
  return { users };
}

const users = {
  all: () => load().users,
  get: (id) => load().users.find((u) => u.id === id) || null,
  byUsername: (username) => {
    const u = String(username || '').trim().toLowerCase();
    return u ? load().users.find((x) => x.username === u) || null : null;
  },
  create(data) {
    const u = newUser(data);
    load().users.push(u);
    save();
    return u;
  },
  removeMany(ids) {
    const db = load();
    db.users = db.users.filter((u) => !ids.has(u.id));
    save();
  },
  update(id, patch) {
    const u = users.get(id);
    if (!u) return null;
    Object.assign(u, patch, { updatedAt: new Date().toISOString() });
    save();
    return u;
  },
};

// --- Sesiones --------------------------------------------------------------
// Se guarda solo el hash SHA-256 del token; el token en claro vive únicamente en la cookie.
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const sessions = {
  create(userId, ttlMs) {
    const db = load();
    if (!db.sessions) db.sessions = {};
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.sessions[tokenHash(token)] = { userId, godAs: null, createdAt: now, expiresAt: now + ttlMs };
    // Limpieza de sesiones vencidas
    for (const [k, s] of Object.entries(db.sessions)) if (s.expiresAt < now) delete db.sessions[k];
    save();
    return token;
  },
  get(token) {
    if (!token) return null;
    const s = (load().sessions || {})[tokenHash(token)];
    return s && s.expiresAt > Date.now() ? s : null;
  },
  update(token, patch) {
    const s = (load().sessions || {})[tokenHash(token)];
    if (!s) return;
    Object.assign(s, patch);
    save();
  },
  destroy(token) {
    const db = load();
    if (token && db.sessions) delete db.sessions[tokenHash(token)];
    save();
  },
  destroyAllFor(userId) {
    const db = load();
    for (const [k, s] of Object.entries(db.sessions || {})) if (s.userId === userId) delete db.sessions[k];
    save();
  },
};

// --- Promovidos (los captura el Promotor Territorial) ---------------------
// Registro: { id, promotorId, seccion, createdAt, ... }. La captura se construirá en el módulo del Promotor.
const promovidos = {
  all: () => load().promovidos || [],
};

// --- Bitácora de acciones sensibles (p. ej. modo dios) ---------------------
const audit = {
  add(entry) {
    const db = load();
    if (!db.audit) db.audit = [];
    db.audit.push({ at: new Date().toISOString(), ...entry });
    save();
  },
  list: (filter) => (load().audit || []).filter(filter),
};

// --- Fotos de perfil -------------------------------------------------------
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const avatarFile = (id) => path.join(AVATAR_DIR, `${id}.jpg`);

const avatars = {
  file: avatarFile,
  save(id, buffer) {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    fs.writeFileSync(avatarFile(id), buffer);
  },
  remove(id) {
    fs.rmSync(avatarFile(id), { force: true });
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

module.exports = { users, avatars, passwords, audit, sessions, promovidos };
