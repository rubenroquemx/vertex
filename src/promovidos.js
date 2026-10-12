// Captura de promovidos por el Promotor Territorial.
// Reglas:
//  - Solo de la sección asignada al Responsable de Sección del que depende el promotor
//    (la sección impresa en la INE debe coincidir).
//  - La INE debe servir para votar en la elección: vigencia igual o mayor al año de la jornada.
//  - Las fotos de la INE solo las ve la rama del promotor hasta el CPV.
//  - Todo promovido entra «En revisión»; lo valida su Responsable de Sección directo.
//  - Una persona solo puede promoverse una vez (clave de elector y CURP únicas).
//  - Estado y municipio se toman del catálogo de SEPOMEX a partir del CP (no del navegador).
const crypto = require('crypto');
const { query, tx } = require('./db');
const { users, promovidos: cachePromovidos } = require('./store');
const geo = require('./geo');
const { chainOf } = require('./access');

// Jornada electoral: la INE debe estar vigente ese año para poder votar
const ELECCION = { anio: 2027, texto: '6 de junio de 2027' };

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

async function validar(promotor, body) {
  const ctx = contexto(promotor);
  if (!ctx) throw new PromovidoError('Tu Responsable de Sección aún no tiene sección asignada; no puedes capturar promovidos.', 409);
  const errors = {};

  const frente = fotoValida(body.ineFrente);
  const reverso = fotoValida(body.ineReverso);
  if (frente.error) errors.ineFrente = frente.error;
  if (reverso.error) errors.ineReverso = reverso.error;

  const vigencia = Number(String(body.vigencia || '').trim());
  if (!Number.isInteger(vigencia) || vigencia < 2000 || vigencia > ELECCION.anio + 12) errors.vigencia = 'Escribe el año de vigencia que aparece en la INE (4 dígitos).';
  else if (vigencia < ELECCION.anio) errors.vigencia = `Esta INE vence en ${vigencia}: no sirve para votar el ${ELECCION.texto}. Se requiere vigencia ${ELECCION.anio} o posterior.`;

  const seccion = Number(String(body.seccion || '').trim());
  if (!Number.isInteger(seccion) || seccion <= 0) errors.seccion = 'Escribe la sección que aparece en la INE.';
  else if (seccion !== ctx.seccion) errors.seccion = `Solo puedes capturar promovidos de la sección ${ctx.seccion}. Esta INE es de la sección ${seccion}.`;

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

  if (Object.keys(errors).length) throw new PromovidoError('Revisa los datos marcados', 422, errors);

  // Duplicados: una persona solo una vez en todo el sistema
  const dup = await query('SELECT clave_elector, curp FROM promovidos WHERE clave_elector = $1 OR curp = $2 LIMIT 1', [claveElector, curp]);
  if (dup.rows.length) {
    const f = {};
    if (dup.rows[0].clave_elector === claveElector) f.claveElector = 'Esta clave de elector ya está registrada como promovido.';
    if (dup.rows[0].curp === curp) f.curp = 'Esta CURP ya está registrada como promovido.';
    throw new PromovidoError('Esta persona ya está registrada como promovido.', 409, f);
  }

  return {
    ctx,
    fotos: { frente: frente.buf, reverso: reverso.buf },
    data: {
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

async function crear(promotor, body) {
  const v = await validar(promotor, body);
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
    });
  } catch (err) {
    if (err.code === '23505') throw new PromovidoError('Esta persona ya está registrada como promovido.', 409);
    throw err;
  }
  cachePromovidos.remember({ id, promotorId: promotor.id, responsableId: v.ctx.responsable.id, seccion: v.seccion, estatus: 'en_revision', createdAt });
  return { id, nombre: nombreCompleto(v.data), seccion: v.seccion, estatus: 'en_revision', createdAt };
}

const nombreCompleto = (d) => [d.nombres, d.paterno, d.materno].filter(Boolean).join(' ');

// Lista del promotor (sin fotos ni datos sensibles completos)
async function listaDe(promotor) {
  const { rows } = await query(
    'SELECT id, seccion, data, clave_elector, estatus, created_at FROM promovidos WHERE promotor_id = $1 ORDER BY created_at DESC',
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
    'SELECT id, promotor_id, seccion, data, clave_elector, curp, estatus, revisado_por, revisado_at, created_at FROM promovidos WHERE id = $1',
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
    revisadoPor: r.revisado_por ? users.get(r.revisado_por)?.name || null : null,
    revisadoAt: r.revisado_at ? r.revisado_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
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

module.exports = { PromovidoError, ELECCION, buscaCP, contexto, crear, listaDe, contarDeResponsable, puedeVer, detalle, foto };
