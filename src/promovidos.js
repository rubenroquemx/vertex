// Captura de promovidos por el Promotor Territorial.
// Reglas:
//  - Solo de la sección asignada al Responsable de Sección del que depende el promotor
//    (la sección impresa en la INE debe coincidir).
//  - La INE debe servir para votar en la elección: vigencia igual o mayor al año de la jornada.
//  - Las fotos de la INE solo las ve la rama del promotor hasta el CPV.
//  - Todo promovido entra «En revisión»; lo valida su Responsable de Sección directo.
//  - Lo pueden editar el promotor que lo capturó y su Responsable de Sección; cada cambio
//    queda en el historial. Las observaciones (chat) son solo entre esos dos.
//  - Una persona solo puede promoverse una vez (clave de elector y CURP únicas).
//  - Estado y municipio se toman del catálogo de SEPOMEX a partir del CP (no del navegador).
const crypto = require('crypto');
const { query, tx } = require('./db');
const { users, promovidos: cachePromovidos } = require('./store');
const geo = require('./geo');
const { chainOf } = require('./access');
const { fmtSeccion } = require('./formato');
const { notificar } = require('./notificaciones');
const { comprimir } = require('./fotos');
const privacidad = require('./privacidad');

// Jornada electoral: la INE debe estar vigente ese año para poder votar
const ELECCION = require('./eleccion');

