// Restablecimiento de contraseña con código enviado por WhatsApp (Evolution API).
//  - Código de 6 dígitos, vence en 10 minutos, máximo 5 intentos; se guarda solo su hash.
//  - Las respuestas no revelan si el usuario existe.
const crypto = require('crypto');
const { query } = require('./db');
const { users, passwords, sessions, audit } = require('./store');
const whatsapp = require('./whatsapp');

const TTL_MIN = 10;
const MAX_INTENTOS = 5;
const VENTANA = 15 * 60 * 1000;
const MAX_POR_USUARIO = 3; // solicitudes por usuario en la ventana
const MAX_POR_IP = 10; // por conexión (una oficina puede compartir IP)

class RecuperarError extends Error {
  constructor(message, status = 422, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const hash = (id, code) => crypto.createHash('sha256').update(`${id}:${code}`).digest('hex');

// Límite de solicitudes en memoria
const solicitudes = new Map();
function limitar(key, max) {
  const now = Date.now();
  const list = (solicitudes.get(key) || []).filter((t) => now - t < VENTANA);
  if (list.length >= max) return false;
  list.push(now);
  solicitudes.set(key, list);
  return true;
}

const MENSAJE_GENERICO = 'Si el usuario existe y tiene un teléfono registrado, le enviamos un código por WhatsApp.';

async function solicitar(username, ip) {
  if (!whatsapp.listo()) {
    throw new RecuperarError('El restablecimiento por WhatsApp no está disponible. Pide ayuda a tu coordinador o al administrador.', 503);
  }
  const u = String(username || '').trim().toLowerCase();
  if (!u) throw new RecuperarError('Escribe tu usuario.', 422, { username: 'Escribe tu usuario.' });
  if (!limitar(`u:${u}`, MAX_POR_USUARIO) || !limitar(`ip:${ip}`, MAX_POR_IP)) {
    throw new RecuperarError('Ya solicitaste varios códigos. Espera 15 minutos e intenta de nuevo.', 429);
  }
  const user = users.byUsername(u);
  if (!user || user.disabled || !user.phone) return { ok: true, mensaje: MENSAJE_GENERICO };

  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  // Un solo código vigente por usuario
  await query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
  await query(`INSERT INTO password_resets (id, user_id, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${TTL_MIN} minutes')`, [
    id,
    user.id,
    hash(id, code),
  ]);
  const texto = [
    `Hola ${user.name.split(' ')[0]}, tu código para restablecer tu contraseña de VERTEX es:`,
    '',
    `*${code}*`,
    '',
    `Vence en ${TTL_MIN} minutos. Si no lo solicitaste, ignora este mensaje y nadie podrá cambiar tu contraseña.`,
  ].join('\n');
  try {
    await whatsapp.enviarTexto(user.phone, texto);
  } catch (err) {
    await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [id]);
    console.error('WhatsApp: no se pudo enviar el código de restablecimiento:', err.message);
    throw new RecuperarError('No se pudo enviar el código por WhatsApp. Intenta más tarde.', 502);
  }
  await audit.add({ action: 'password.reset_requested', by: user.id });
  return { ok: true, mensaje: MENSAJE_GENERICO };
}

async function restablecer({ username, code, password, confirm }) {
  const errors = {};
  const u = String(username || '').trim().toLowerCase();
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) errors.code = 'Escribe el código de 6 dígitos.';
  const { validPassword, PASSWORD_HINT } = require('./auth');
  if (!validPassword(password)) errors.password = PASSWORD_HINT;
  else if (password !== confirm) errors.confirm = 'Las contraseñas no coinciden.';
  if (Object.keys(errors).length) throw new RecuperarError('Revisa los datos marcados', 422, errors);

  const user = users.byUsername(u);
  const invalido = new RecuperarError('El código es incorrecto o ya venció. Solicita uno nuevo.', 422, { code: 'El código es incorrecto o ya venció.' });
  if (!user) throw invalido;
  const { rows } = await query(
    `SELECT id, code_hash, attempts FROM password_resets
     WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const r = rows[0];
  if (!r || r.attempts >= MAX_INTENTOS) throw invalido;
  const ok = crypto.timingSafeEqual(Buffer.from(r.code_hash, 'hex'), Buffer.from(hash(r.id, c), 'hex'));
  if (!ok) {
    await query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [r.id]);
    throw invalido;
  }
  await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id]);
  await users.update(user.id, { passwordHash: passwords.hash(password) });
  await sessions.destroyAllFor(user.id);
  await audit.add({ action: 'password.reset', by: user.id });
  return { ok: true };
}

module.exports = { solicitar, restablecer, RecuperarError };
