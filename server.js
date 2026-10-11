const path = require('path');
const express = require('express');
const compression = require('compression');
const { ROLES, getRole } = require('./src/roles');
const db = require('./src/db');
const store = require('./src/store');
const { users, avatars, passwords, audit, sessions } = store;
const { importarSiHaceFalta } = require('./src/importar-json');
const { visibleUsers, canView, creatableRole, chainOf } = require('./src/access');
const auth = require('./src/auth');
const { requireUser, inGodMode } = auth;
const geo = require('./src/geo');
const branch = require('./src/branch');
const zonas = require('./src/zonas');
const escritorio = require('./src/escritorio');
const responsables = require('./src/responsables');
const metas = require('./src/metas');
const padron = require('./src/padron');
const territory = require('./src/territory');
const { PARTIDOS } = require('./src/partidos');
const { cleanContact, suggestUsername, checkUsername, validateCuenta, validateCoordinador } = require('./src/validate');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
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
app.use((req, res, next) => (req.path === '/api/me/avatar' ? next() : jsonBody(req, res, next)));


const publicUser = (u, all) => {
  const parent = u.parentId ? all.find((p) => p.id === u.parentId) : null;
  return {
    id: u.id,
    name: u.name,
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
          zonas: all.filter((x) => x.parentId === u.id && x.role === 'coord_zona').length,
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

app.get('/api/me', requireUser, async (req, res) => {
  res.json({
    user: { ...publicUser(req.user, users.all()), hasPassword: Boolean(req.user.passwordHash) },
    role: getRole(req.user.role),
    childRole: creatableRole(req.user),
    canDelete: canDeleteAccounts(req),
    // La confirmación de acciones delicadas usa la contraseña de quien inició sesión
    confirm: { name: req.realUser.name, hasPassword: Boolean(req.realUser.passwordHash) },
    // En modo dios: ruta jerárquica desde el super administrador hasta la cuenta actual
    godMode: inGodMode(req)
      ? {
          by: { id: req.realUser.id, name: req.realUser.name },
          chain: chainOf(req.user, users.all()).map((u) => ({ id: u.id, name: u.name, roleName: getRole(u.role).name, role: u.role })),
        }
      : null,
    dev: !isProd,
  });
});

// --- Modo dios: el super administrador entra como cualquier otro usuario ----
app.post('/api/god-mode', requireUser, auth.startGodMode);
app.delete('/api/god-mode', requireUser, auth.stopGodMode);

// Cuentas visibles para el usuario: solo su inmediato inferior
app.get('/api/users', requireUser, async (req, res) => {
  const all = users.all();
  res.json(visibleUsers(req.user, all).map((u) => publicUser(u, all)));
});

// Alta rápida de cuentas (niveles sin formulario propio): solo el nivel inmediato inferior
app.post('/api/users', requireUser, async (req, res) => {
  const role = creatableRole(req.user);
  if (!role) return res.status(403).json({ error: 'Tu nivel no puede crear cuentas' });
  if (role.key === 'coord_promocion') return res.status(422).json({ error: 'Usa el formulario de Coordinador de Promoción.' });
  if (role.key === 'coord_zona') return res.status(422).json({ error: 'Usa el formulario de Nueva zona.' });
  if (role.key === 'resp_seccion') return res.status(422).json({ error: 'Usa el formulario de Nuevo responsable de sección.' });

  const { data, errors } = cleanContact(req.body);
  if (Object.keys(errors).length) return invalid(res, errors);

  const created = await users.create({ ...data, role: role.key, parentId: req.user.id });
  res.status(201).json(publicUser(created, users.all()));
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

app.get('/api/users/:id/branch', requireUser, async (req, res) => {
  if (!deletableTarget(req, res)) return;
  res.json(branch.summary(req.params.id));
});

app.get('/api/users/:id/backup', requireUser, async (req, res) => {
  const target = deletableTarget(req, res);
  if (!target) return;
  const b = await branch.backupZip(target.id, { by: req.realUser.name });
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
  const check = auth.confirmPassword(req.realUser, req.body?.password);
  if (!check.ok) {
    return res.status(check.status).json(check.field ? { error: check.error, fields: { password: check.error } } : { error: check.error });
  }
  const removed = await branch.removeBranch(target.id);
  await audit.add({
    action: 'user.delete',
    by: req.realUser.id,
    as: req.user.id,
    user: target.id,
    name: target.name,
    accounts: removed,
    backup: Boolean(req.body?.backupDone),
  });
  res.json({ ok: true, removed });
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
  ...publicUser(u, users.all()),
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

app.post('/api/coordinadores', requireUser, requireRole('superadmin'), async (req, res) => {
  const v = validateCoordinador(req.body);
  if (Object.keys(v.errors).length) return invalid(res, v.errors);
  const created = await users.create({ ...v.data, role: 'coord_promocion', parentId: req.user.id });
  await users.update(created.id, { passwordHash: passwords.hash(v.password) });
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
  await users.update(u.id, { passwordHash: passwords.hash(password) });
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
    patch.passwordHash = passwords.hash(v.password);
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
  ...publicUser(u, users.all()),
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
  const check = auth.confirmPassword(req.realUser, req.body?.password);
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
  }
  const cpv = users.get(req.user.id);
  res.json({ cambio, config: metas.configDe(cpv), metas: metas.resumen(cpv), historial: await historialConfig(cpv.id) });
});

// Escritorio del CPV: cifras agregadas de su estructura
app.get('/api/escritorio/cpv', requireUser, requireCPV, (req, res) => res.json(escritorio.cpv(req.user)));

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
  await users.update(created.id, { passwordHash: passwords.hash(cuenta.password) });
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
    patch.passwordHash = passwords.hash(cuenta.password);
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
const rsDetail = (u) => ({ ...publicUser(u, users.all()), territorio: u.territorio || null });

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
  await users.update(created.id, { passwordHash: passwords.hash(cuenta.password) });
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
  const patch = { ...cuenta.data, territorio: t.territorio };
  if (cuenta.password) {
    patch.passwordHash = passwords.hash(cuenta.password);
    await sessions.destroyAllFor(current.id);
  }
  await users.update(current.id, patch);
  await audit.add({ action: 'responsable.update', by: req.realUser.id, as: req.user.id, user: current.id, password: Boolean(cuenta.password) });
  res.json(rsDetail(users.get(current.id)));
});

// --- Perfil personal (todos los niveles) -----------------------------------
app.patch('/api/me', requireUser, async (req, res) => {
  const { data, errors } = cleanContact(req.body);
  const about = String(req.body.about || '').trim();
  if (about.length > 500) errors.about = 'Máximo 500 caracteres.';
  if (Object.keys(errors).length) return invalid(res, errors);
  const updated = await users.update(req.user.id, { ...data, about });
  res.json(publicUser(updated, users.all()));
});

// Foto: el navegador la recorta y comprime a JPEG antes de enviarla
app.put('/api/me/avatar', requireUser, express.json({ limit: '3mb' }), async (req, res) => {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
  const buffer = match ? Buffer.from(match[1], 'base64') : null;
  const isJpeg = buffer && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isJpeg) return res.status(422).json({ error: 'La imagen no es válida.' });
  if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'La imagen es demasiado grande (máx. 2 MB).' });
  await avatars.save(req.user.id, buffer);
  const updated = await users.update(req.user.id, { avatarAt: new Date().toISOString() });
  res.json(publicUser(updated, users.all()));
});

