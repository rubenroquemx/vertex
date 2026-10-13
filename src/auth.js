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

async function startSession(res, userId) {
  const token = await sessions.create(userId, SESSION_TTL);
  res.cookie(COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL });
}

async function endSession(req, res) {
  await sessions.destroy(readCookie(req, COOKIE));
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

// --- Límite de intentos fallidos -----------------------------------------------
// Por usuario: tras 5 errores, una espera que crece (30 s, 1, 2, 4… hasta 15 min) en vez de un
// bloqueo fijo, para que nadie pueda dejar fuera a otro por mucho tiempo.
// Por IP: límite alto, porque con datos móviles cientos de promotores comparten la misma IP.
const attempts = new Map();
const DUMMY_HASH = passwords.hash('vertex-dummy-password');
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_FAILS_IP = 60;
const limite = (key) => (key.startsWith('ip:') ? MAX_FAILS_IP : MAX_FAILS);
// Milisegundos que faltan para poder intentar de nuevo (0 si ya se puede)
function espera(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.last > WINDOW) return 0;
  const extra = a.count - limite(key);
  if (extra < 0) return 0;
  const ms = key.startsWith('ip:') ? WINDOW : Math.min(WINDOW, 30000 * 2 ** extra);
  return Math.max(0, a.last + ms - Date.now());
}
const tooManyAttempts = (key) => espera(key) > 0;
function registerFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.last > WINDOW) attempts.set(key, { count: 1, last: Date.now() });
  else {
    a.count += 1;
    a.last = Date.now();
  }
}
const mensajeEspera = (ms) => {
  const min = Math.ceil(ms / 60000);
  return ms < 60000 ? `Demasiados intentos. Espera ${Math.ceil(ms / 1000)} segundos e intenta de nuevo.` : `Demasiados intentos. Espera ${min} ${min === 1 ? 'minuto' : 'minutos'} e intenta de nuevo.`;
};
// La memoria de intentos se limpia sola (no crece sin límite)
setInterval(() => {
  const ahora = Date.now();
  for (const [k, a] of attempts) if (ahora - a.last > WINDOW) attempts.delete(k);
}, 10 * 60 * 1000).unref();

async function login(req, res) {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const keys = [`u:${username}`, `ip:${req.ip}`];
  const ms = Math.max(...keys.map(espera));
  if (ms > 0) return res.status(429).json({ error: mensajeEspera(ms) });
  const user = users.byUsername(username);
  // Se verifica siempre una contraseña para no revelar por tiempo de respuesta si el usuario existe
  const ok = (await passwords.verifyAsync(password, user?.passwordHash || DUMMY_HASH)) && user && !user.disabled;
  if (!ok) {
    keys.forEach(registerFail);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  keys.forEach((k) => attempts.delete(k));
  await startSession(res, user.id);
  await audit.add({ action: 'login', by: user.id });
  res.json({ ok: true });
}

// Confirmación de acciones delicadas con la contraseña de quien inició sesión
async function confirmPassword(user, password) {
  const key = `confirm:${user.id}`;
  if (!user.passwordHash) return { error: 'Para confirmar esta acción necesitas una contraseña. Créala en "Mi perfil".', status: 409 };
  if (tooManyAttempts(key)) return { error: mensajeEspera(espera(key)), status: 429 };
  if (!(await passwords.verifyAsync(String(password || ''), user.passwordHash))) {
    registerFail(key);
    return { error: 'La contraseña no es correcta.', status: 422, field: 'password' };
  }
  attempts.delete(key);
  return { ok: true };
}

async function logout(req, res) {
  await endSession(req, res);
  res.json({ ok: true });
}

// --- Modo dios --------------------------------------------------------------
async function startGodMode(req, res) {
  if (req.realUser.role !== 'superadmin') return res.status(403).json({ error: 'Solo el super administrador puede usar el modo dios' });
  const target = users.get(req.body.userId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (target.role === 'superadmin') return res.status(422).json({ error: 'No es posible entrar como otro super administrador' });
  await sessions.update(req.sessionToken, { godAs: target.id });
  await audit.add({ action: 'god_mode.start', by: req.realUser.id, as: target.id });
  res.json({ ok: true });
}

async function stopGodMode(req, res) {
  if (inGodMode(req)) await audit.add({ action: 'god_mode.stop', by: req.realUser.id, as: req.user.id });
  await sessions.update(req.sessionToken, { godAs: null });
  res.json({ ok: true });
}

// --- Usuario del super administrador ----------------------------------------
// Al arrancar: si el super administrador no tiene usuario/contraseña, se le asigna "admin"
// y una contraseña aleatoria que se escribe en data/CREDENCIAL_ADMIN.txt (o VERTEX_ADMIN_PASSWORD).
// Variables de entorno:
//   VERTEX_ADMIN_USER       usuario del super administrador (por defecto "admin")
//   VERTEX_ADMIN_PASSWORD   contraseña inicial (mín. 8 caracteres, con letras y números)
//   VERTEX_ADMIN_RESET=1    reaplica usuario y contraseña de las variables aunque ya existan
//                           (para recuperar el acceso; quitarla después del arranque)
async function ensureAdminCredentials() {
  const admin = users.all().find((u) => u.role === 'superadmin');
  if (!admin) return;
  const envUser = String(process.env.VERTEX_ADMIN_USER || '').trim().toLowerCase();
  const envPass = process.env.VERTEX_ADMIN_PASSWORD || '';
  const reset = process.env.VERTEX_ADMIN_RESET === '1';
  if (envUser && !USERNAME_RE.test(envUser)) {
    console.error('VERTEX_ADMIN_USER no es válido (3 a 30: minúsculas, números, punto, guion o guion bajo). Se ignora.');
  }
  if (envPass && !validPassword(envPass)) {
    console.error(`VERTEX_ADMIN_PASSWORD no es válida: ${PASSWORD_HINT} Se ignora.`);
  }
  const userOk = envUser && USERNAME_RE.test(envUser) ? envUser : null;
  const passOk = envPass && validPassword(envPass) ? envPass : null;
  const taken = userOk && users.byUsername(userOk) && users.byUsername(userOk).id !== admin.id;
  if (taken) console.error(`VERTEX_ADMIN_USER "${userOk}" ya lo usa otra cuenta. Se ignora.`);

  if (reset && (userOk || passOk)) {
    const patch = {};
    if (userOk && !taken) patch.username = userOk;
    if (passOk) patch.passwordHash = await passwords.hashAsync(passOk);
    await users.update(admin.id, patch);
    if (passOk) await sessions.destroyAllFor(admin.id);
    await audit.add({ action: 'admin.reset', by: admin.id });
    console.log('VERTEX: credenciales del super administrador restablecidas desde variables de entorno. Quita VERTEX_ADMIN_RESET.');
    return;
  }

  if (admin.username && admin.passwordHash) return;
  const password = passOk || `${crypto.randomBytes(9).toString('base64url')}7a`;
  const username = admin.username || (userOk && !taken ? userOk : 'admin');
  await users.update(admin.id, { username, passwordHash: await passwords.hashAsync(password) });
  if (!passOk) {
    const file = path.join(DATA_DIR, 'CREDENCIAL_ADMIN.txt');
    fs.writeFileSync(file, `Usuario: ${username}\nContraseña inicial: ${password}\n\nCámbiala desde "Mi perfil" y borra este archivo.\n`);
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