class PromovidoError extends Error {
  constructor(message, status = 422, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

// Catálogo de códigos postales (paquete ESM: se carga una sola vez)
let mxcp = null;
const cpLib = async () => (mxcp ||= await import('@webrek/mx-cp'));

// Catálogo de códigos postales de un estado, para capturar sin internet (se arma una sola vez)
const catalogos = new Map();
async function catalogoCP(entidad) {
  const clave = String(Number(entidad)).padStart(2, '0');
  if (!/^\d{2}$/.test(clave) || clave === '00') return null;
  if (catalogos.has(clave)) return catalogos.get(clave);
  const lib = await cpLib();
  const cps = {};
  for (let m = 1; m <= 600; m++) {
    for (const cp of await lib.cpsDeMunicipio(`${clave}${String(m).padStart(3, '0')}`)) {
      const r = await lib.buscaCP(cp);
      if (r) cps[cp] = [r.municipio, r.estado, r.ciudad || '', r.asentamientos.map((a) => [a.nombre, a.tipo])];
    }
  }
  const out = { entidad: Number(clave), total: Object.keys(cps).length, cps };
  catalogos.set(clave, out);
  return out;
}

async function buscaCP(cp) {
  const c = String(cp || '').trim();
  if (!/^\d{5}$/.test(c)) return null;
  const r = await (await cpLib()).buscaCP(c);
  if (!r) return null;
  return {
    cp: r.cp,
    estado: r.estado,
    municipio: r.municipio,
    ciudad: r.ciudad || '',
    asentamientos: r.asentamientos.map((a) => ({ nombre: a.nombre, tipo: a.tipo })),
  };
}

// Sección y entidad que el promotor puede capturar: las de su Responsable de Sección
function contexto(promotor) {
  const resp = users.get(promotor.parentId);
  const t = resp?.territorio;
  const seccion = t?.secciones?.[0] ?? null;
  if (!resp || resp.role !== 'resp_seccion' || seccion === null) return null;
  const state = geo.getState(t.entidad);
  return {
    responsable: { id: resp.id, name: resp.name },
    entidad: { clave: t.entidad, nombre: state?.meta?.nombre || '' },
    seccion,
    vigenciaMin: ELECCION.anio,
    eleccion: ELECCION.texto,
  };
}

const upper = (v) =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

const CLAVE_ELECTOR_RE = /^[A-Z]{6}\d{8}[HMX]\d{3}$/;
const CURP_RE =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

function fotoValida(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { error: 'Toma o elige la foto.' };
  if (buf.length > 2.5 * 1024 * 1024) return { error: 'La foto es demasiado grande.' };
  return { buf };
}

// `excluirId`: al editar, el propio registro no cuenta como duplicado y las fotos son opcionales
async function validar(promotor, body, { excluirId = null } = {}) {
  const ctx = contexto(promotor);
  if (!ctx) throw new PromovidoError('Tu Responsable de Sección aún no tiene sección asignada; no puedes capturar promovidos.', 409);
  const errors = {};

  const opcional = (v) => excluirId && !v;
  const frente = opcional(body.ineFrente) ? {} : fotoValida(body.ineFrente);
  const reverso = opcional(body.ineReverso) ? {} : fotoValida(body.ineReverso);
  if (frente.error) errors.ineFrente = frente.error;
  if (reverso.error) errors.ineReverso = reverso.error;

  const vigencia = Number(String(body.vigencia || '').trim());
  if (!Number.isInteger(vigencia) || vigencia < 2000 || vigencia > ELECCION.anio + 12) errors.vigencia = 'Escribe el año de vigencia que aparece en la INE (4 dígitos).';
  else if (vigencia < ELECCION.anio) errors.vigencia = `Esta INE vence en ${vigencia}: no sirve para votar el ${ELECCION.texto}. Se requiere vigencia ${ELECCION.anio} o posterior.`;

  const seccion = Number(String(body.seccion || '').trim());
  if (!Number.isInteger(seccion) || seccion <= 0) errors.seccion = 'Escribe la sección que aparece en la INE.';
  else if (seccion !== ctx.seccion) errors.seccion = `Solo puedes capturar promovidos de la sección ${fmtSeccion(ctx.seccion)}. Esta INE es de la sección ${fmtSeccion(seccion)}.`;

  const paterno = upper(body.paterno);
  const materno = upper(body.materno);
  const nombres = upper(body.nombres);
  if (paterno.length < 2) errors.paterno = 'Escribe el apellido paterno.';
  if (nombres.length < 2) errors.nombres = 'Escribe el nombre o nombres.';

  const telefono = String(body.telefono || '').replace(/\D/g, '');
  if (telefono.length !== 10) errors.telefono = 'Escribe el teléfono (WhatsApp) de 10 dígitos.';

  const claveElector = upper(body.claveElector).replace(/\s/g, '');
  const curp = upper(body.curp).replace(/\s/g, '');
  if (!CLAVE_ELECTOR_RE.test(claveElector)) errors.claveElector = 'La clave de elector tiene 18 caracteres: 6 letras, 8 números, H/M y 3 números.';
  if (!CURP_RE.test(curp)) errors.curp = 'La CURP no es válida (18 caracteres).';

  const cp = String(body.cp || '').trim();
  const cpInfo = await buscaCP(cp);
  if (!cpInfo) errors.cp = 'Escribe un código postal válido de 5 dígitos.';
  const localidad = upper(body.localidad);
  if (cpInfo && localidad.length < 2) errors.localidad = 'Elige o escribe la localidad.';
  const calle = upper(body.calle);
  const numExt = upper(body.numExt);
  if (calle.length < 2) errors.calle = 'Escribe la calle.';
  if (!numExt) errors.numExt = 'Escribe el número exterior (o S/N).';

  // Aviso de privacidad: al capturar, la persona debe conocerlo y consentir el tratamiento de sus datos
  if (!excluirId && body.consentimiento !== true) errors.consentimiento = 'Confirma que la persona conoce el aviso de privacidad y da su consentimiento.';

  if (Object.keys(errors).length) throw new PromovidoError('Revisa los datos marcados', 422, errors);

  // Duplicados: una persona solo una vez en todo el sistema
  const dup = await query(
    'SELECT clave_elector, curp FROM promovidos WHERE (clave_elector = $1 OR curp = $2) AND id IS DISTINCT FROM $3 LIMIT 1',
    [claveElector, curp, excluirId]
  );
  if (dup.rows.length) {
    const f = {};
    if (dup.rows[0].clave_elector === claveElector) f.claveElector = 'Esta clave de elector ya está registrada como promovido.';
    if (dup.rows[0].curp === curp) f.curp = 'Esta CURP ya está registrada como promovido.';
    throw new PromovidoError('Esta persona ya está registrada como promovido.', 409, f);
  }

  return {
    ctx,
    // Se guardan en WebP de 1100 px (≈3 veces menos espacio que el JPEG que envía el teléfono)
    fotos: { frente: await comprimir(frente.buf), reverso: await comprimir(reverso.buf) },
    data: {
      ...(excluirId ? {} : { consentimiento: { version: privacidad.aviso().version, at: new Date().toISOString() } }),
      vigencia,
      paterno,
      materno,
      nombres,
      telefono,
      domicilio: {
        cp: cpInfo.cp,
        calle,
        numExt,
        numInt: upper(body.numInt),
        fracc: upper(body.fracc),
        localidad,
        municipio: cpInfo.municipio,
        estado: cpInfo.estado,
      },
    },
    claveElector,
    curp,
    seccion,
  };
}

// Capturas hechas sin internet: cada una trae un identificador del teléfono (clientId). Si el envío
// se repite (p. ej. se cortó la señal después de guardarse), se responde con el registro ya creado.
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function crear(promotor, body) {
  const clientId = CLIENT_ID_RE.test(String(body.clientId || '')) ? String(body.clientId).toLowerCase() : null;
  if (clientId) {
    const { rows } = await query(
      "SELECT id, data, seccion, estatus, created_at FROM promovidos WHERE promotor_id = $1 AND data->>'clientId' = $2",
      [promotor.id, clientId]
    );
    if (rows[0]) {
      const r = rows[0];
      return { id: r.id, nombre: nombreCompleto(r.data), seccion: r.seccion, estatus: r.estatus, createdAt: r.created_at.toISOString(), repetido: true };
    }
  }
  const v = await validar(promotor, body);
  if (clientId) v.data.clientId = clientId;
  // Fecha real de la captura en el teléfono (si fue sin internet), sin aceptar fechas futuras ni muy viejas
  const capturado = Date.parse(body.capturadoAt || '');
  if (clientId && capturado && capturado <= Date.now() && Date.now() - capturado < 60 * 86400000) v.data.capturadoAt = new Date(capturado).toISOString();
  const id = crypto.randomUUID();
  let createdAt;
  try {
    await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO promovidos (id, promotor_id, responsable_id, seccion, data, clave_elector, curp)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at`,
        [id, promotor.id, v.ctx.responsable.id, v.seccion, v.data, v.claveElector, v.curp]
      );
      createdAt = r.rows[0].created_at.toISOString();
      await c.query('INSERT INTO promovido_ine (promovido_id, lado, image) VALUES ($1, $2, $3), ($1, $4, $5)', [
        id,
        'frente',
        v.fotos.frente,
        'reverso',
        v.fotos.reverso,
      ]);
      await c.query('INSERT INTO promovido_historial (promovido_id, user_id, user_name, accion) VALUES ($1, $2, $3, $4)', [
        id,
        promotor.id,
        promotor.name,
        'creado',
      ]);
    });
  } catch (err) {
    if (err.code === '23505') throw new PromovidoError('Esta persona ya está registrada como promovido.', 409);
    throw err;
  }
  cachePromovidos.remember({ id, promotorId: promotor.id, responsableId: v.ctx.responsable.id, seccion: v.seccion, estatus: 'en_revision', createdAt });
  await notificar([v.ctx.responsable.id], {
    tipo: 'promovido.nuevo',
    titulo: `Nuevo promovido por revisar: ${nombreCompleto(v.data)}`,
    cuerpo: `Capturado por ${promotor.name} · Sección ${fmtSeccion(v.seccion)}`,
    url: `/promovidos/${id}`,
    autorId: promotor.id,
  });
  return { id, nombre: nombreCompleto(v.data), seccion: v.seccion, estatus: 'en_revision', createdAt };
}

const nombreCompleto = (d) => [d.nombres, d.paterno, d.materno].filter(Boolean).join(' ');

// Lista del promotor (sin fotos ni datos sensibles completos)
async function listaDe(promotor) {
  // Observaciones del Responsable de Sección (las del propio promotor no cuentan)
  const { rows } = await query(
    `SELECT p.id, p.seccion, p.data, p.clave_elector, p.estatus, p.created_at,
            EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id AND o.at > COALESCE((SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id AND h.user_id = p.promotor_id AND h.accion = 'editado'), '-infinity'::timestamptz)) AS con_obs,
            GREATEST(p.created_at, (SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id)) AS modificado
     FROM promovidos p WHERE p.promotor_id = $1 ORDER BY p.created_at DESC`,
    [promotor.id]
  );
  return rows.map((r) => ({
    id: r.id,
    nombre: nombreCompleto(r.data),
    seccion: r.seccion,
    claveElector: `${r.clave_elector.slice(0, 4)}••••••••••${r.clave_elector.slice(-4)}`,
    localidad: r.data.domicilio?.localidad || '',
    vigencia: r.data.vigencia,
    estatus: r.estatus,
    conObservaciones: r.con_obs,
    iniciales: `${(r.data.nombres || '?')[0]}${(r.data.paterno || '')[0] || ''}`,
    telefono: r.data.telefono || '',
    modificado: r.modificado.toISOString(),
    createdAt: r.created_at.toISOString(),
  }));
}

const contarDeResponsable = (respId) => cachePromovidos.all().filter((p) => p.responsableId === respId).length;

// ¿Puede `viewer` ver el promovido (y sus fotos de INE)? El promotor que lo capturó y su rama
// hacia arriba: Responsable de Sección, Coordinador de Zona y CPV. El super administrador no.
function puedeVer(viewer, promotorId) {
  if (!viewer || viewer.role === 'superadmin') return false;
  const promotor = users.get(promotorId);
  if (!promotor) return false;
  return chainOf(promotor, users.all()).some((u) => u.id === viewer.id);
}

async function detalle(viewer, id) {
  const { rows } = await query(
    `SELECT p.id, p.promotor_id, p.responsable_id, p.seccion, p.data, p.clave_elector, p.curp, p.estatus, p.revisado_por, p.revisado_at, p.created_at,
            EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id AND o.at > COALESCE((SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id AND h.user_id = p.promotor_id AND h.accion = 'editado'), '-infinity'::timestamptz)) AS con_obs
     FROM promovidos p WHERE p.id = $1`,
    [id]
  );
  const r = rows[0];
  if (!r || !puedeVer(viewer, r.promotor_id)) return null;
  return {
    id: r.id,
    nombre: nombreCompleto(r.data),
    paterno: r.data.paterno,
    materno: r.data.materno,
    nombres: r.data.nombres,
    claveElector: r.clave_elector,
    curp: r.curp,
    vigencia: r.data.vigencia,
    seccion: r.seccion,
    telefono: r.data.telefono || '',
    domicilio: r.data.domicilio,
    promotor: users.get(r.promotor_id)?.name || null,
    estatus: r.estatus,
    conObservaciones: r.con_obs,
    revisadoPor: r.revisado_por ? users.get(r.revisado_por)?.name || null : null,
    revisadoAt: r.revisado_at ? r.revisado_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    puedeEditar: puedeEditar(viewer, r),
    bloqueadoPorAprobacion: esDeSuEquipo(viewer, r) && !puedeEditar(viewer, r),
    // Para editar: sección permitida (la del Responsable de Sección del promotor) y vigencia mínima
    seccionPermitida: (users.get(r.promotor_id) && contexto(users.get(r.promotor_id))?.seccion) ?? r.seccion,
    vigenciaMin: ELECCION.anio,
    eleccion: ELECCION.texto,
    puedeObservar: esDeSuEquipo(viewer, r),
    // Solo su Responsable de Sección directo aprueba o rechaza (lo aprobado ya no se revisa)
    puedeRevisar: Boolean(viewer) && viewer.id === r.responsable_id && r.estatus !== 'validado',
  };
}

async function foto(viewer, id, lado) {
  if (!['frente', 'reverso'].includes(lado)) return null;
  const { rows } = await query(
    'SELECT p.promotor_id, i.image FROM promovidos p JOIN promovido_ine i ON i.promovido_id = p.id WHERE p.id = $1 AND i.lado = $2',
    [id, lado]
  );
  const r = rows[0];
  if (!r || !puedeVer(viewer, r.promotor_id)) return null;
  return r.image;
}

// Promotor que lo capturó o su Responsable de Sección directo: editan y conversan
const esDeSuEquipo = (viewer, row) => Boolean(viewer) && (viewer.id === row.promotor_id || viewer.id === row.responsable_id);
// Ya aprobado, el promotor no puede modificarlo; su Responsable de Sección sí (vuelve a revisión)
const puedeEditar = (viewer, row) => esDeSuEquipo(viewer, row) && (row.estatus !== 'validado' || viewer.id === row.responsable_id);

async function filaEditable(viewer, id) {
  const { rows } = await query('SELECT * FROM promovidos WHERE id = $1', [id]);
  const r = rows[0];
  if (!r || !esDeSuEquipo(viewer, r)) throw new PromovidoError('Promovido no encontrado', 404);
  return r;
}

const ESTATUS_TEXTO = { en_revision: 'En revisión', validado: 'Aprobado', rechazado: 'Rechazado' };

// Campos comparables (etiqueta → valor) de un registro, para el historial
function plano(data, clave, curp, seccion) {
  const d = data.domicilio || {};
  return [
    ['Vigencia', data.vigencia],
    ['Sección', fmtSeccion(seccion)],
    ['Apellido paterno', data.paterno],
    ['Apellido materno', data.materno],
    ['Nombre(s)', data.nombres],
    ['Clave de elector', clave],
    ['CURP', curp],
    ['Teléfono (WhatsApp)', data.telefono],
    ['Código postal', d.cp],
    ['Localidad', d.localidad],
    ['Municipio', d.municipio],
    ['Estado', d.estado],
    ['Calle', d.calle],
    ['No. Ext.', d.numExt],
    ['No. Int.', d.numInt],
    ['Fracc.', d.fracc],
  ].map(([campo, v]) => [campo, v === undefined || v === null ? '' : String(v)]);
}

async function actualizar(viewer, id, body) {
  const actual = await filaEditable(viewer, id);
  if (!puedeEditar(viewer, actual)) {
    throw new PromovidoError('Este promovido ya fue aprobado: solo su Responsable de Sección puede modificarlo.', 403);
  }
  const promotor = users.get(actual.promotor_id);
  if (!promotor) throw new PromovidoError('El promotor de este registro ya no existe.', 409);
  const v = await validar(promotor, body, { excluirId: id });

  const antes = new Map(plano(actual.data, actual.clave_elector, actual.curp, actual.seccion));
  const cambios = plano(v.data, v.claveElector, v.curp, v.seccion)
    .filter(([campo, nuevo]) => antes.get(campo) !== nuevo)
    .map(([campo, nuevo]) => ({ campo, antes: antes.get(campo), despues: nuevo }));
  if (v.fotos.frente) cambios.push({ campo: 'Foto INE (frente)', antes: '', despues: 'Reemplazada' });
  if (v.fotos.reverso) cambios.push({ campo: 'Foto INE (reverso)', antes: '', despues: 'Reemplazada' });
  if (!cambios.length) return { id, cambios: 0 };

  // Si ya estaba revisado, el cambio lo regresa a revisión
  const regresa = actual.estatus !== 'en_revision';
  if (regresa) cambios.push({ campo: 'Estatus', antes: ESTATUS_TEXTO[actual.estatus], despues: ESTATUS_TEXTO.en_revision });

  try {
    await tx(async (c) => {
      await c.query(
        `UPDATE promovidos SET data = $2, clave_elector = $3, curp = $4, seccion = $5
           ${regresa ? ", estatus = 'en_revision', revisado_por = NULL, revisado_at = NULL" : ''}
         WHERE id = $1`,
        [id, v.data, v.claveElector, v.curp, v.seccion]
      );
      for (const [lado, buf] of [
        ['frente', v.fotos.frente],
        ['reverso', v.fotos.reverso],
      ]) {
        if (buf) await c.query('UPDATE promovido_ine SET image = $3 WHERE promovido_id = $1 AND lado = $2', [id, lado, buf]);
      }
      await c.query('INSERT INTO promovido_historial (promovido_id, user_id, user_name, accion, cambios) VALUES ($1, $2, $3, $4, $5)', [
        id,
        viewer.id,
        viewer.name,
        'editado',
        JSON.stringify(cambios),
      ]);
    });
  } catch (err) {
    if (err.code === '23505') throw new PromovidoError('Esta persona ya está registrada como promovido.', 409);
    throw err;
  }
  if (regresa) {
    const enCache = cachePromovidos.all().find((p) => p.id === id);
    if (enCache) enCache.estatus = 'en_revision';
  }
  // Avisa a la otra parte del equipo (promotor ↔ responsable)
  await notificar([actual.promotor_id, actual.responsable_id], {
    tipo: 'promovido.editado',
    titulo: `${viewer.name} modificó a ${nombreCompleto(v.data)}`,
    cuerpo: `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'}${regresa ? ' · regresó a revisión' : ''}`,
    url: `/promovidos/${id}`,
    autorId: viewer.id,
  });
  return { id, cambios: cambios.length };
}