app.delete('/api/me/avatar', requireUser, async (req, res) => {
  await avatars.remove(req.user.id);
  const updated = await users.update(req.user.id, { avatarAt: null });
  res.json(publicUser(updated, users.all()));
});

app.put('/api/me/password', requireUser, async (req, res) => {
  if (inGodMode(req)) return res.status(403).json({ error: 'En modo dios no se puede cambiar la contraseña del usuario.' });
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  const confirm = String(req.body.confirm || '');
  const errors = {};
  if (req.user.passwordHash && !passwords.verify(current, req.user.passwordHash)) errors.current = 'La contraseña actual no es correcta.';
  if (!auth.validPassword(next)) errors.next = auth.PASSWORD_HINT;
  else if (next !== confirm) errors.confirm = 'Las contraseñas no coinciden.';
  if (Object.keys(errors).length) return invalid(res, errors);
  await users.update(req.user.id, { passwordHash: passwords.hash(next) });
  res.json({ ok: true });
});

// Foto de perfil de una cuenta: solo si la cuenta es propia o está en la rama visible
app.get('/api/users/:id/avatar', requireUser, async (req, res) => {
  const target = users.get(req.params.id);
  if (!target || !target.avatarAt || !canView(req.user, target, users.all())) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  const img = await avatars.get(target.id);
  if (!img) return res.status(404).end();
  res.type('image/jpeg').send(img);
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
        .map((u) => publicUser(u, all))
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
app.use(
  express.static(PUBLIC_DIR, {
    maxAge: isProd ? '1h' : 0,
    setHeaders(res, file) {
      if (REVALIDAR.test(file)) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// --- Fallback SPA ----------------------------------------------------------
app.get('*', async (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

async function start() {
  await db.migrate();
  await importarSiHaceFalta();
  await store.init();
  await geo.init();
  await padron.init();
  await auth.ensureAdminCredentials();
  await zonas.migrarColores();
  app.listen(PORT, () => {
    console.log(`VERTEX escuchando en http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('VERTEX: no se pudo arrancar:', err.message);
  process.exit(1);
});
