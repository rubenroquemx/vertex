// Autenticación: inicio de sesión con usuario y contraseña, sesiones en servidor y modo dios.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const crypto = require('crypto');
const { users, passwords, sessions, audit } = require('./store');

const COOKIE = 'vx_session';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 días (uso en campo desde el celular)
const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' };

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const PASSWORD_HINT = 'Mínimo 8 caracteres, con letras y números.';
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);

function readCookie(req, name) {
  const match = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function startSession(res, userId) {
  const token = sessions.create(userId, SESSION_TTL);
  res.cookie(COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL });
}

function endSession(req, res) {
  sessions.destroy(readCookie(req, COOKIE));
  res.clearCookie(COOKIE, cookieOpts);
}

// req.realUser: quien inició sesión. req.user: con quien se actúa (distinto solo en modo dios).
function requireUser(req, res, next) {
  const token = readCookie(req, COOKIE);
  const session = sessions.get(token);
  const real = session && users.get(session.userId);
  if (!real || real.disabled) return res.status(401).json({ error: 'Sesión no iniciada' });
  req.sessionToken = token;
  req.realUser = real;
  req.user = real;
  if (session.godAs && real.role === 'superadmin') {
    const target = users.get(session.godAs);
    if (target && target.role !== 'superadmin') req.user = target;
  }
  next();
}

const inGodMode = (req) => req.user.id !== req.realUser.id;

// --- Límite de intentos fallidos (por usuario y por IP) --------------------
const attempts = new Map();
const DUMMY_HASH = passwords.hash('vertex-dummy-password');
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 5;
function tooManyAttempts(key) {
  const a = attempts.get(key);
  return a && a.count >= MAX_FAILS && Date.now() - a.first < WINDOW;
}
function registerFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else a.count += 1;
}

function login(req, res) {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const keys = [`u:${username}`, `ip:${req.ip}`];
  if (keys.some(tooManyAttempts)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.' });
  }
  const user = users.byUsername(username);
  // Se verifica siempre una contraseña para no revelar por tiempo de respuesta si el usuario existe
  const ok = passwords.verify(password, user?.passwordHash || DUMMY_HASH) && user && !user.disabled;
  if (!ok) {
    keys.forEach(registerFail);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  keys.forEach((k) => attempts.delete(k));
  startSession(res, user.id);
  audit.add({ action: 'login', by: user.id });
  res.json({ ok: true });
}

// Confirmación de acciones delicadas con la contraseña de quien inició sesión
function confirmPassword(user, password) {
  const key = `confirm:${user.id}`;
  if (!user.passwordHash) return { error: 'Para confirmar esta acción necesitas una contraseña. Créala en "Mi perfil".', status: 409 };
  if (tooManyAttempts(key)) return { error: 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.', status: 429 };
  if (!passwords.verify(String(password || ''), user.passwordHash)) {
    registerFail(key);
    return { error: 'La contraseña no es correcta.', status: 422, field: 'password' };
  }
  attempts.delete(key);
  return { ok: true };
}

function logout(req, res) {
  endSession(req, res);
  res.json({ ok: true });
}

// --- Modo dios --------------------------------------------------------------
function startGodMode(req, res) {
  if (req.realUser.role !== 'superadmin') return res.status(403).json({ error: 'Solo el super administrador puede usar el modo dios' });
  const target = users.get(req.body.userId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (target.role === 'superadmin') return res.status(422).json({ error: 'No es posible entrar como otro super administrador' });
  sessions.update(req.sessionToken, { godAs: target.id });
  audit.add({ action: 'god_mode.start', by: req.realUser.id, as: target.id });
  res.json({ ok: true });
}

function stopGodMode(req, res) {
  if (inGodMode(req)) audit.add({ action: 'god_mode.stop', by: req.realUser.id, as: req.user.id });
  sessions.update(req.sessionToken, { godAs: null });
  res.json({ ok: true });
}

// --- Usuario del super administrador ----------------------------------------
// Al arrancar: si el super administrador no tiene usuario/contraseña, se le asigna "admin"
// y una contraseña aleatoria que se escribe en data/CREDENCIAL_ADMIN.txt (o VERTEX_ADMIN_PASSWORD).
function ensureAdminCredentials() {
  const admin = users.all().find((u) => u.role === 'superadmin');
  if (!admin || (admin.username && admin.passwordHash)) return;
  const password = process.env.VERTEX_ADMIN_PASSWORD || `${crypto.randomBytes(9).toString('base64url')}7a`;
  users.update(admin.id, { username: admin.username || 'admin', passwordHash: passwords.hash(password) });
  if (!process.env.VERTEX_ADMIN_PASSWORD) {
    const file = path.join(DATA_DIR, 'CREDENCIAL_ADMIN.txt');
    fs.writeFileSync(
      file,
      `Usuario: ${admin.username || 'admin'}\nContraseña inicial: ${password}\n\nCámbiala desde "Mi perfil" y borra este archivo.\n`
    );
    console.log(`Credencial inicial del super administrador escrita en ${file}`);
  }
}

module.exports = {
  COOKIE,
  USERNAME_RE,
  PASSWORD_HINT,
  validPassword,
  requireUser,
  inGodMode,
  startSession,
  login,
  logout,
  startGodMode,
  stopGodMode,
  ensureAdminCredentials,
  confirmPassword,
};