// Historial: visible para quien puede ver la ficha
async function historial(viewer, id) {
  const { rows } = await query('SELECT promotor_id FROM promovidos WHERE id = $1', [id]);
  if (!rows[0] || !puedeVer(viewer, rows[0].promotor_id)) return null;
  const h = await query('SELECT user_name, accion, cambios, at FROM promovido_historial WHERE promovido_id = $1 ORDER BY at DESC, id DESC', [id]);
  return h.rows.map((r) => ({ autor: r.user_name, accion: r.accion, cambios: r.cambios, at: r.at.toISOString() }));
}

// Observaciones: solo el promotor que lo capturó y su Responsable de Sección
async function observaciones(viewer, id) {
  await filaEditable(viewer, id);
  const { rows } = await query('SELECT id, user_id, user_name, texto, at FROM promovido_observaciones WHERE promovido_id = $1 ORDER BY at, id', [id]);
  return rows.map((r) => ({ id: String(r.id), autor: r.user_name, propia: r.user_id === viewer.id, texto: r.texto, at: r.at.toISOString() }));
}

async function observar(viewer, id, texto) {
  const fila = await filaEditable(viewer, id);
  const t = String(texto || '').trim().slice(0, 1000);
  if (!t) throw new PromovidoError('Escribe la observación.', 422, { texto: 'Escribe la observación.' });
  const { rows } = await query(
    'INSERT INTO promovido_observaciones (promovido_id, user_id, user_name, texto) VALUES ($1, $2, $3, $4) RETURNING id, at',
    [id, viewer.id, viewer.name, t]
  );
  await notificar([fila.promotor_id, fila.responsable_id], {
    tipo: 'promovido.observacion',
    titulo: `${viewer.name} dejó una observación sobre ${nombreCompleto(fila.data)}`,
    cuerpo: t.length > 140 ? `${t.slice(0, 139)}…` : t,
    url: `/promovidos/${id}`,
    autorId: viewer.id,
  });
  return { id: String(rows[0].id), autor: viewer.name, propia: true, texto: t, at: rows[0].at.toISOString() };
}

