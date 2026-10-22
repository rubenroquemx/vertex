const path = require('path');
const express = require('express');
const compression = require('compression');
const { ROLES, getRole } = require('./src/roles');
const db = require('./src/db');
const store = require('./src/store');
const { users, avatars, passwords, audit, sessions } = store;
const { importarSiHaceFalta } = require('./src/importar-json');
const settings = require('./src/settings');
const whatsapp = require('./src/whatsapp');
const recuperar = require('./src/recuperar');
const { visibleUsers, canView, creatableRole, chainOf } = require('./src/access');
const auth = require('./src/auth');
const { requireUser, inGodMode } = auth;
const geo = require('./src/geo');
const branch = require('./src/branch');
const zonas = require('./src/zonas');
const escritorio = require('./src/escritorio');
const escritorioZona = require('./src/escritorio-zona');
const escritorioPromotor = require('./src/escritorio-promotor');
const informe = require('./src/informe');
const eventos = require('./src/eventos');
const externas = require('./src/externas');
const listas = require('./src/listas');
const responsables = require('./src/responsables');
const metas = require('./src/metas');
const costos = require('./src/costos');
const generador = require('./src/generador');
const panelSeccion = require('./src/panel-seccion');
const panelSA = require('./src/panel-sa');
const promovidos = require('./src/promovidos');
const promovidoPdf = require('./src/promovido-pdf');
const notificaciones = require('./src/notificaciones');
const fotos = require('./src/fotos');
const almacen = require('./src/almacen');
const privacidad = require('./src/privacidad');
const ELECCION = require('./src/eleccion');
const { memo, olvidar: olvidarPaneles } = require('./src/memo');
const push = require('./src/push');
const ejemplo = require('./src/ejemplo');
const material = require('./src/material');
const puntos = require('./src/puntos');
const ineOcr = require('./src/ine-ocr');
const version = require('./src/version');
const avisos = require('./src/avisos');
const { fmtSeccion } = require('./src/formato');
const padron = require('./src/padron');
const territory = require('./src/territory');
const { PARTIDOS } = require('./src/partidos');
const { partesNombre, cleanContact, suggestUsername, checkUsername, validateCuenta, validateCoordinador } = require('./src/validate');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');

// Cabeceras de seguridad: sin incrustar la app en otros sitios, solo recursos propios (más los
// mosaicos del mapa y las fuentes de Google), HTTPS obligatorio y solo cámara/ubicación propias.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) => {
    if (!handlers.length) return original(route); // app.get('ajuste')
    return original(
      route,
      ...handlers.map((h) =>
        typeof h === 'function' && h.length < 4
          ? (req, res, next) => {
              try {
                const r = h(req, res, next);
                if (r && typeof r.then === 'function') r.catch(next);
              } catch (err) {
                next(err);
              }
            }
          : h
      )
    );
  };
}
// Detrás del proxy de Easypanel (Traefik) se confía en el primer salto para conocer la IP real
// del usuario (límite de intentos de acceso). En desarrollo, solo en localhost.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : isProd ? 1 : 'loopback');
app.use(compression());
// La foto de perfil usa su propio parser con un límite mayor
const jsonBody = express.json();
// Rutas con fotos: su propio límite de tamaño
const CON_FOTOS = new Set(['/api/me/avatar', '/api/promovidos', '/api/ine/leer']);
const PROMOVIDO_RE = /^\/api\/promovidos\/[0-9a-f-]{36}$/;
// Activaciones de material: llevan fotos
const EVIDENCIA_RE = /^\/api\/material\/activaciones$/;
// Asambleas y recorridos: alta, ajustes, reporte y selfie de asistencia llevan fotos
const EVENTO_FOTOS_RE = /^\/api\/eventos(\/[0-9a-f-]{36}(\/reporte|\/asistencia\/selfie)?)?$/;
app.use((req, res, next) =>
  CON_FOTOS.has(req.path) ||
  (req.method === 'PUT' && PROMOVIDO_RE.test(req.path)) ||
  EVIDENCIA_RE.test(req.path) ||
  (req.method !== 'GET' && EVENTO_FOTOS_RE.test(req.path))
    ? next()
    : jsonBody(req, res, next)
);


const publicUser = (u) => {
  const parent = users.get(u.parentId);
  return {
    id: u.id,
    name: u.name,
    ...partesNombre(u),
    role: u.role,
    roleName: getRole(u.role).name,
    parentId: u.parentId,
    parentName: parent ? parent.name : null,
    phone: u.phone,
    email: u.email,
    about: u.about || '',
    username: u.username || null,
    avatarUrl: u.avatarAt ? `/api/users/${u.id}/avatar?v=${encodeURIComponent(u.avatarAt)}` : null,
    createdAt: u.createdAt,
    // Candidatura del Coordinador de Promoción del Voto (para las tarjetas del Super admin)
    ...(u.role === 'coord_promocion'
      ? {
          candidato: u.candidato || '',
          partidos: u.partidos || [],
          partidoOtro: u.partidoOtro || '',
          territorioResumen: u.territorio ? territory.resolve(u.territorio).resumen || null : null,
          zonas: users.hijos(u.id, 'coord_zona').length,
        }
      : {}),
  };
};

const invalid = (res, fields) => res.status(422).json({ error: 'Revisa los datos marcados', fields });

const requireRole = (role) => (req, res, next) =>
  req.user.role === role ? next() : res.status(403).json({ error: 'No tienes permiso para esta sección' });

// --- API -------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', app: 'VERTEX', time: new Date().toISOString() });
});

app.get('/api/roles', (req, res) => res.json(ROLES));

// --- Sesión -----------------------------------------------------------------
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);

// --- Restablecer contraseña con código por WhatsApp (pantalla de acceso) -----
app.get('/api/auth/recuperar/disponible', (req, res) => res.json({ disponible: whatsapp.listo() }));

app.post('/api/auth/recuperar', async (req, res) => {
  try {
    res.json(await recuperar.solicitar(req.body?.username, req.ip));
  } catch (err) {
    if (!(err instanceof recuperar.RecuperarError)) throw err;
    res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
  }
});

app.post('/api/auth/restablecer', async (req, res) => {
  try {
    res.json(await recuperar.restablecer(req.body || {}));
  } catch (err) {
    if (!(err instanceof recuperar.RecuperarError)) throw err;
    res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
  }
});

app.get('/api/me', requireUser, async (req, res) => {
  res.json({
    user: { ...publicUser(req.user), hasPassword: Boolean(req.user.passwordHash) },
    role: getRole(req.user.role),
    childRole: creatableRole(req.user),
    canDelete: canDeleteAccounts(req),
    // La confirmación de acciones delicadas usa la contraseña de quien inició sesión
    confirm: { name: req.realUser.name, hasPassword: Boolean(req.realUser.passwordHash) },
    // En modo dios: ruta jerárquica desde el super administrador hasta la cuenta actual
    godMode: inGodMode(req)
      ? {
          by: { id: req.realUser.id, name: req.realUser.name },
          chain: chainOf(req.user).map((u) => ({ id: u.id, name: u.name, roleName: getRole(u.role).name, role: u.role })),
        }
      : null,
    dev: !isProd,
    // Fecha de la jornada electoral (única fuente: src/eleccion.js)
    eleccion: { fecha: ELECCION.fecha.toISOString(), texto: ELECCION.texto },
  });
});

// --- Modo dios: el super administrador entra como cualquier otro usuario ----
app.post('/api/god-mode', requireUser, auth.startGodMode);
app.delete('/api/god-mode', requireUser, auth.stopGodMode);

// Cuentas visibles para el usuario: solo su inmediato inferior
app.get('/api/users', requireUser, async (req, res) => {
  res.json(visibleUsers(req.user).map((u) => publicUser(u)));
});

// Alta rápida de cuentas (niveles sin formulario propio): solo el nivel inmediato inferior
app.post('/api/users', requireUser, async (req, res) => {
  const role = creatableRole(req.user);
  if (!role) return res.status(403).json({ error: 'Tu nivel no puede crear cuentas' });
  if (role.key === 'coord_promocion') return res.status(422).json({ error: 'Usa el formulario de Coordinador de Promoción.' });
  if (role.key === 'coord_zona') return res.status(422).json({ error: 'Usa el formulario de Nueva zona.' });
  if (role.key === 'resp_seccion') return res.status(422).json({ error: 'Usa el formulario de Nuevo responsable de sección.' });

  // Misma cuenta de acceso que los demás perfiles: usuario, contraseña y teléfono para WhatsApp
  const cuenta = validateCuenta(req.body);
  if (Object.keys(cuenta.errors).length) return invalid(res, cuenta.errors);

  const created = await users.create({ ...cuenta.data, role: role.key, parentId: req.user.id });
  await users.update(created.id, { passwordHash: await passwords.hashAsync(cuenta.password) });
  await audit.add({ action: 'user.create', by: req.realUser.id, as: req.user.id, user: created.id });
  res.status(201).json(publicUser(users.get(created.id)));
});

// --- Eliminación de cuentas con respaldo de su rama --------------------------
// Pueden eliminar el Super admin y los CPV (y el Super admin en modo dios dentro de cualquier cuenta),
// siempre a su inmediato inferior. Se elimina la cuenta y toda su rama.
function canDeleteAccounts(req) {
  return req.realUser.role === 'superadmin' || ['superadmin', 'coord_promocion'].includes(req.user.role);
}
function deletableTarget(req, res) {
  const target = users.get(req.params.id);
  if (!target || target.parentId !== req.user.id) {
    res.status(404).json({ error: 'Cuenta no encontrada' });
    return null;
  }
  if (!canDeleteAccounts(req)) {
    res.status(403).json({ error: 'Tu nivel no puede eliminar cuentas' });
    return null;
  }
  return target;
}

