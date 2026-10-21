// Validaciones compartidas de cuentas.
const { users } = require('./store');
const { USERNAME_RE, PASSWORD_HINT, validPassword } = require('./auth');
const { isPartido } = require('./partidos');
const territory = require('./territory');

const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

// Nombre(s) y apellidos de una cuenta. Las cuentas anteriores solo tienen el nombre completo:
// se separa con la regla habitual (los dos últimos vocablos son los apellidos)
function partesNombre(u) {
  if (u?.nombres) return { nombres: u.nombres, apellidos: u.apellidos || '' };
  const w = String(u?.name || '').trim().split(/\s+/).filter(Boolean);
  if (w.length <= 1) return { nombres: w[0] || '', apellidos: '' };
  const n = w.length >= 3 ? w.length - 2 : 1;
  return { nombres: w.slice(0, n).join(' '), apellidos: w.slice(n).join(' ') };
}

// Datos de contacto comunes (alta de cuentas y perfil)
function cleanContact(body) {
  const data = {
    name: clean(body.name),
    phone: String(body.phone || '').replace(/\D/g, ''),
    email: String(body.email || '').trim().toLowerCase(),
  };
  const errors = {};
  // Los formularios capturan nombre(s) y apellidos por separado; `name` queda como el nombre completo
  if ('nombres' in (body || {}) || 'apellidos' in (body || {})) {
    data.nombres = clean(body.nombres);
    data.apellidos = clean(body.apellidos);
    data.name = `${data.nombres} ${data.apellidos}`.trim();
    if (data.nombres.length < 2 || data.nombres.length > 60) errors.nombres = 'Escribe el nombre o los nombres (2 a 60 caracteres).';
    if (data.apellidos.length < 2 || data.apellidos.length > 60) errors.apellidos = 'Escribe los apellidos (2 a 60 caracteres).';
  } else if (data.name.length < 3 || data.name.length > 120) errors.name = 'Escribe el nombre completo (3 a 120 caracteres).';
  if (data.phone && data.phone.length !== 10) errors.phone = 'El teléfono debe tener 10 dígitos.';
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'El correo no es válido.';
  return { data, errors };
}

const slug = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

// Sugerencia de usuario: inicial del nombre + primer apellido ("José Manuel Campos Chávez" → "jcampos")
function suggestUsername(name, excludeId = null) {
  const parts = slug(name);
  if (!parts.length) return '';
  const first = parts[0][0];
  const surname = parts.length >= 4 ? parts[parts.length - 2] : parts.length >= 2 ? parts[1] : parts[0];
  const second = parts.length >= 3 ? parts[parts.length - 1][0] : '';
  const taken = (u) => {
    const x = users.byUsername(u);
    return x && x.id !== excludeId;
  };
  const base = `${first}${surname}`.slice(0, 26);
  const candidates = [base, second && `${base}${second}`].filter(Boolean);
  for (const c of candidates) if (!taken(c)) return c;
  for (let n = 2; n < 1000; n++) if (!taken(`${base}${n}`)) return `${base}${n}`;
  return '';
}

function checkUsername(username, excludeId = null) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return 'Escribe el nombre de usuario.';
  if (!USERNAME_RE.test(u)) return 'De 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.';
  const other = users.byUsername(u);
  if (other && other.id !== excludeId) return 'Este nombre de usuario ya está en uso.';
  return null;
}

// Cuenta con acceso a la plataforma (nombre, teléfono para WhatsApp, correo, usuario y contraseña)
function validateCuenta(body, { current = null } = {}) {
  const { data, errors } = cleanContact(body);
  if (!data.phone) errors.phone = 'El teléfono móvil es obligatorio para enviar el acceso por WhatsApp.';

  const username = String(body.username || '').trim().toLowerCase();
  const userErr = checkUsername(username, current?.id);
  if (userErr) errors.username = userErr;

  const password = String(body.password || '');
  if (!current && !password) errors.password = 'Escribe o genera una contraseña.';
  else if (password && !validPassword(password)) errors.password = PASSWORD_HINT;

  return { errors, data: { ...data, username }, password };
}

// Coordinador de Promoción del Voto: alta y edición
function validateCoordinador(body, { current = null } = {}) {
  const cuenta = validateCuenta(body, { current });
  const { errors } = cuenta;
  const data = cuenta.data;

  const candidato = clean(body.candidato);
  if (candidato.length < 3 || candidato.length > 120) errors.candidato = 'Escribe el nombre del candidato.';

  const partidos = [...new Set(Array.isArray(body.partidos) ? body.partidos.map(String) : [])].filter(isPartido);
  const partidoOtro = partidos.includes('OTRO') ? clean(body.partidoOtro).slice(0, 60) : '';
  if (!partidos.length) errors.partidos = 'Elige al menos un partido.';
  else if (partidos.includes('OTRO') && partidoOtro.length < 2) errors.partidoOtro = 'Escribe el nombre del partido o candidatura independiente.';

  const t = territory.resolve(body.territorio);
  if (t.error) errors.territorio = t.error;

  return {
    errors,
    data: { ...data, candidato, partidos, partidoOtro, territorio: t.territorio },
    password: cuenta.password,
    resumen: t.resumen,
  };
}

module.exports = { partesNombre, cleanContact, suggestUsername, checkUsername, validateCuenta, validateCoordinador };