// ===========================================================================
// Revisión: el Responsable de Sección directo aprueba o rechaza lo que capturan sus promotores
// ===========================================================================
async function siguientePendiente(rsId, excluir = null) {
  const { rows } = await query(
    "SELECT id FROM promovidos WHERE responsable_id = $1 AND estatus = 'en_revision' AND id IS DISTINCT FROM $2 ORDER BY created_at LIMIT 1",
    [rsId, excluir]
  );
  return rows[0]?.id || null;
}

async function revisar(viewer, id, body = {}) {
  const row = await filaEditable(viewer, id);
  if (viewer.id !== row.responsable_id) throw new PromovidoError('Solo el Responsable de Sección del promotor puede aprobar o rechazar.', 403);
  const accion = String(body.accion || '');
  if (!['aprobar', 'rechazar'].includes(accion)) throw new PromovidoError('Acción no válida.', 422);
  if (row.estatus === 'validado') throw new PromovidoError('Este promovido ya fue aprobado.', 409);
  const nuevo = accion === 'aprobar' ? 'validado' : 'rechazado';
  if (row.estatus === nuevo) throw new PromovidoError('Este promovido ya fue rechazado.', 409);
  const motivo = String(body.motivo || '').trim().slice(0, 500);
  if (accion === 'rechazar' && motivo.length < 5) {
    throw new PromovidoError('Escribe el motivo del rechazo para que el promotor pueda corregirlo.', 422, { motivo: 'Escribe el motivo del rechazo.' });
  }
  await tx(async (c) => {
    await c.query('UPDATE promovidos SET estatus = $2, revisado_por = $3, revisado_at = now() WHERE id = $1', [id, nuevo, viewer.id]);
    await c.query('INSERT INTO promovido_historial (promovido_id, user_id, user_name, accion, cambios) VALUES ($1, $2, $3, $4, $5)', [
      id,
      viewer.id,
      viewer.name,
      'editado',
      JSON.stringify([{ campo: 'Estatus', antes: ESTATUS_TEXTO[row.estatus], despues: ESTATUS_TEXTO[nuevo] }]),
    ]);
    // El motivo (o el comentario al aprobar) queda en las observaciones para el promotor
    if (motivo) {
      await c.query('INSERT INTO promovido_observaciones (promovido_id, user_id, user_name, texto) VALUES ($1, $2, $3, $4)', [
        id,
        viewer.id,
        viewer.name,
        accion === 'rechazar' ? `Rechazado: ${motivo}` : motivo,
      ]);
    }
  });
  const enCache = cachePromovidos.all().find((p) => p.id === id);
  if (enCache) enCache.estatus = nuevo;
  const nombre = nombreCompleto(row.data);
  await notificar([row.promotor_id], {
    tipo: accion === 'aprobar' ? 'promovido.aprobado' : 'promovido.rechazado',
    titulo: accion === 'aprobar' ? `${nombre} fue aprobado` : `${nombre} fue rechazado`,
    cuerpo: accion === 'aprobar' ? `Lo aprobó ${viewer.name}.` : `Motivo: ${motivo}`,
    url: `/promovidos/${id}`,
    autorId: viewer.id,
  });
  return { id, estatus: nuevo, siguiente: await siguientePendiente(viewer.id, id) };
}