// Respaldos descargados: eliminar una rama (o borrar dependientes) exige haber descargado su
// respaldo en los últimos 30 minutos
const respaldos = new Map();
const VIGENCIA_RESPALDO = 30 * 60 * 1000;
const claveRespaldo = (req, id) => `${req.realUser.id}:${id}`;
const respaldoVigente = (req, id) => Date.now() - (respaldos.get(claveRespaldo(req, id)) || 0) < VIGENCIA_RESPALDO;

app.get('/api/users/:id/branch', requireUser, async (req, res) => {
  const target = deletableTarget(req, res);
  if (!target) return;
  const s = branch.summary(req.params.id);
  const prom = await branch.promovidosDeRama(branch.branchOf(target.id).map((u) => u.id));
  res.json({ ...s, promovidos: prom.length, destinos: branch.destinosTransferencia(target) });
});

// Respaldo de una rama: quien puede eliminarla, o su superior directo (p. ej. el Coordinador de
// Zona antes de cambiar de sección a un Responsable)
app.get('/api/users/:id/backup', requireUser, async (req, res) => {
  const t = users.get(req.params.id);
  const target = t && t.parentId === req.user.id && !canDeleteAccounts(req) ? t : deletableTarget(req, res);
  if (!target) return;
  const b = await branch.backupZip(target.id, { by: req.realUser.name });
  respaldos.set(claveRespaldo(req, target.id), Date.now());
  const slug = (target.username || target.name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  const fileName = `respaldo-vertex-${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
  await audit.add({ action: 'user.backup', by: req.realUser.id, as: req.user.id, user: target.id, accounts: b.count });
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
  res.send(b.buffer);
});

app.delete('/api/users/:id', requireUser, async (req, res) => {
  const target = deletableTarget(req, res);
  if (!target) return;
  const check = await auth.confirmPassword(req.realUser, req.body?.password);
  if (!check.ok) {
    return res.status(check.status).json(check.field ? { error: check.error, fields: { password: check.error } } : { error: check.error });
  }
  // Dos caminos: transferir los dependientes a otra cuenta del mismo nivel, o respaldo
  // obligatorio y borrado de toda la rama (con sus promovidos)
  if (req.body?.modo === 'transferir') {
    const destino = branch.destinosTransferencia(target).find((d) => d.id === req.body?.destinoId);
    if (!destino) return res.status(422).json({ error: 'Elige a quién se transfieren sus dependientes.', fields: { destinoId: 'Elige una cuenta.' } });
    const r = await branch.transferirDependientes(target, users.get(destino.id));
    await users.removeMany(new Set([target.id]));
    await audit.add({ action: 'user.transfer', by: req.realUser.id, as: req.user.id, user: destino.id, name: target.name, ...r });
    return res.json({ ok: true, removed: 1, transferidos: r });
  }
  if (!respaldoVigente(req, target.id)) {
    return res.status(409).json({ error: 'Primero descarga el respaldo de esta rama (es obligatorio para eliminarla).' });
  }
  const r = await branch.removeBranch(target.id);
  respaldos.delete(claveRespaldo(req, target.id));
  await audit.add({ action: 'user.delete', by: req.realUser.id, as: req.user.id, user: target.id, name: target.name, accounts: r.cuentas, promovidos: r.promovidos, backup: true });
  res.json({ ok: true, removed: r.cuentas, promovidos: r.promovidos });
});

// --- Nombres de usuario -----------------------------------------------------
app.get('/api/usernames/suggest', requireUser, async (req, res) => {
  res.json({ username: suggestUsername(req.query.name, req.query.exclude || null) });
});
app.get('/api/usernames/check', requireUser, async (req, res) => {
  const error = checkUsername(req.query.username, req.query.exclude || null);
  res.json({ available: !error, error });
});

// --- Coordinadores de Promoción del Voto (los gestiona el super administrador) ----
const coordinadorDetail = (u) => ({
  ...publicUser(u),
  candidato: u.candidato || '',
  partidos: u.partidos || [],
  partidoOtro: u.partidoOtro || '',
  territorio: u.territorio || null,
  territorioResumen: u.territorio ? territory.resolve(u.territorio).resumen || null : null,
});

app.get('/api/catalogos/partidos', requireUser, (req, res) => res.json(PARTIDOS));

// Entidades con cartografía cargada y opciones de territorio de cada una
app.get('/api/territorio/entidades', requireUser, requireRole('superadmin'), async (req, res) => {
  const pad = new Map(padron.summary().states.map((s) => [s.clave, s]));
  res.json(geo.listStates().map((s) => ({ clave: s.clave, nombre: s.nombre, padron: Boolean(pad.get(s.clave)) })));
});
app.get('/api/territorio/:entidad/opciones', requireUser, requireRole('superadmin'), async (req, res) => {
  const opts = territory.options(req.params.entidad);
  if (!opts) return res.status(404).json({ error: 'Entidad sin cartografía' });
  res.json(opts);
});

app.get('/api/coordinadores/:id', requireUser, requireRole('superadmin'), async (req, res) => {
  const u = users.get(req.params.id);
  if (!u || u.role !== 'coord_promocion') return res.status(404).json({ error: 'Coordinador no encontrado' });
  res.json(coordinadorDetail(u));
});

// Mapa de la ficha: secciones del territorio y zonas creadas (con su color)
app.get('/api/coordinadores/:id/mapa', requireUser, requireRole('superadmin'), async (req, res) => {
  const u = users.get(req.params.id);
  if (!u || u.role !== 'coord_promocion') return res.status(404).json({ error: 'Coordinador no encontrado' });
  if (!u.territorio) return res.status(404).json({ error: 'Sin territorio asignado' });
  res.json({
    entidad: u.territorio.entidad,
    secciones: [...territory.sectionsOf(u.territorio)],
    zonas: zonas.zonasDe(u.id).map((z) => ({
      id: z.id,
      nombre: z.zona?.nombre || z.name,
      color: z.zona?.color || '#94a3b8',
      secciones: z.territorio?.secciones || [],
    })),
  });
});

app.post('/api/coordinadores', requireUser, requireRole('superadmin'), async (req, res) => {
  const v = validateCoordinador(req.body);
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  const created = await users.create({ ...v.data, role: 'coord_promocion', parentId: req.user.id });
  await users.update(created.id, { passwordHash: await passwords.hashAsync(v.password) });
  await audit.add({ action: 'user.create', by: req.realUser.id, user: created.id });
  res.status(201).json(coordinadorDetail(users.get(created.id)));
});

// Compartir acceso: como las contraseñas se guardan cifradas (irreversibles), se genera una
// nueva, se cierran las sesiones abiertas de la cuenta y se devuelve una sola vez.
const crypto = require('crypto');
function generarPassword(length = 12) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const todos = letras + digitos;
  let pw = '';
  while (!(/[A-Za-z]/.test(pw) && /\d/.test(pw))) {
    pw = Array.from({ length }, () => todos[crypto.randomInt(todos.length)]).join('');
  }
  return pw;
}

app.post('/api/coordinadores/:id/acceso', requireUser, requireRole('superadmin'), async (req, res) => {
  const u = users.get(req.params.id);
  if (!u || u.role !== 'coord_promocion') return res.status(404).json({ error: 'Coordinador no encontrado' });
  if (!u.username) return res.status(422).json({ error: 'Esta cuenta no tiene usuario de acceso. Edítala para asignarle uno.' });
  const password = generarPassword();
  await users.update(u.id, { passwordHash: await passwords.hashAsync(password) });
  await sessions.destroyAllFor(u.id);
  await audit.add({ action: 'user.password_reset', by: req.realUser.id, user: u.id });
  res.json({ user: coordinadorDetail(users.get(u.id)), password });
});

app.put('/api/coordinadores/:id', requireUser, requireRole('superadmin'), async (req, res) => {
  const current = users.get(req.params.id);
  if (!current || current.role !== 'coord_promocion') return res.status(404).json({ error: 'Coordinador no encontrado' });
  const v = validateCoordinador(req.body, { current });
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  const patch = { ...v.data };
  if (v.password) {
    patch.passwordHash = await passwords.hashAsync(v.password);
    await sessions.destroyAllFor(current.id); // la contraseña nueva cierra sus sesiones abiertas
  }
  await users.update(current.id, patch);
  await audit.add({ action: 'user.update', by: req.realUser.id, user: current.id, password: Boolean(v.password) });
  res.json(coordinadorDetail(users.get(current.id)));
});

// --- Zonas: el CPV reparte su territorio entre Coordinadores de Zona ---------------
const requireCPV = (req, res, next) =>
  req.user.role === 'coord_promocion' ? next() : res.status(403).json({ error: 'Solo el Coordinador de Promoción del Voto gestiona zonas' });

const zonaDetail = (u) => ({
  ...publicUser(u),
  zona: u.zona || null,
  territorio: u.territorio || null,
});

const zonaPropia = (req, res) => {
  const z = users.get(req.params.id);
  if (!z || z.role !== 'coord_zona' || z.parentId !== req.user.id) {
    res.status(404).json({ error: 'Zona no encontrada' });
    return null;
  }
  return z;
};

// --- Directorio del CPV: todas las personas de su estructura, por nivel -----
app.get('/api/directorio', requireUser, requireCPV, (req, res) => {
  const cpv = req.user;
  // Promovidos y aprobados de una cuenta (copia en memoria, sin datos personales)
  const contar = (lista) => {
    let aprobados = 0;
    for (const p of lista) if (p.estatus === 'validado') aprobados += 1;
    return { promovidos: lista.size, aprobados };
  };
  const persona = (u, extra) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    phone: u.phone || '',
    email: u.email || '',
    username: u.username || null,
    avatarUrl: u.avatarAt ? `/api/users/${u.id}/avatar?v=${encodeURIComponent(u.avatarAt)}` : null,
    createdAt: u.createdAt,
    ...extra,
  });
  const personas = [];
  const zonasLista = [];
  for (const z of users.hijos(cpv.id, 'coord_zona')) {
    const zona = { id: z.id, codigo: z.zona?.codigo || '', nombre: z.zona?.nombre || z.name, color: z.zona?.color || '#94a3b8' };
    zonasLista.push(zona);
    const responsables = users.hijos(z.id, 'resp_seccion');
    let promZona = { promovidos: 0, aprobados: 0 };
    const filasRs = [];
    for (const rs of responsables) {
      const seccion = rs.territorio?.secciones?.[0] ?? null;
      const c = contar(store.promovidos.deResponsable(rs.id));
      promZona = { promovidos: promZona.promovidos + c.promovidos, aprobados: promZona.aprobados + c.aprobados };
      const promotores = users.hijos(rs.id, 'promotor');
      filasRs.push(persona(rs, { zona: zona.id, seccion, jefe: z.name, equipo: promotores.length, ...c }));
      for (const pr of promotores) personas.push(persona(pr, { zona: zona.id, seccion, jefe: rs.name, ...contar(store.promovidos.dePromotor(pr.id)) }));
    }
    personas.push(persona(z, { zona: zona.id, seccion: null, jefe: cpv.name, equipo: responsables.length, ...promZona }), ...filasRs);
  }
  const orden = { coord_zona: 0, resp_seccion: 1, promotor: 2 };
  personas.sort((a, b) => orden[a.role] - orden[b.role] || a.name.localeCompare(b.name, 'es'));
  res.json({ zonas: zonasLista.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es')), personas });
});

// --- Configuración del CPV: factor de conversión (metas de promovidos y promotores) ---
async function historialConfig(cpvId) {
  const nombre = (id) => users.get(id)?.name || 'Cuenta eliminada';
  const rows = await audit.query({ action: 'config.update', as: cpvId, limit: 20 });
  return rows.map((a) => ({ at: a.at, by: nombre(a.by), before: a.before, after: a.after }));
}

app.get('/api/configuracion/cpv', requireUser, requireCPV, async (req, res) => {
  res.json({
    config: metas.configDe(req.user),
    defaults: metas.DEFAULTS,
    actualizado: req.user.config?.updatedAt ? { at: req.user.config.updatedAt, by: users.get(req.user.config.updatedBy)?.name || null } : null,
    metas: metas.resumen(req.user),
    historial: await historialConfig(req.user.id),
    confirm: { name: req.realUser.name, hasPassword: Boolean(req.realUser.passwordHash) },
  });
});

// Vista previa: calcula las metas con valores no guardados
app.post('/api/configuracion/cpv/simular', requireUser, requireCPV, async (req, res) => {
  const v = metas.validar(req.body);
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  res.json(metas.resumen(req.user, v.config));
});

app.put('/api/configuracion/cpv', requireUser, requireCPV, async (req, res) => {
  const v = metas.validar(req.body);
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  const check = await auth.confirmPassword(req.realUser, req.body?.password);
  if (!check.ok) {
    return res.status(check.status).json(check.field ? { error: check.error, fields: { password: check.error } } : { error: check.error });
  }
  const before = metas.configDe(req.user);
  const after = v.config;
  const cambio = ['participacion', 'conversion', 'factor'].some((k) => before[k] !== after[k]);
  if (cambio) {
    await users.update(req.user.id, { config: { ...after, updatedAt: new Date().toISOString(), updatedBy: req.realUser.id } });
    await audit.add({
      action: 'config.update',
      by: req.realUser.id,
      as: req.user.id,
      before: { participacion: before.participacion, conversion: before.conversion, factor: before.factor },
      after,
    });
    // Las metas cambian en todos los paneles (CPV, zonas, secciones, promotores y super administrador)
    olvidarPaneles();
  }
  const cpv = users.get(req.user.id);
  res.json({ cambio, config: metas.configDe(cpv), metas: metas.resumen(cpv), historial: await historialConfig(cpv.id) });
});

// --- Promovidos: captura del Promotor Territorial --------------------------
const requirePromotor = (req, res, next) =>
  req.user.role === 'promotor' ? next() : res.status(403).json({ error: 'Solo los Promotores Territoriales capturan promovidos' });
// --- Aviso de privacidad ---------------------------------------------------------
// Página pública (sin sesión) para compartirla con las personas que se promueven
app.get('/aviso-de-privacidad', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(privacidad.pagina());
});
app.get('/api/privacidad', requireUser, (req, res) => res.json(privacidad.aviso()));
app.put('/api/privacidad', requireUser, requireRole('superadmin'), async (req, res) => {
  const r = await privacidad.guardar(req.body?.texto, req.realUser.id);
  if (r.error) return res.status(422).json({ error: r.error, fields: { texto: r.error } });
  await audit.add({ action: 'privacidad.update', by: req.realUser.id, version: r.aviso.version });
  res.json(r.aviso);
});

// --- Datos de ejemplo: el super administrador los borra antes de operar con datos reales ---
app.get('/api/configuracion/ejemplo', requireUser, requireRole('superadmin'), async (req, res) => res.json(await ejemplo.contar()));
app.post('/api/configuracion/ejemplo/borrar', requireUser, requireRole('superadmin'), async (req, res) => {
  const check = await auth.confirmPassword(req.realUser, req.body?.password);
  if (!check.ok) return res.status(check.status).json(check.field ? { error: check.error, fields: { password: check.error } } : { error: check.error });
  const r = await ejemplo.borrar();
  await audit.add({ action: 'ejemplo.borrar', by: req.realUser.id, ...r });
  res.json({ ok: true, borrados: r });
});

// --- Bitácora (super administrador): quién hizo qué y cuándo ------------------------------
app.get('/api/bitacora', requireUser, requireRole('superadmin'), async (req, res) => {
  const accion = String(req.query.accion || '');
  const antes = /^\d+$/.test(String(req.query.antes || '')) ? req.query.antes : null;
  const q = String(req.query.q || '').trim().toLowerCase();
  const ids = q ? users.all().filter((u) => u.name.toLowerCase().includes(q) || (u.username || '').includes(q)).map((u) => u.id).slice(0, 1000) : null;
  const { rows } = await db.query(
    `SELECT id, at, action, by_user, as_user, data FROM audit
     WHERE ($1 = '' OR action = $1) AND ($2::bigint IS NULL OR id < $2::bigint)
       AND ($3::uuid[] IS NULL OR by_user = ANY($3::uuid[]) OR as_user = ANY($3::uuid[]))
     ORDER BY id DESC LIMIT 100`,
    [accion, antes, ids]
  );
  const acciones = accion || antes ? null : (await db.query('SELECT DISTINCT action FROM audit ORDER BY 1')).rows.map((r) => r.action);
  const nombre = (id) => (id ? users.get(id)?.name || 'Cuenta eliminada' : null);
  res.set('Cache-Control', 'no-store');
  res.json({
    acciones,
    registros: rows.map((r) => ({
      id: String(r.id),
      at: r.at.toISOString(),
      accion: r.action,
      quien: nombre(r.by_user),
      como: r.as_user && r.as_user !== r.by_user ? nombre(r.as_user) : null,
      cuenta: r.data?.user ? nombre(r.data.user) || r.data.name || null : r.data?.name || null,
      ip: r.data?.ip || null,
    })),
    mas: rows.length === 100,
  });
});

// --- Notificaciones (campana): las de la cuenta en uso --------------------------
app.get('/api/notificaciones', requireUser, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await notificaciones.lista(req.user.id));
});
// Notificaciones push: este dispositivo se suscribe a las de la cuenta (no en modo dios)
app.get('/api/push/clave', requireUser, (req, res) => res.json({ clave: push.clavePublica() }));
app.post('/api/push/suscribir', requireUser, async (req, res) => {
  if (inGodMode(req)) return res.status(409).json({ error: 'En modo dios no se activan notificaciones de otra cuenta.' });
  const ok = await push.suscribir(req.user.id, req.body?.subscription, req.get('user-agent'));
  if (!ok) return res.status(422).json({ error: 'Suscripción no válida.' });
  res.status(201).json({ ok: true });
});
app.delete('/api/push/suscribir', requireUser, async (req, res) => {
  await push.desuscribir(req.user.id, req.body?.endpoint);
  res.json({ ok: true });
});

app.get('/api/notificaciones/conteo', requireUser, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ noLeidas: await notificaciones.conteo(req.user.id) });
});
// En modo dios no se marcan como leídas: siguen pendientes para el titular de la cuenta
app.post('/api/notificaciones/leidas', requireUser, async (req, res) => {
  if (!inGodMode(req)) await notificaciones.marcarTodas(req.user.id);
  res.json({ noLeidas: await notificaciones.conteo(req.user.id) });
});
app.post('/api/notificaciones/:id/leida', requireUser, async (req, res) => {
  if (!inGodMode(req)) await notificaciones.marcarLeida(req.user.id, req.params.id);
  res.json({ noLeidas: await notificaciones.conteo(req.user.id) });
});

// --- Material electoral: inventario del CPV y órdenes de entrega en cascada ---------
const materialError = (res, err) => {
  if (!(err instanceof material.MaterialError)) throw err;
  res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
};
const conMaterial = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    materialError(res, err);
  }
};
app.get('/api/material', requireUser, conMaterial(async (req, res) => res.json(await material.resumen(req.user))));
app.post('/api/material/articulos', requireUser, conMaterial(async (req, res) => {
  const r = await material.crearArticulo(req.user, req.body || {});
  await audit.add({ action: 'material.articulo', by: req.realUser.id, as: req.user.id, articulo: r.id });
  res.status(201).json(r);
}));
app.post('/api/material/entradas', requireUser, conMaterial(async (req, res) => {
  res.status(201).json(await material.registrarEntrada(req.user, req.body || {}));
}));
app.post('/api/material/ordenes', requireUser, conMaterial(async (req, res) => {
  const r = await material.crearOrden(req.user, req.body || {});
  await audit.add({ action: 'material.orden', by: req.realUser.id, as: req.user.id, orden: r.id });
  res.status(201).json(r);
}));
app.get('/api/material/ordenes/:id', requireUser, conMaterial(async (req, res) => {
  const o = await material.detalle(req.user, req.params.id);
  if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
  res.json(o);
}));
app.post('/api/material/ordenes/:id/recibir', requireUser, conMaterial(async (req, res) => res.json(await material.recibir(req.user, req.params.id))));
app.delete('/api/material/ordenes/:id', requireUser, conMaterial(async (req, res) => res.json(await material.cancelar(req.user, req.params.id))));
// Envíos grandes: primero se valida el nivel y después se lee el contenido
const soloRoles = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'No tienes permiso para esta acción' }));
// Activaciones del Responsable de Sección: lo que reparte a la gente, con fotos
app.get('/api/material/activaciones/opciones', requireUser, conMaterial(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await material.opcionesActivacion(req.user));
}));
app.post('/api/material/activaciones', requireUser, soloRoles('resp_seccion'), express.json({ limit: '40mb' }), conMaterial(async (req, res) => {
  const r = await material.crearActivacion(req.user, req.body || {});
  await audit.add({ action: 'material.activacion', by: req.realUser.id, as: req.user.id, activacion: r.id });
  res.status(201).json(r);
}));
app.get('/api/material/activaciones/fotos/:id', requireUser, conMaterial(async (req, res) => {
  const img = await material.activacionFoto(req.user, req.params.id);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': fotos.tipo(img), 'Cache-Control': 'private, max-age=86400' });
  res.send(img);
}));
app.get('/api/material/activaciones/:id', requireUser, conMaterial(async (req, res) => {
  const a = await material.activacionDetalle(req.user, req.params.id);
  if (!a) return res.status(404).json({ error: 'Activación no encontrada' });
  res.json(a);
}));
app.get('/api/material/evidencias/:id', requireUser, conMaterial(async (req, res) => {
  const img = await material.evidencia(req.user, req.params.id);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': fotos.tipo(img), 'Cache-Control': 'private, max-age=86400' });
  res.send(img);
}));

const promovidoError = (res, err) => {
  if (!(err instanceof promovidos.PromovidoError)) throw err;
  res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
};

// Código postal → estado, municipio y localidades (catálogo SEPOMEX local, sin servicios externos)
// Catálogo de CP del estado de la sección del promotor (autollenado sin internet)
app.get('/api/cp/estado/:entidad', requireUser, async (req, res) => {
  const c = await promovidos.catalogoCP(req.params.entidad);
  if (!c || !c.total) return res.status(404).json({ error: 'Estado no encontrado' });
  res.set('Cache-Control', 'private, max-age=86400');
  res.json(c);
});

app.get('/api/cp/:cp', requireUser, async (req, res) => {
  const r = await promovidos.buscaCP(req.params.cp);
  if (!r) return res.status(404).json({ error: 'No encontramos ese código postal.' });
  res.json(r);
});

app.get('/api/promovidos/contexto', requireUser, requirePromotor, (req, res) => {
  const ctx = promovidos.contexto(req.user);
  if (!ctx) return res.status(409).json({ error: 'Tu Responsable de Sección aún no tiene sección asignada; no puedes capturar promovidos.' });
  res.json(ctx);
});

app.get('/api/promovidos', requireUser, requirePromotor, async (req, res) => {
  res.json(await promovidos.listaDe(req.user));
});

// Ficha y fotos de la INE: el promotor que lo capturó y su rama hasta el CPV
// El super administrador no ve fotos de INE ni descarga fichas, tampoco en modo dios
const inePrivada = (req) => req.realUser.role === 'superadmin';

app.get('/api/promovidos/:id', requireUser, async (req, res) => {
  const p = await promovidos.detalle(req.user, req.params.id);
  if (!p) return res.status(404).json({ error: 'Promovido no encontrado' });
  p.fotosOcultas = inePrivada(req);
  // Indicador de asistencias a asambleas y recorridos: solo lo ve el CPV
  if (req.user.role === 'coord_promocion') p.asistencias = await externas.asistenciasDe(req.user.id, p.claveElector, p.curp);
  await audit.add({ action: 'promovido.view', by: req.realUser.id, as: req.user.id, promovido: p.id });
  res.json(p);
});

// Editar: el promotor que lo capturó o su Responsable de Sección (queda en el historial)
app.put('/api/promovidos/:id', requireUser, soloRoles('promotor', 'resp_seccion'), express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const r = await promovidos.actualizar(req.user, req.params.id, req.body || {});
    if (r.cambios) await audit.add({ action: 'promovido.update', by: req.realUser.id, as: req.user.id, promovido: r.id, cambios: r.cambios });
    res.json(r);
  } catch (err) {
    promovidoError(res, err);
  }
});

// Ficha en PDF (sin historial ni observaciones): quien puede ver la ficha
app.get('/api/promovidos/:id/pdf', requireUser, async (req, res) => {
  if (inePrivada(req)) return res.status(403).json({ error: 'El super administrador no descarga fichas de promovidos.' });
  const p = await promovidos.detalle(req.user, req.params.id);
  if (!p) return res.status(404).json({ error: 'Promovido no encontrado' });
  // El PDF necesita JPEG (las fotos se guardan en WebP)
  const [frente, reverso] = await Promise.all(
    ['frente', 'reverso'].map(async (lado) => {
      const img = await promovidos.foto(req.user, p.id, lado);
      return img ? fotos.aJpeg(img) : null;
    })
  );
  const pdf = await promovidoPdf.generar(p, { frente, reverso }, req.user.name);
  await audit.add({ action: 'promovido.pdf', by: req.realUser.id, as: req.user.id, promovido: p.id });
  // Nombre del archivo: clave de elector y sección a 4 dígitos (p. ej. GNCRIN85072827M600-0420.pdf)
  const archivo = `${String(p.claveElector).replace(/[^A-Z0-9]/gi, '')}-${fmtSeccion(p.seccion)}.pdf`;
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${archivo}"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
});

// Revisión del Responsable de Sección: aprobar o rechazar (con motivo)
app.post('/api/promovidos/:id/revision', requireUser, async (req, res) => {
  try {
    const r = await promovidos.revisar(req.user, req.params.id, req.body || {});
    await audit.add({ action: `promovido.${r.estatus === 'validado' ? 'aprobar' : 'rechazar'}`, by: req.realUser.id, as: req.user.id, promovido: r.id });
    res.json(r);
  } catch (err) {
    promovidoError(res, err);
  }
});
app.get('/api/revision', requireUser, requireRole('resp_seccion'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await promovidos.bandeja(req.user));
});

app.get('/api/promovidos/:id/historial', requireUser, async (req, res) => {
  const h = await promovidos.historial(req.user, req.params.id);
  if (!h) return res.status(404).json({ error: 'Promovido no encontrado' });
  res.json(h);
});

// Observaciones (chat entre el promotor y su Responsable de Sección)
app.get('/api/promovidos/:id/observaciones', requireUser, async (req, res) => {
  try {
    res.json(await promovidos.observaciones(req.user, req.params.id));
  } catch (err) {
    promovidoError(res, err);
  }
});

app.post('/api/promovidos/:id/observaciones', requireUser, async (req, res) => {
  try {
    res.status(201).json(await promovidos.observar(req.user, req.params.id, req.body?.texto));
  } catch (err) {
    promovidoError(res, err);
  }
});

app.get('/api/promovidos/:id/ine/:lado', requireUser, async (req, res) => {
  if (inePrivada(req)) return res.status(403).end();
  const img = await promovidos.foto(req.user, req.params.id, req.params.lado);
  if (!img) return res.status(404).end();
  // Dato sensible: no se guarda en cachés compartidas
  res.set('Cache-Control', 'private, no-store');
  res.type(fotos.tipo(img)).send(img);
});

app.post('/api/promovidos', requireUser, requirePromotor, express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const p = await promovidos.crear(req.user, req.body || {});
    // En bitácora no se guardan datos personales del promovido
    await audit.add({ action: 'promovido.create', by: req.realUser.id, as: req.user.id, promovido: p.id, seccion: p.seccion });
    res.status(201).json(p);
  } catch (err) {
    promovidoError(res, err);
  }
});

// Panel del Responsable de Sección: promotores que debe tener según el cálculo de su CPV
// Panel del Super administrador: cifras agregadas de todo el sistema
app.get('/api/panel/sa', requireUser, requireRole('superadmin'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await memo('panel-sa', 30000, () => panelSA.resumen()));
});

app.get('/api/escritorio/seccion', requireUser, requireRole('resp_seccion'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await memo(`seccion:${req.user.id}`, 8000, () => panelSeccion.escritorio(req.user)));
});
app.get('/api/panel/seccion/promotores', requireUser, (req, res) => {
  if (req.user.role !== 'resp_seccion') return res.status(403).json({ error: 'Solo para Responsables de Sección' });
  res.json(panelSeccion.avancePromotores(req.user));
});

app.get('/api/panel/seccion', requireUser, (req, res) => {
  if (req.user.role !== 'resp_seccion') return res.status(403).json({ error: 'Solo para Responsables de Sección' });
  res.json(panelSeccion.resumen(req.user));
});

// Escritorio del CPV: cifras agregadas de su estructura
app.get('/api/escritorio/promotor', requireUser, requirePromotor, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await escritorioPromotor.promotor(req.user));
});
// Mi sección (Promotor y Responsable de Sección): el contorno de la sección, sin el resto de la entidad
app.get('/api/mi-seccion', requireUser, soloRoles('promotor', 'resp_seccion'), async (req, res) => {
  const rs = req.user.role === 'resp_seccion' ? req.user : users.get(req.user.parentId);
  const t = rs?.territorio;
  const seccion = t?.secciones?.[0] ?? null;
  if (seccion === null || !t.entidad) return res.json({ seccion: null });
  const st = geo.getState(t.entidad);
  const cat = st?.catalog.secciones.find((s) => s.clave === Number(seccion));
  const mun = cat ? st.catalog.municipios.find((m) => m.clave === cat.municipio) : null;
  res.set('Cache-Control', 'no-store'); // los puntos cambian en cualquier momento
  res.json({
    seccion: Number(seccion),
    entidad: st?.catalog.entidad.nombre || null,
    municipio: mun?.nombre || null,
    tipo: cat?.tipo ?? null,
    distritoLocal: cat?.distritoLocal ?? null,
    distritoFederal: cat?.distritoFederal ?? null,
    feature: await geo.seccionFeature(t.entidad, seccion),
    puntos: await puntos.lista(req.user),
    puedeCasilla: req.user.role === 'resp_seccion',
  });
});
// Centro de avisos del CPV: notificaciones a su estructura por nivel y alcance (global, zonas o secciones)
const conAvisos = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof avisos.AvisoError)) throw err;
    res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
  }
};
app.get('/api/avisos', requireUser, requireCPV, conAvisos(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...avisos.opciones(req.user), historial: await avisos.historial(req.user) });
}));
app.post('/api/avisos/conteo', requireUser, requireCPV, conAvisos(async (req, res) => res.json(await avisos.conteo(req.user, req.body))));
app.post('/api/avisos', requireUser, requireCPV, conAvisos(async (req, res) => {
  const r = await avisos.enviar(req.user, req.realUser, req.body || {});
  await audit.add({ action: 'aviso.enviado', by: req.realUser.id, as: req.user.id, aviso: r.id, destinatarios: r.destinatarios });
  res.status(201).json(r);
}));
// Versión de VERTEX y registro de cambios (solo la actual y la anterior), para Configuración
app.get('/api/version', requireUser, soloRoles('superadmin', 'coord_promocion'), (req, res) => {
  const a = version.actual();
  res.json({ actual: a.version, nombre: a.nombre, versiones: version.recientes() });
});
// Lectura de la INE (prototipo): prellena la captura con lo que Tesseract lee en el frente o el reverso.
// La foto se lee en memoria y no se guarda.
const lecturasIne = new Map(); // cuenta → momentos de sus últimas lecturas
const LECTURAS_POR_MINUTO = 20;
app.post('/api/ine/leer', requireUser, soloRoles('promotor', 'resp_seccion'), express.json({ limit: '10mb' }), async (req, res) => {
  const ahora = Date.now();
  const recientes = (lecturasIne.get(req.user.id) || []).filter((t) => ahora - t < 60000);
  if (recientes.length >= LECTURAS_POR_MINUTO) return res.status(429).json({ error: 'Demasiadas lecturas seguidas; espera un momento.' });
  recientes.push(ahora);
  lecturasIne.set(req.user.id, recientes);
  if (lecturasIne.size > 5000) for (const [k, v] of lecturasIne) if (!v.some((t) => ahora - t < 60000)) lecturasIne.delete(k);
  const lado = req.body?.lado === 'reverso' ? 'reverso' : 'frente';
  try {
    const inicio = Date.now();
    const r = await ineOcr.leerIne(lado, req.body?.imagen);
    res.set('Cache-Control', 'no-store');
    res.json({ ...r, ms: Date.now() - inicio });
  } catch (err) {
    console.error('Lectura de la INE:', err.message);
    res.status(500).json({ error: 'No se pudo leer la INE.' });
  }
});
// Puntos del mapa de la sección: de interés (todo el equipo) y casillas (solo el Responsable)
const conPuntos = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof puntos.PuntoError)) throw err;
    res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
  }
};
app.post('/api/mi-seccion/puntos', requireUser, soloRoles('promotor', 'resp_seccion'), conPuntos(async (req, res) => {
  const p = await puntos.crear(req.user, req.body || {});
  await audit.add({ action: 'seccion.punto', by: req.realUser.id, as: req.user.id, punto: p.id, tipo: p.tipo });
  res.status(201).json(p);
}));
app.delete('/api/mi-seccion/puntos/:id', requireUser, soloRoles('promotor', 'resp_seccion'), conPuntos(async (req, res) => {
  res.json(await puntos.borrar(req.user, req.params.id));
}));
app.get('/api/escritorio/zona', requireUser, requireRole('coord_zona'), async (req, res) => res.json(await memo(`zona:${req.user.id}`, 20000, () => escritorioZona.zona(req.user))));
app.get('/api/escritorio/cpv', requireUser, requireCPV, async (req, res) => res.json(await memo(`cpv:${req.user.id}`, 20000, () => escritorio.cpv(req.user))));

// ---------------------------------------------------------------------------
// Agenda: asambleas y recorridos (los crea y publica el CPV; los reporta quien él designe)
// ---------------------------------------------------------------------------
function eventoError(res, err) {
  if (!(err instanceof eventos.EventoError)) throw err;
  res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
}
const conEventos = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    eventoError(res, err);
  }
};
const ESTRUCTURA = ['resp_seccion', 'coord_zona', 'coord_promocion'];
app.get('/api/agenda', requireUser, conEventos(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await eventos.agenda(req.user, String(req.query.mes || '')));
}));
app.get('/api/eventos', requireUser, conEventos(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await eventos.lista(req.user));
}));
app.post('/api/eventos', requireUser, soloRoles('coord_promocion'), express.json({ limit: '20mb' }), conEventos(async (req, res) => {
  res.status(201).json(await eventos.crear(req.user, req.body || {}));
}));
app.get('/api/eventos/contexto', requireUser, soloRoles('coord_promocion'), (req, res) => res.json(eventos.contexto(req.user)));
app.get('/api/eventos/fotos/:id', requireUser, conEventos(async (req, res) => {
  const img = await eventos.foto(req.user, req.params.id);
  res.set({ 'Content-Type': fotos.tipo(img), 'Cache-Control': 'private, max-age=86400' });
  res.send(img);
}));
app.get('/api/eventos/:id', requireUser, conEventos(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await eventos.detalle(req.user, req.params.id));
}));
app.put('/api/eventos/:id', requireUser, soloRoles('coord_promocion'), express.json({ limit: '20mb' }), conEventos(async (req, res) => {
  res.json(await eventos.editar(req.user, req.params.id, req.body || {}));
}));
// Cancelar un evento publicado (con motivo) o eliminar un borrador
app.post('/api/eventos/:id/cancelar', requireUser, soloRoles('coord_promocion'), conEventos(async (req, res) => {
  res.json(await eventos.cancelar(req.user, req.params.id, req.body?.motivo));
}));
app.post('/api/eventos/:id/reporte', requireUser, soloRoles(...ESTRUCTURA), express.json({ limit: '40mb' }), conEventos(async (req, res) => {
  res.json(await eventos.reportar(req.user, req.params.id, req.body || {}));
}));
// Lista de asistencia: corregirla después del reporte (Excel) y descargarla
app.put(
  '/api/eventos/:id/asistencia',
  requireUser,
  soloRoles(...ESTRUCTURA),
  express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'], limit: '40mb' }),
  conEventos(async (req, res) => {
    const archivo = decodeURIComponent(String(req.get('X-File-Name') || 'asistencia.xlsx')).slice(0, 200);
    res.json(await eventos.actualizarLista(req.user, req.params.id, req.body, archivo));
  })
);
app.get('/api/eventos/:id/asistencia.xlsx', requireUser, conEventos(async (req, res) => {
  const r = await eventos.exportarLista(req.user, req.params.id);
  res.set({ 'Content-Type': listas.xlsxTipo, 'Content-Disposition': `attachment; filename="${r.nombre}"` });
  res.send(r.buffer);
}));
// Plantilla de listas (asistencia y estructuras externas: mismo formato)
app.get('/api/listas/plantilla', requireUser, conEventos(async (req, res) => {
  res.set({ 'Content-Type': listas.xlsxTipo, 'Content-Disposition': 'attachment; filename="plantilla-lista.xlsx"' });
  res.send(await listas.plantilla('Personas'));
}));
// Asistencia de la estructura: confirmar, cancelar y enviar la selfie de testimonio
app.post('/api/eventos/:id/asistencia/confirmar', requireUser, soloRoles('coord_zona', 'resp_seccion', 'promotor'), conEventos(async (req, res) => {
  res.json(await eventos.confirmarAsistencia(req.user, req.params.id));
}));
app.delete('/api/eventos/:id/asistencia/confirmar', requireUser, soloRoles('coord_zona', 'resp_seccion', 'promotor'), conEventos(async (req, res) => {
  res.json(await eventos.cancelarAsistencia(req.user, req.params.id));
}));
app.post('/api/eventos/:id/asistencia/selfie', requireUser, soloRoles('coord_zona', 'resp_seccion', 'promotor'), express.json({ limit: '10mb' }), conEventos(async (req, res) => {
  res.json(await eventos.enviarSelfie(req.user, req.params.id, req.body?.selfie));
}));
app.get('/api/eventos/:id/asistencias/:userId/selfie', requireUser, conEventos(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.userId)) return res.status(404).end();
  const img = await eventos.selfieDe(req.user, req.params.id, req.params.userId);
  res.set({ 'Content-Type': fotos.tipo(img), 'Cache-Control': 'private, max-age=86400' });
  res.send(img);
}));
app.get('/api/eventos/:id/historial', requireUser, conEventos(async (req, res) => res.json(await eventos.historialDe(req.user, req.params.id))));
// Trazo por calles para el diseño de recorridos (consulta el servidor de rutas público)
app.get('/api/rutas', requireUser, soloRoles('coord_promocion'), conEventos(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=3600');
  res.json(await eventos.rutaPorCalles(req.query.puntos));
}));

// ---------------------------------------------------------------------------
// Estructuras externas: el CPV carga listas de otras estructuras y ve, solo con conteos, cuántas personas
// coinciden con su árbol o entre ellas. El super administrador ve las de todos los CPV.
// ---------------------------------------------------------------------------
const conExternas = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof externas.ExternaError)) throw err;
    res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
  }
};
const CPV_O_SA = ['coord_promocion', 'superadmin'];
app.get('/api/externas', requireUser, soloRoles(...CPV_O_SA), conExternas(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await externas.resumen(req.user));
}));
app.get('/api/externas/plantilla', requireUser, soloRoles(...CPV_O_SA), conExternas(async (req, res) => {
  const buf = await externas.plantilla();
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="plantilla-estructura-externa.xlsx"',
  });
  res.send(Buffer.from(buf));
}));
app.post(
  '/api/externas/revisar',
  requireUser,
  soloRoles('coord_promocion'),
  express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'], limit: '40mb' }),
  conExternas(async (req, res) => {
    const archivo = decodeURIComponent(String(req.get('X-File-Name') || 'estructura.xlsx')).slice(0, 200);
    res.json(await externas.revisar(req.user, req.body, { archivo, estructuraId: req.query.estructura || null, nombre: req.query.nombre || '' }));
  })
);
app.post('/api/externas/confirmar', requireUser, soloRoles('coord_promocion'), conExternas(async (req, res) => {
  const r = await externas.confirmar(req.user, req.body?.token);
  await audit.add({ action: 'externa.carga', by: req.realUser.id, as: req.user.id, estructura: r.estructuraId, nombre: r.nombre, nuevas: r.nuevas });
  res.status(201).json(r);
}));
app.get('/api/externas/huerfanos', requireUser, soloRoles(...CPV_O_SA), conExternas(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await externas.huerfanos(req.user, { cpv: req.query.cpv, q: req.query.q, p: req.query.p }));
}));
app.get('/api/externas/:id/personas', requireUser, soloRoles(...CPV_O_SA), conExternas(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await externas.personasDe(req.user, req.params.id, { q: req.query.q, p: req.query.p }));
}));
app.get('/api/externas/:id/cargas', requireUser, soloRoles(...CPV_O_SA), conExternas(async (req, res) => res.json(await externas.cargasDe(req.user, req.params.id))));
app.delete('/api/externas/:id', requireUser, soloRoles(...CPV_O_SA), conExternas(async (req, res) => {
  const r = await externas.eliminar(req.user, req.params.id);
  await audit.add({ action: 'externa.eliminar', by: req.realUser.id, as: req.user.id, nombre: r.nombre, personas: r.personas, cpv: r.cpvId });
  res.json(r);
}));

// Informe por periodo de cada nivel (cifras del periodo, unidades a cargo y FODA)
function informeError(res, err) {
  if (!(err instanceof informe.InformeError)) throw err;
  res.status(err.status).json(err.fields ? { error: err.message, fields: err.fields } : { error: err.message });
}
app.get('/api/informe/inicio', requireUser, async (req, res) => {
  try {
    res.json(await informe.inicio(req.user));
  } catch (err) {
    informeError(res, err);
  }
});
app.get('/api/informe', requireUser, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await informe.generar(req.user, { desde: String(req.query.desde || ''), hasta: String(req.query.hasta || '') }));
  } catch (err) {
    informeError(res, err);
  }
});

app.get('/api/zonas', requireUser, requireCPV, (req, res) => res.json(zonas.resumen(req.user)));

app.get('/api/zonas/opciones', requireUser, requireCPV, async (req, res) => {
  const opts = zonas.opciones(req.user, req.query.exclude || null);
  if (!opts) return res.status(409).json({ error: 'Tu cuenta no tiene territorio asignado. Pide al administrador que te asigne uno.' });
  res.json(opts);
});

app.get('/api/zonas/:id', requireUser, requireCPV, async (req, res) => {
  const z = zonaPropia(req, res);
  if (z) res.json(zonaDetail(z));
});

app.post('/api/zonas', requireUser, requireCPV, async (req, res) => {
  const cuenta = validateCuenta(req.body);
  const zona = zonas.validar(req.user, req.body);
  const errors = { ...cuenta.errors, ...zona.errors };
  if (Object.keys(errors).length) return invalid(res, errors);
  const created = await users.create({ ...cuenta.data, role: 'coord_zona', parentId: req.user.id, zona: zona.zona, territorio: zona.territorio });
  await users.update(created.id, { passwordHash: await passwords.hashAsync(cuenta.password) });
  await audit.add({ action: 'zona.create', by: req.realUser.id, as: req.user.id, user: created.id, secciones: zona.territorio.secciones.length });
  res.status(201).json(zonaDetail(users.get(created.id)));
});

app.put('/api/zonas/:id', requireUser, requireCPV, async (req, res) => {
  const current = zonaPropia(req, res);
  if (!current) return;
  const cuenta = validateCuenta(req.body, { current });
  const zona = zonas.validar(req.user, req.body, current.id);
  const errors = { ...cuenta.errors, ...zona.errors };
  if (Object.keys(errors).length) return invalid(res, errors);
  const patch = { ...cuenta.data, zona: zona.zona, territorio: zona.territorio };
  if (cuenta.password) {
    patch.passwordHash = await passwords.hashAsync(cuenta.password);
    await sessions.destroyAllFor(current.id);
  }
  await users.update(current.id, patch);
  await audit.add({ action: 'zona.update', by: req.realUser.id, as: req.user.id, user: current.id, password: Boolean(cuenta.password) });
  res.json(zonaDetail(users.get(current.id)));
});

// --- Responsables de Sección: el Coordinador de Zona reparte las secciones de su zona ---
const requireCZ = (req, res, next) =>
  req.user.role === 'coord_zona' ? next() : res.status(403).json({ error: 'Solo el Coordinador de Zona gestiona Responsables de Sección' });

const rsPropio = (req, res) => {
  const r = users.get(req.params.id);
  if (!r || r.role !== 'resp_seccion' || r.parentId !== req.user.id) {
    res.status(404).json({ error: 'Responsable no encontrado' });
    return null;
  }
  return r;
};
const rsDetail = (u) => ({ ...publicUser(u), territorio: u.territorio || null });

app.get('/api/responsables', requireUser, requireCZ, (req, res) => res.json(responsables.resumen(req.user)));

app.get('/api/responsables/opciones', requireUser, requireCZ, async (req, res) => {
  const opts = responsables.opciones(req.user, req.query.exclude || null);
  if (!opts) return res.status(409).json({ error: 'Tu zona aún no tiene secciones asignadas.' });
  res.json(opts);
});

app.get('/api/responsables/:id', requireUser, requireCZ, async (req, res) => {
  const r = rsPropio(req, res);
  if (r) res.json(rsDetail(r));
});

app.post('/api/responsables', requireUser, requireCZ, async (req, res) => {
  const cuenta = validateCuenta(req.body);
  const t = responsables.validar(req.user, req.body);
  const errors = { ...cuenta.errors, ...t.errors };
  if (Object.keys(errors).length) return invalid(res, errors);
  const created = await users.create({ ...cuenta.data, role: 'resp_seccion', parentId: req.user.id, territorio: t.territorio });
  await users.update(created.id, { passwordHash: await passwords.hashAsync(cuenta.password) });
  await audit.add({ action: 'responsable.create', by: req.realUser.id, as: req.user.id, user: created.id, secciones: t.territorio.secciones.length });
  res.status(201).json(rsDetail(users.get(created.id)));
});

app.put('/api/responsables/:id', requireUser, requireCZ, async (req, res) => {
  const current = rsPropio(req, res);
  if (!current) return;
  const cuenta = validateCuenta(req.body, { current });
  const t = responsables.validar(req.user, req.body, current.id);
  const errors = { ...cuenta.errors, ...t.errors };
  if (Object.keys(errors).length) return invalid(res, errors);

  // Cambio de sección con promotores o promovidos: se transfieren a otro Responsable de la zona
  // o se borran con respaldo obligatorio (misma política que al eliminar una rama)
  const antes = current.territorio?.secciones?.[0];
  const despues = t.territorio?.secciones?.[0];
  if (antes !== undefined && antes !== despues) {
    const promotores = users.hijos(current.id).length;
    const prom = await branch.promovidosDeRama(branch.branchOf(current.id).map((u) => u.id));
    if (promotores || prom.length) {
      const decision = req.body?.dependientes;
      if (decision === 'transferir') {
        const destino = branch.destinosTransferencia(current).find((d) => d.id === req.body?.destinoId);
        if (!destino) return res.status(422).json({ error: 'Elige al Responsable que recibirá a sus promotores y promovidos.', fields: { destinoId: 'Elige un responsable.' } });
        const r = await branch.transferirDependientes(current, users.get(destino.id));
        await audit.add({ action: 'user.transfer', by: req.realUser.id, as: req.user.id, user: destino.id, name: current.name, motivo: 'cambio de sección', ...r });
      } else if (decision === 'borrar') {
        if (!respaldoVigente(req, current.id)) return res.status(409).json({ error: 'Primero descarga el respaldo de sus promotores y promovidos.' });
        const r = await branch.borrarDependientes(current);
        respaldos.delete(claveRespaldo(req, current.id));
        await audit.add({ action: 'user.delete', by: req.realUser.id, as: req.user.id, user: current.id, name: current.name, motivo: 'cambio de sección', accounts: r.subordinados, promovidos: r.promovidos, backup: true });
      } else {
        return res.status(409).json({
          error: 'Este responsable ya tiene promotores o promovidos en su sección actual.',
          requiereDecision: true,
          promotores,
          promovidos: prom.length,
          destinos: branch.destinosTransferencia(current),
        });
      }
    }
  }
  const patch = { ...cuenta.data, territorio: t.territorio };
  if (cuenta.password) {
    patch.passwordHash = await passwords.hashAsync(cuenta.password);
    await sessions.destroyAllFor(current.id);
  }
  await users.update(current.id, patch);
  await audit.add({ action: 'responsable.update', by: req.realUser.id, as: req.user.id, user: current.id, password: Boolean(cuenta.password) });
  res.json(rsDetail(users.get(current.id)));
});

// --- Generador de estructura (servidor de demostración) — Super administrador ---
// Arma zonas, responsables, promotores y promovidos de un CPV sin zonas hasta un % de su meta.
app.get('/api/configuracion/generador', requireUser, requireRole('superadmin'), (req, res) => {
  const all = users.all();
  const cpvs = all
    .filter((u) => u.role === 'coord_promocion')
    .map((u) => ({ id: u.id, name: u.name, territorio: u.territorio ? territory.resolve(u.territorio).resumen || null : null, tieneZonas: users.hijos(u.id, 'coord_zona').length > 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ cpvs, lotes: generador.lotes(), confirm: { hasPassword: Boolean(req.realUser.passwordHash) } });
});
app.post('/api/configuracion/generador', requireUser, requireRole('superadmin'), async (req, res) => {
  const check = await auth.confirmPassword(req.realUser, req.body?.password);
  if (!check.ok) return res.status(check.status).json(check.field ? { error: check.error, fields: { password: check.error } } : { error: check.error });
  try {
    const r = await generador.generar({ cpvId: req.body?.cpvId, porcentaje: req.body?.porcentaje, porId: req.realUser.id });
    olvidarPaneles();
    const { password: _p, ...sinClave } = r;
    await audit.add({ action: 'generador.estructura', by: req.realUser.id, as: r.cpvId, after: sinClave });
    res.json(r);
  } catch (err) {
    if (err instanceof generador.GeneradorError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});
app.post('/api/configuracion/generador/:id/eliminar', requireUser, requireRole('superadmin'), async (req, res) => {
  const check = await auth.confirmPassword(req.realUser, req.body?.password);
  if (!check.ok) return res.status(check.status).json(check.field ? { error: check.error, fields: { password: check.error } } : { error: check.error });
  try {
    await generador.eliminar(req.params.id, req.realUser.id);
    olvidarPaneles();
    await audit.add({ action: 'generador.eliminar', by: req.realUser.id, after: { lote: req.params.id } });
    res.json({ ok: true, lotes: generador.lotes() });
  } catch (err) {
    if (err instanceof generador.GeneradorError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// --- Calculadora de costos (pública en /costos; los enlaces anteriores con clave siguen sirviendo) ---
const costosPublico = () => {
  const c = costos.config();
  const m = settings.meta(costos.KEY);
  return { config: c, tipos: costos.TIPOS, actualizado: m ? { at: m.updatedAt, by: users.get(m.updatedBy)?.name || null } : null };
};
app.get('/api/configuracion/costos', requireUser, requireRole('superadmin'), (req, res) => {
  res.json({ ...costosPublico(), territorios: costos.territorios().map((t) => ({ clave: t.clave, nombre: t.nombre, ln: t.ln })) });
});
app.put('/api/configuracion/costos', requireUser, requireRole('superadmin'), async (req, res) => {
  const v = costos.validar(req.body || {});
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  const antes = costos.config();
  await settings.set(costos.KEY, { ...v.config, token: antes.token }, req.realUser.id);
  const { token: _t, ...sinClave } = v.config;
  await audit.add({ action: 'settings.costos', by: req.realUser.id, after: sinClave });
  res.json(costosPublico());
});
// Genera (o regenera) la clave del enlace: el enlace anterior deja de funcionar
app.post('/api/configuracion/costos/enlace', requireUser, requireRole('superadmin'), async (req, res) => {
  const c = costos.config();
  const { token: _t, ...resto } = c;
  await settings.set(costos.KEY, { ...resto, token: costos.nuevoToken() }, req.realUser.id);
  await audit.add({ action: 'settings.costos.enlace', by: req.realUser.id, after: { regenerado: Boolean(c.token) } });
  res.json(costosPublico());
});
// Vista previa para el super administrador (con sesión), con los mismos cálculos que la página pública
app.post('/api/configuracion/costos/simular', requireUser, requireRole('superadmin'), (req, res) => {
  try {
    res.json(costos.cotizar(req.body || {}));
  } catch (err) {
    if (err instanceof costos.CostosError) return res.status(err.status).json({ error: err.message, fields: err.fields });
    throw err;
  }
});
const costosClave = (req, res, next) => {
  if (!costos.tokenValido(req.params.clave)) return res.status(404).json({ error: 'Enlace no válido' });
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
};
const costosAbierto = (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
};
// Enlace fijo /costos (sin clave) y enlaces anteriores con clave: los dos muestran la versión vigente
app.get('/api/costos', costosAbierto, (req, res) => res.json(costos.publico()));
app.get('/api/costos/:clave', costosClave, (req, res) => res.json(costos.publico()));
app.post(['/api/costos/cotizar', '/api/costos/:clave/cotizar'], (req, res, next) => (req.params.clave === undefined ? costosAbierto : costosClave)(req, res, next), (req, res) => {
  try {
    // La cotización pública siempre parte de hoy (contratando hoy)
    // y solo con territorios de la base de datos (sin lista nominal capturada a mano)
    const { fecha: _f, ln: _ln, nombre: _n, ...cuerpo } = req.body || {};
    res.json(costos.cotizar(cuerpo, { requierePartido: true }));
  } catch (err) {
    if (err instanceof costos.CostosError) return res.status(err.status).json({ error: err.message, fields: err.fields });
    throw err;
  }
});

// --- Configuración › WhatsApp (Evolution API) — Super administrador ---------
const waPublico = () => {
  const p = whatsapp.publico();
  return { ...p, actualizado: p.actualizado ? { at: p.actualizado.updatedAt, by: users.get(p.actualizado.updatedBy)?.name || null } : null };
};

app.get('/api/configuracion/whatsapp', requireUser, requireRole('superadmin'), (req, res) => {
  res.json({ ...waPublico(), confirm: { name: req.realUser.name, hasPassword: Boolean(req.realUser.passwordHash) } });
});

app.put('/api/configuracion/whatsapp', requireUser, requireRole('superadmin'), async (req, res) => {
  const v = whatsapp.validar(req.body || {});
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  const check = await auth.confirmPassword(req.realUser, req.body?.password);
  if (!check.ok) {
    return res.status(check.status).json(check.field ? { error: check.error, fields: { password: check.error } } : { error: check.error });
  }
  await settings.set(whatsapp.KEY, v.config, req.realUser.id);
  // En bitácora no se guarda la API key
  const { apiKey, ...sinClave } = v.config;
  await audit.add({ action: 'settings.whatsapp', by: req.realUser.id, after: { ...sinClave, apiKeyCambiada: Boolean(String(req.body?.apiKey || '').trim()) } });
  res.json(waPublico());
});

// Prueba con los datos del formulario (sin guardar); la API key vacía usa la guardada
app.post('/api/configuracion/whatsapp/probar', requireUser, requireRole('superadmin'), async (req, res) => {
  const v = whatsapp.validar({ ...req.body, enabled: false });
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  try {
    res.json(await whatsapp.estado(v.config));
  } catch (err) {
    if (!(err instanceof whatsapp.WhatsAppError)) throw err;
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/configuracion/whatsapp/mensaje-prueba', requireUser, requireRole('superadmin'), async (req, res) => {
  const v = whatsapp.validar({ ...req.body, enabled: false });
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (phone.length !== 10) return invalid(res, { phone: 'Escribe un teléfono de 10 dígitos.' });
  try {
    await whatsapp.enviarTexto(phone, 'Mensaje de prueba de VERTEX: la conexión con WhatsApp funciona correctamente. ✅', v.config);
    await audit.add({ action: 'settings.whatsapp_test', by: req.realUser.id });
    res.json({ ok: true });
  } catch (err) {
    if (!(err instanceof whatsapp.WhatsAppError)) throw err;
    res.status(502).json({ error: err.message });
  }
});

// --- Perfil personal (todos los niveles) -----------------------------------
app.patch('/api/me', requireUser, async (req, res) => {
  const { data, errors } = cleanContact(req.body);
  const about = String(req.body.about || '').trim();
  if (about.length > 500) errors.about = 'Máximo 500 caracteres.';
  if (Object.keys(errors).length) return invalid(res, errors);
  const updated = await users.update(req.user.id, { ...data, about });
  res.json(publicUser(updated));
});

// Foto: el navegador la recorta y comprime a JPEG antes de enviarla
app.put('/api/me/avatar', requireUser, express.json({ limit: '3mb' }), async (req, res) => {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
  const buffer = match ? Buffer.from(match[1], 'base64') : null;
  const isJpeg = buffer && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isJpeg) return res.status(422).json({ error: 'La imagen no es válida.' });
  if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'La imagen es demasiado grande (máx. 2 MB).' });
  await avatars.save(req.user.id, await fotos.comprimir(buffer, fotos.AVATAR));
  const updated = await users.update(req.user.id, { avatarAt: new Date().toISOString() });
  res.json(publicUser(updated));
});

app.delete('/api/me/avatar', requireUser, async (req, res) => {
  await avatars.remove(req.user.id);
  const updated = await users.update(req.user.id, { avatarAt: null });
  res.json(publicUser(updated));
});

app.put('/api/me/password', requireUser, async (req, res) => {
  if (inGodMode(req)) return res.status(403).json({ error: 'En modo dios no se puede cambiar la contraseña del usuario.' });
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  const confirm = String(req.body.confirm || '');
  const errors = {};
  if (req.user.passwordHash && !(await passwords.verifyAsync(current, req.user.passwordHash))) errors.current = 'La contraseña actual no es correcta.';
  if (!auth.validPassword(next)) errors.next = auth.PASSWORD_HINT;
  else if (next !== confirm) errors.confirm = 'Las contraseñas no coinciden.';
  if (Object.keys(errors).length) return invalid(res, errors);
  await users.update(req.user.id, { passwordHash: await passwords.hashAsync(next) });
  res.json({ ok: true });
});

// Foto de perfil de una cuenta: solo si la cuenta es propia o está en la rama visible
app.get('/api/users/:id/avatar', requireUser, async (req, res) => {
  const target = users.get(req.params.id);
  if (!target || !target.avatarAt || !canView(req.user, target)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  const img = await avatars.get(target.id);
  if (!img) return res.status(404).end();
  res.type(fotos.tipo(img)).send(img);
});

// --- Bases de datos (Super administrador) ----------------------------------
let importing = false;
// Ejecuta una importación de archivo grande, una a la vez
const importRoute = (types, defaultName, run, ErrorClass) => [
  requireUser,
  requireRole('superadmin'),
  express.raw({ type: types, limit: '500mb' }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    if (importing) return res.status(409).json({ error: 'Ya hay una importación en curso. Espera a que termine.' });
    const fileName = decodeURIComponent(String(req.get('X-File-Name') || defaultName)).slice(0, 200);
    importing = true;
    try {
      res.status(201).json(await run(req.body, { fileName, importedBy: req.user.name }));
    } catch (err) {
      if (err instanceof ErrorClass) return res.status(422).json({ error: err.message });
      console.error('Error al importar:', err);
      res.status(500).json({ error: 'Error inesperado al procesar el archivo.' });
    } finally {
      importing = false;
    }
  },
];

// Cartografía (.zip con shapefiles)
app.post(
  '/api/geo/imports',
  ...importRoute(
    ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    'archivo.zip',
    async (buf, opts) => ({ states: await geo.importZip(buf, opts) }),
    geo.ImportError
  )
);

app.get('/api/geo/states', requireUser, requireRole('superadmin'), async (req, res) => {
  const pad = new Map(padron.summary().states.map((s) => [s.clave, s]));
  res.json(geo.listStates().map((s) => ({ ...s, padron: pad.get(s.clave) || null })));
});

app.get('/api/geo/states/:clave', requireUser, requireRole('superadmin'), async (req, res) => {
  const state = geo.getState(req.params.clave);
  if (!state) return res.status(404).json({ error: 'Entidad no cargada' });
  const pad = padron.summary().states.find((s) => s.clave === state.meta.clave) || null;
  res.json({ ...state, padron: pad ? { ...pad, cruce: padron.crossCheck(state.meta.clave, state.catalog) } : null });
});

app.delete('/api/geo/states/:clave', requireUser, requireRole('superadmin'), async (req, res) => {
  if (!(await geo.removeState(req.params.clave))) return res.status(404).json({ error: 'Entidad no cargada' });
  res.json({ ok: true });
});

// Geometrías (GeoJSON en WGS84) para uso de los módulos de mapas
app.get('/api/geo/states/:clave/layers/:layer', requireUser, async (req, res) => {
  const text = await geo.layerText(req.params.clave, req.params.layer);
  if (!text) return res.status(404).json({ error: 'Capa no disponible' });
  res.set('Cache-Control', 'private, max-age=300');
  res.type('application/geo+json').send(text);
});

// Padrón electoral / lista nominal (.xlsx del INE)
app.post(
  '/api/padron/imports',
  ...importRoute(
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ],
    'padron.xlsx',
    (buf, opts) => padron.importXlsx(buf, opts),
    padron.PadronError
  )
);

app.get('/api/padron', requireUser, requireRole('superadmin'), async (req, res) => {
  const cartografia = new Set(geo.listStates().map((s) => s.clave));
  const { lastImport, states } = padron.summary();
  res.json({
    lastImport,
    states: states.map((s) => ({
      ...s,
      cartografia: cartografia.has(s.clave),
      cruce: cartografia.has(s.clave) ? padron.crossCheck(s.clave, geo.getState(s.clave).catalog) : null,
    })),
  });
});

// Electores por sección de una entidad (para pintar mapas)
app.get('/api/padron/:clave/secciones', requireUser, requireRole('superadmin'), async (req, res) => {
  const data = padron.sectionsOf(Number(req.params.clave));
  if (!data) return res.status(404).json({ error: 'Sin padrón para esta entidad' });
  res.json(Object.fromEntries([...data].map(([k, v]) => [k, v.ln])));
});

// --- Solo desarrollo: entrar como cualquier usuario para probar cada nivel ----
if (!isProd) {
  app.get('/api/dev/users', async (req, res) => {
    const all = users.all();
    res.json(
      [...all]
        .sort((a, b) => getRole(a.role).level - getRole(b.role).level || a.name.localeCompare(b.name))
        .map((u) => publicUser(u))
    );
  });

  app.post('/api/dev/session', async (req, res) => {
    const user = users.get(req.body.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    await auth.startSession(res, user.id);
    res.json({ ok: true });
  });
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Recurso no encontrado' });
});

// Errores inesperados: en la API siempre se responde JSON (nunca la página de error HTML)
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  if (!req.path.startsWith('/api/') || res.headersSent) return next(err);
  res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
});

// --- PWA: el service worker y el manifest nunca se cachean en HTTP ---------
app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => {
  res.set('Cache-Control', 'no-cache');
  if (req.path === '/manifest.webmanifest') res.type('application/manifest+json');
  next();
});

// --- Archivos estáticos ----------------------------------------------------
// Leaflet (mapas OpenStreetMap) servido desde node_modules
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist'), { maxAge: isProd ? '30d' : 0 }));
const REVALIDAR = /\.(html|css|js|webmanifest)$/;
// Calculadora de costos con clave (enlaces anteriores): solo con la clave correcta (si no, 404)
app.get('/costos/:clave', (req, res) => {
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer' });
  if (!costos.tokenValido(req.params.clave)) return res.status(404).type('text/plain').send('Página no encontrada');
  res.sendFile(path.join(PUBLIC_DIR, 'costos.html'));
});
// Enlace fijo del cotizador: no cambia al guardar precios ni al regenerar la clave
app.get('/costos', (req, res) => {
  res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer' });
  res.sendFile(path.join(PUBLIC_DIR, 'costos.html'));
});

// Raíz del sitio: quien tiene sesión entra directo a la app; los visitantes ven la página
// informativa (con «Iniciar sesión», que abre la app en /entrar)
app.get('/', (req, res) => {
  const token = auth.readCookie(req, 'vx_session');
  const sesion = token && sessions.get(token);
  const conSesion = Boolean(sesion && users.get(sesion.userId) && !users.get(sesion.userId).disabled);
  // La misma dirección sirve dos páginas distintas según la sesión: nunca se guarda en caché ni
  // responde «304 sin cambios» (ambas tienen la misma fecha de archivo y, tras Cloudflare, sin
  // ETag; el navegador mostraría la página informativa guardada a quien ya inició sesión)
  res.set({ 'Cache-Control': 'no-store, private', Vary: 'Cookie' });
  // La app no se indexa; la página informativa sí
  if (conSesion) res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(PUBLIC_DIR, conSesion ? 'index.html' : 'landing.html'), { etag: false, lastModified: false });
});
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    maxAge: isProd ? '1h' : 0,
    setHeaders(res, file) {
      if (REVALIDAR.test(file)) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// --- Fallback SPA ----------------------------------------------------------
app.get('*', async (req, res) => {
  // Pantallas internas de la app (y /entrar): fuera de los buscadores
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

async function start() {
  await db.migrate();
  await importarSiHaceFalta();
  await store.init();
  await settings.init();
  await push.init();
  await geo.init();
  await padron.init();
  await auth.ensureAdminCredentials();
  await zonas.migrarColores();
  app.listen(PORT, () => {
    // Fotos guardadas antes de la compresión: se pasan a WebP en segundo plano (una sola vez)
    setTimeout(() => fotos.compactarExistentes(), 10000);
    almacen.iniciar();
    // Asambleas y recorridos: recordatorio de reporte el mismo día y aviso de los no reportados
    const avisarEventos = () => eventos.recordatorios().catch((err) => console.error('Recordatorios de eventos:', err.message));
    // Datos de ejemplo de agenda y estructuras paralelas: una sola vez, solo si esas tablas están vacías
    setTimeout(() => require('./src/ejemplo-agenda').sembrar().catch((err) => console.error('Datos de ejemplo de agenda:', err.message)), 15000);
    setTimeout(avisarEventos, 20000);
    setInterval(avisarEventos, 10 * 60 * 1000);
    console.log(`VERTEX escuchando en http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('VERTEX: no se pudo arrancar:', err.message);
  process.exit(1);
});