// Bandeja del Responsable de Sección: todo lo que capturaron sus promotores
async function bandeja(rs) {
  const { rows } = await query(
    `SELECT p.id, p.promotor_id, p.data, p.estatus, p.created_at,
            EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id AND o.at > COALESCE((SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id AND h.user_id = p.promotor_id AND h.accion = 'editado'), '-infinity'::timestamptz)) AS con_obs,
            GREATEST(p.created_at, (SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id)) AS modificado
     FROM promovidos p WHERE p.responsable_id = $1 ORDER BY p.created_at`,
    [rs.id]
  );
  return rows.map((r) => ({
    id: r.id,
    nombre: nombreCompleto(r.data),
    iniciales: `${(r.data.nombres || '?')[0]}${(r.data.paterno || '')[0] || ''}`,
    promotorId: r.promotor_id,
    promotor: users.get(r.promotor_id)?.name || 'Promotor eliminado',
    estatus: r.estatus,
    conObservaciones: r.con_obs,
    createdAt: r.created_at.toISOString(),
    modificado: r.modificado.toISOString(),
  }));
}

module.exports = {
  CLAVE_ELECTOR_RE,
  CURP_RE,
  catalogoCP,
  revisar,
  bandeja,
  siguientePendiente,
  PromovidoError,
  ELECCION,
  buscaCP,
  contexto,
  crear,
  listaDe,
  contarDeResponsable,
  puedeVer,
  detalle,
  foto,
  actualizar,
  historial,
  observaciones,
  observar,
};
