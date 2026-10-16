// Agenda: asambleas y recorridos.
// El Responsable de Sección propone → su Coordinador de Zona revisa y lo pasa (o lo regresa) → el CPV lo
// programa con fecha y hora (o lo regresa / rechaza). En el camino todos pueden ajustar y dejar observaciones.
// Ya programado, aparece en la agenda de toda la rama (CPV, zona, responsable y sus promotores).
// El Responsable reporta el mismo día; después se acepta, pero queda marcado como tardío.
const crypto = require('crypto');
const { query, tx } = require('./db');
const { users } = require('./store');
const fotosLib = require('./fotos');
const { notificar } = require('./notificaciones');
const listas = require('./listas');
const cotejo = require('./cotejo');

const TZ = 'America/Mexico_City';
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const FMT_CORTO = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const hoyKey = () => FMT_DIA.format(new Date());
const diaDe = (d) => FMT_DIA.format(d);

const MAX_FOTOS_LUGAR = 5;
const MAX_FOTOS_TESTIMONIO = 10;
const NECESIDADES = ['Planta de luz', 'Iluminación', 'Sonido', 'Templete', 'Sillas', 'Mesas', 'Carpa o toldo', 'Pantalla', 'Transporte'];
const TIPO = { asamblea: 'Asamblea', recorrido: 'Recorrido' };
const ESTADO = {
  revision_zona: 'Con el Coordinador de Zona',
  revision_cpv: 'Con el CPV',
  ajustes: 'Requiere ajustes',
  programado: 'Programado',
  realizado: 'Realizado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
};
const EDITABLE = new Set(['revision_zona', 'ajustes', 'revision_cpv']);
// Límites de México (para descartar coordenadas sin sentido)
const enMexico = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 14 && lat < 33 && lng > -118.5 && lng < -86;

class EventoError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const seccionTxt = (s) => (s === null || s === undefined ? '' : String(s).padStart(4, '0'));
const titulo = (e) => `${TIPO[e.tipo]} · ${e.lugar}`;
const url = (id) => `/agenda/eventos/${id}`;

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
function rolEn(viewer, e) {
  if (viewer.id === e.rs_id) return 'rs';
  if (viewer.id === e.zona_id) return 'zona';
  if (viewer.id === e.cpv_id) return 'cpv';
  if (viewer.role === 'superadmin') return 'sa';
  // Los promotores del responsable solo ven lo ya programado
  if (viewer.role === 'promotor' && viewer.parentId === e.rs_id && (e.estado === 'programado' || e.estado === 'realizado')) return 'promotor';
  return null;
}
const participa = (rol) => rol === 'rs' || rol === 'zona' || rol === 'cpv';

async function fila(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await query('SELECT * FROM eventos WHERE id = $1', [id]);
  return rows[0] || null;
}
async function cargar(viewer, id) {
  const e = await fila(id);
  const rol = e && rolEn(viewer, e);
  if (!rol) throw new EventoError('Evento no encontrado', 404);
  return { e, rol };
}

// Quién debe actuar ahora (para resaltarlo en las listas)
function turnoDe(e, rol) {
  if (rol === 'zona' && e.estado === 'revision_zona') return 'Revisar y pasar al CPV';
  if (rol === 'cpv' && e.estado === 'revision_cpv') return 'Programar';
  if (rol === 'rs' && e.estado === 'ajustes') return 'Ajustar y reenviar';
  if (rol === 'rs' && e.estado === 'programado' && e.inicio && hoyKey() >= diaDe(e.inicio)) return 'Reportar';
  return null;
}

// Toda la rama del evento (para la agenda y los avisos de programación)
function rama(e) {
  const promotores = users.all().filter((u) => u.parentId === e.rs_id && u.role === 'promotor').map((u) => u.id);
  return [e.rs_id, e.zona_id, e.cpv_id, ...promotores].filter(Boolean);
}
const involucrados = (e) => [e.rs_id, e.zona_id, e.cpv_id].filter(Boolean);

// ---------------------------------------------------------------------------
// Validación de la propuesta
// ---------------------------------------------------------------------------
function fotoValida(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  return buf && buf.length > 1000 && buf.length < 6 * 1024 * 1024 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
}

function km(trazo) {
  let t = 0;
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  for (let i = 1; i < trazo.length; i++) {
    const [a1, o1] = trazo[i - 1];
    const [a2, o2] = trazo[i];
    const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
    t += 2 * R * Math.asin(Math.sqrt(h));
  }
  return Math.round(t * 100) / 100;
}

function limpiarRuta(r) {
  const par = (p) => (Array.isArray(p) && p.length === 2 ? [Number(p[0]), Number(p[1])] : null);
  const puntos = Array.isArray(r?.puntos) ? r.puntos.slice(0, 101).map(par) : [];
  const trazo = Array.isArray(r?.trazo) ? r.trazo.slice(0, 20001).map(par) : [];
  if (puntos.length < 2 || puntos.length > 100 || puntos.some((p) => !p || !enMexico(p[0], p[1]))) return null;
  if (trazo.length < 2 || trazo.length > 20000 || trazo.some((p) => !p || !enMexico(p[0], p[1]))) return null;
  const redondear = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
  const t = trazo.map(redondear);
  return { puntos: puntos.map(redondear), trazo: t, km: km(t), calles: Boolean(r.calles) };
}

function validar(tipo, body, { parcial = false } = {}) {
  const f = {};
  const d = {};
  const lugar = String(body.lugar ?? '').trim().replace(/\s+/g, ' ');
  if (!lugar) f.lugar = tipo === 'asamblea' ? 'Escribe el lugar de la asamblea.' : 'Escribe la comunidad o colonia del recorrido.';
  else if (lugar.length > 160) f.lugar = 'Máximo 160 caracteres.';
  d.lugar = lugar;
  if (tipo === 'asamblea') {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!enMexico(lat, lng)) f.ubicacion = 'Marca en el mapa dónde será la asamblea.';
    d.lat = lat;
    d.lng = lng;
  } else {
    const ruta = limpiarRuta(body.ruta);
    if (!ruta) f.ruta = 'Traza la ruta del recorrido en el mapa (mínimo dos puntos).';
    d.ruta = ruta;
  }
  const fecha = String(body.fechaTentativa || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || FMT_DIA.format(new Date(`${fecha}T12:00:00Z`)) !== fecha) f.fechaTentativa = 'Elige la fecha tentativa.';
  else if (!parcial && fecha < hoyKey()) f.fechaTentativa = 'La fecha tentativa no puede ser pasada.';
  d.fechaTentativa = fecha;
  const asis = Number(String(body.asistentes ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(asis) || asis < 1 || asis > 200000)
    f.asistentes = tipo === 'asamblea' ? 'Escribe cuántos asistentes esperas (número entero).' : 'Escribe cuántas personas acompañarán al candidato.';
  d.asistentes = asis;
  const nec = Array.isArray(body.necesidades) ? body.necesidades : [];
  d.necesidades = [...new Set(nec.map((x) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
  d.notas = String(body.notas ?? '').trim().slice(0, 2000);
  return { f, d };
}

// ---------------------------------------------------------------------------
// Historial, observaciones y fotos
// ---------------------------------------------------------------------------
async function historial(c, e, viewer, accion, detalle = '', cambios = []) {
  await c.query('INSERT INTO evento_historial (evento_id, user_id, user_name, accion, detalle, cambios) VALUES ($1, $2, $3, $4, $5, $6)', [
    e.id,
    viewer.id,
    viewer.name,
    accion,
    detalle,
    JSON.stringify(cambios),
  ]);
}
async function observar(c, e, viewer, texto) {
  await c.query('INSERT INTO evento_observaciones (evento_id, user_id, user_name, texto) VALUES ($1, $2, $3, $4)', [e.id, viewer.id, viewer.name, texto]);
}

async function guardarFotos(c, eventoId, bufs, clase) {
  const comprimidas = await Promise.all(bufs.map((b) => fotosLib.comprimir(b, fotosLib.EVIDENCIA)));
  for (const b of comprimidas) await c.query('INSERT INTO evento_fotos (evento_id, clase, image) VALUES ($1, $2, $3)', [eventoId, clase, b]);
}

function fotosDe(lista, max) {
  const arr = Array.isArray(lista) ? lista : [];
  if (arr.length > max) throw new EventoError(`Máximo ${max} fotos.`, 422, { fotos: `Máximo ${max} fotos.` });
  const bufs = arr.map(fotoValida);
  if (bufs.some((b) => !b)) throw new EventoError('Alguna foto no es válida.', 422, { fotos: 'Alguna foto no es válida; vuelve a elegirla.' });
  return bufs;
}

// ---------------------------------------------------------------------------
// Proponer (Responsable de Sección)
// ---------------------------------------------------------------------------
async function crear(rs, body) {
  if (rs.role !== 'resp_seccion') throw new EventoError('Solo el Responsable de Sección propone asambleas y recorridos.', 403);
  const tipo = body.tipo === 'recorrido' ? 'recorrido' : body.tipo === 'asamblea' ? 'asamblea' : null;
  if (!tipo) throw new EventoError('Tipo de evento no válido.', 422);
  const zona = users.get(rs.parentId);
  const cpv = zona ? users.get(zona.parentId) : null;
  if (!zona || !cpv) throw new EventoError('Tu cuenta no tiene Coordinador de Zona o CPV asignado.', 409);
  const { f, d } = validar(tipo, body);
  const bufs = fotosDe(body.fotos, MAX_FOTOS_LUGAR);
  if (Object.keys(f).length) throw new EventoError('Revisa los datos marcados.', 422, f);
  const id = crypto.randomUUID();
  const e = { id, tipo, rs_id: rs.id, zona_id: zona.id, cpv_id: cpv.id, lugar: d.lugar };
  await tx(async (c) => {
    await c.query(
      `INSERT INTO eventos (id, tipo, rs_id, zona_id, cpv_id, seccion, lugar, lat, lng, ruta, fecha_tentativa, asistentes, necesidades, notas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        tipo,
        rs.id,
        zona.id,
        cpv.id,
        rs.territorio?.secciones?.[0] ?? null,
        d.lugar,
        tipo === 'asamblea' ? d.lat : null,
        tipo === 'asamblea' ? d.lng : null,
        tipo === 'recorrido' ? JSON.stringify(d.ruta) : null,
        d.fechaTentativa,
        d.asistentes,
        JSON.stringify(d.necesidades),
        d.notas,
      ]
    );
    await guardarFotos(c, id, bufs, 'lugar');
    await historial(c, e, rs, 'propuesto', 'Propuesta enviada al Coordinador de Zona.');
  });
  await notificar([zona.id], {
    tipo: 'evento.propuesto',
    titulo: `${rs.name} propone ${tipo === 'asamblea' ? 'una asamblea' : 'un recorrido'}`,
    cuerpo: `${d.lugar} · sección ${seccionTxt(rs.territorio?.secciones?.[0])}. Revísalo y pásalo al CPV.`,
    url: url(id),
    autorId: rs.id,
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Ajustar datos (los tres involucrados, mientras no esté programado)
// ---------------------------------------------------------------------------
const CAMPOS = [
  { k: 'lugar', t: 'Lugar' },
  { k: 'fecha_tentativa', t: 'Fecha tentativa', d: 'fechaTentativa' },
  { k: 'asistentes', t: 'Asistentes tentativos' },
  { k: 'notas', t: 'Notas' },
];
const txtNec = (a) => (a || []).join(', ');
const fechaTxt = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || ''));

async function editar(viewer, id, body) {
  const { e, rol } = await cargar(viewer, id);
  if (!participa(rol)) throw new EventoError('No puedes modificar este evento.', 403);
  if (!EDITABLE.has(e.estado)) throw new EventoError('Ya no se puede modificar: el evento está ' + ESTADO[e.estado].toLowerCase() + '.', 409);
  const { f, d } = validar(e.tipo, body, { parcial: true });
  const nuevas = fotosDe(body.fotosNuevas, MAX_FOTOS_LUGAR);
  const quitar = (Array.isArray(body.fotosQuitar) ? body.fotosQuitar : []).map(Number).filter(Number.isInteger);
  const ya = (await query("SELECT id FROM evento_fotos WHERE evento_id = $1 AND clase = 'lugar'", [id])).rows.map((r) => Number(r.id));
  const quedan = ya.filter((x) => !quitar.includes(x)).length + nuevas.length;
  if (quedan > MAX_FOTOS_LUGAR) f.fotos = `Máximo ${MAX_FOTOS_LUGAR} fotos del lugar (quedarían ${quedan}).`;
  if (Object.keys(f).length) throw new EventoError('Revisa los datos marcados.', 422, f);

  const cambios = [];
  for (const c of CAMPOS) {
    const antes = c.k === 'fecha_tentativa' ? fechaTxt(e[c.k]) : String(e[c.k] ?? '');
    const despues = String(d[c.d || c.k] ?? '');
    if (antes !== despues) cambios.push({ campo: c.t, antes, despues });
  }
  if (txtNec(e.necesidades) !== txtNec(d.necesidades)) cambios.push({ campo: 'Necesidades técnicas', antes: txtNec(e.necesidades), despues: txtNec(d.necesidades) });
  if (e.tipo === 'asamblea' && (Math.abs(e.lat - d.lat) > 1e-6 || Math.abs(e.lng - d.lng) > 1e-6)) cambios.push({ campo: 'Ubicación', antes: 'anterior', despues: 'nueva ubicación en el mapa' });
  if (e.tipo === 'recorrido' && JSON.stringify(e.ruta?.trazo) !== JSON.stringify(d.ruta.trazo))
    cambios.push({ campo: 'Ruta', antes: `${e.ruta?.km ?? 0} km`, despues: `${d.ruta.km} km` });
  if (quitar.some((x) => ya.includes(x))) cambios.push({ campo: 'Fotos del lugar', antes: '', despues: `${quitar.filter((x) => ya.includes(x)).length} quitadas` });
  if (nuevas.length) cambios.push({ campo: 'Fotos del lugar', antes: '', despues: `${nuevas.length} agregadas` });
  if (!cambios.length) return { cambios: 0 };

  await tx(async (c) => {
    await c.query(
      `UPDATE eventos SET lugar = $2, lat = $3, lng = $4, ruta = $5, fecha_tentativa = $6, asistentes = $7, necesidades = $8, notas = $9, updated_at = now() WHERE id = $1`,
      [
        id,
        d.lugar,
        e.tipo === 'asamblea' ? d.lat : null,
        e.tipo === 'asamblea' ? d.lng : null,
        e.tipo === 'recorrido' ? JSON.stringify(d.ruta) : null,
        d.fechaTentativa,
        d.asistentes,
        JSON.stringify(d.necesidades),
        d.notas,
      ]
    );
    if (quitar.length) await c.query("DELETE FROM evento_fotos WHERE evento_id = $1 AND clase = 'lugar' AND id = ANY($2::bigint[])", [id, quitar]);
    await guardarFotos(c, id, nuevas, 'lugar');
    await historial(c, e, viewer, 'editado', '', cambios);
  });
  await notificar(involucrados(e), {
    tipo: 'evento.editado',
    titulo: `${viewer.name} ajustó ${e.tipo === 'asamblea' ? 'la asamblea' : 'el recorrido'} ${e.lugar}`,
    cuerpo: cambios.map((x) => x.campo).filter((v, i, a) => a.indexOf(v) === i).join(', '),
    url: url(id),
    autorId: viewer.id,
  });
  return { cambios: cambios.length };
}

// ---------------------------------------------------------------------------
// Flujo de aprobación y programación
// ---------------------------------------------------------------------------
// "YYYY-MM-DDTHH:MM" en hora del centro (sin horario de verano desde 2022)
function fechaHora(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(`${s}:00-06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function accion(viewer, id, body) {
  const { e, rol } = await cargar(viewer, id);
  const a = String(body.accion || '');
  const motivo = String(body.motivo || '').trim().slice(0, 1000);
  const quien = e.tipo === 'asamblea' ? 'La asamblea' : 'El recorrido';
  const pedirMotivo = (texto) => {
    if (motivo.length < 5) throw new EventoError(texto, 422, { motivo: texto });
  };
  let nuevo = null;
  // Nombre de la acción en el historial (en pasado)
  let accionHist = { pasar: 'pasado', enviar: 'reenviado', ajustes: 'ajustes', rechazar: 'rechazado', cancelar: 'cancelado' }[a] || a;
  let detalle = '';
  let aviso = null;
  let inicio = null;
  let fin = null;

  if (a === 'pasar') {
    if (rol !== 'zona' || e.estado !== 'revision_zona') throw new EventoError('Esta acción no está disponible.', 409);
    nuevo = 'revision_cpv';
    detalle = 'Pasó la propuesta al CPV.';
    aviso = { a: [e.cpv_id, e.rs_id], titulo: `${quien} ${e.lugar} pasó al CPV`, cuerpo: `${viewer.name} lo revisó; falta que el CPV lo programe.` };
  } else if (a === 'enviar') {
    if (rol !== 'rs' || e.estado !== 'ajustes') throw new EventoError('Esta acción no está disponible.', 409);
    nuevo = 'revision_zona';
    detalle = 'Reenvió la propuesta con los ajustes.';
    aviso = { a: [e.zona_id, e.cpv_id], titulo: `${viewer.name} reenvió ${e.tipo === 'asamblea' ? 'la asamblea' : 'el recorrido'} ${e.lugar}`, cuerpo: 'Ya tiene los ajustes; revísalo de nuevo.' };
  } else if (a === 'ajustes') {
    if (!((rol === 'zona' && e.estado === 'revision_zona') || (rol === 'cpv' && e.estado === 'revision_cpv'))) throw new EventoError('Esta acción no está disponible.', 409);
    pedirMotivo('Escribe qué hay que ajustar.');
    nuevo = 'ajustes';
    detalle = `Pidió ajustes: ${motivo}`;
    aviso = { a: involucrados(e), titulo: `${quien} ${e.lugar} requiere ajustes`, cuerpo: motivo };
  } else if (a === 'rechazar') {
    if (!((rol === 'zona' && e.estado === 'revision_zona') || (rol === 'cpv' && e.estado === 'revision_cpv'))) throw new EventoError('Esta acción no está disponible.', 409);
    pedirMotivo('Escribe el motivo del rechazo.');
    nuevo = 'rechazado';
    detalle = `Rechazó la propuesta: ${motivo}`;
    aviso = { a: involucrados(e), titulo: `${quien} ${e.lugar} fue rechazado`, cuerpo: motivo };
  } else if (a === 'programar') {
    if (rol !== 'cpv' || !['revision_cpv', 'programado'].includes(e.estado)) throw new EventoError('Solo el CPV programa asambleas y recorridos.', 409);
    inicio = fechaHora(body.inicio);
    fin = body.fin ? fechaHora(body.fin) : null;
    const f = {};
    if (!inicio) f.inicio = 'Elige la fecha y la hora de inicio.';
    else if (inicio < new Date()) f.inicio = 'La fecha y hora deben ser futuras.';
    if (body.fin && !fin) f.fin = 'Hora de término no válida.';
    else if (fin && inicio && fin <= inicio) f.fin = 'Debe terminar después de iniciar.';
    if (Object.keys(f).length) throw new EventoError('Revisa la fecha y la hora.', 422, f);
    const re = e.estado === 'programado';
    nuevo = 'programado';
    accionHist = re ? 'reprogramado' : 'programado';
    detalle = `${re ? 'Reprogramó' : 'Programó'} para el ${FMT_CORTO.format(inicio)}${fin ? ` al ${FMT_CORTO.format(fin)}` : ''}.`;
    aviso = { a: rama(e), titulo: `${re ? 'Cambio de fecha: ' : ''}${TIPO[e.tipo]} el ${FMT_CORTO.format(inicio)}`, cuerpo: `${e.lugar} · sección ${seccionTxt(e.seccion)}. Ya está en tu agenda.` };
  } else if (a === 'cancelar') {
    const propia = rol === 'rs' && EDITABLE.has(e.estado);
    const delCPV = rol === 'cpv' && (EDITABLE.has(e.estado) || e.estado === 'programado');
    if (!propia && !delCPV) throw new EventoError('Esta acción no está disponible.', 409);
    if (rol === 'cpv') pedirMotivo('Escribe el motivo de la cancelación.');
    nuevo = 'cancelado';
    detalle = `Canceló${motivo ? `: ${motivo}` : '.'}`;
    aviso = { a: e.estado === 'programado' ? rama(e) : involucrados(e), titulo: `Cancelado: ${titulo(e)}`, cuerpo: motivo || `Lo canceló ${viewer.name}.` };
  } else {
    throw new EventoError('Acción no válida.', 422);
  }

  await tx(async (c) => {
    const r = await c.query(
      `UPDATE eventos SET estado = $2, updated_at = now(),
              inicio = COALESCE($4, inicio), fin = CASE WHEN $4::timestamptz IS NULL THEN fin ELSE $5 END,
              programado_por = CASE WHEN $4::timestamptz IS NULL THEN programado_por ELSE $6 END,
              recordatorio_at = CASE WHEN $4::timestamptz IS NULL THEN recordatorio_at ELSE NULL END,
              aviso_sin_reporte_at = CASE WHEN $4::timestamptz IS NULL THEN aviso_sin_reporte_at ELSE NULL END
       WHERE id = $1 AND estado = $3 RETURNING id`,
      [id, nuevo, e.estado, inicio, fin, viewer.id]
    );
    if (!r.rows.length) throw new EventoError('El evento cambió mientras tanto; vuelve a abrirlo.', 409);
    await historial(c, e, viewer, accionHist, detalle);
    if (motivo && ['ajustes', 'rechazar', 'cancelar'].includes(a)) {
      const pre = { ajustes: 'Ajustes', rechazar: 'Rechazado', cancelar: 'Cancelado' }[a];
      await observar(c, e, viewer, `${pre}: ${motivo}`);
    }
  });
  if (aviso) await notificar(aviso.a, { tipo: `evento.${accionHist}`, titulo: aviso.titulo, cuerpo: aviso.cuerpo, url: url(id), autorId: viewer.id });
  return { estado: nuevo };
}

// ---------------------------------------------------------------------------
// Reporte del Responsable de Sección (el día del evento; después queda como tardío)
// ---------------------------------------------------------------------------
async function reportar(viewer, id, body) {
  const { e, rol } = await cargar(viewer, id);
  if (rol !== 'rs') throw new EventoError('Solo el Responsable de Sección reporta el evento.', 403);
  if (e.estado !== 'programado') throw new EventoError(e.estado === 'realizado' ? 'Este evento ya fue reportado.' : 'Solo se reportan eventos programados.', 409);
  const dia = diaDe(e.inicio);
  if (hoyKey() < dia) throw new EventoError('Podrás reportarlo el día del evento.', 409);
  const f = {};
  const entero = (k, min, max, msg) => {
    const v = Number(String(body[k] ?? '').replace(/[,\s]/g, ''));
    if (!Number.isInteger(v) || v < min || v > max) f[k] = msg;
    return v;
  };
  const rep = {};
  rep.asistentes = entero('asistentes', 0, 200000, 'Escribe cuántas personas asistieron.');
  let fotos = [];
  if (e.tipo === 'asamblea') {
    rep.duracionMin = entero('duracionMin', 1, 1440, 'Escribe la duración en minutos.');
    fotos = fotosDe(body.fotos, MAX_FOTOS_TESTIMONIO);
    if (!fotos.length) f.fotos = 'Sube al menos una foto de testimonio.';
  } else {
    rep.casas = entero('casas', 0, 100000, 'Escribe cuántas casas visitaron.');
    const kmv = Number(String(body.km ?? '').replace(',', '.'));
    if (!Number.isFinite(kmv) || kmv < 0 || kmv > 300) f.km = 'Escribe los kilómetros recorridos (por ejemplo 3.5).';
    rep.km = Math.round(kmv * 100) / 100;
    rep.tiempoMin = entero('tiempoMin', 1, 1440, 'Escribe el tiempo del recorrido en minutos.');
    if (!f.casas && !f.tiempoMin) rep.casasHora = Math.round((rep.casas / (rep.tiempoMin / 60)) * 10) / 10;
  }
  rep.observaciones = String(body.observaciones ?? '').trim().slice(0, 2000);
  // Lista de asistencia (obligatoria): Excel con el mismo formato que las estructuras externas
  let lista = null;
  try {
    lista = await leerLista(body.lista, body.listaNombre);
  } catch (err) {
    if (!(err instanceof EventoError)) throw err;
    f.lista = err.message;
  }
  if (Object.keys(f).length) throw new EventoError(f.lista && Object.keys(f).length === 1 ? f.lista : 'Revisa los datos del reporte.', 422, f);
  const tardio = hoyKey() > dia;
  await tx(async (c) => {
    const r = await c.query(
      "UPDATE eventos SET estado = 'realizado', reporte = $2, reportado_at = now(), reporte_tardio = $3, updated_at = now() WHERE id = $1 AND estado = 'programado' RETURNING id",
      [id, JSON.stringify(rep), tardio]
    );
    if (!r.rows.length) throw new EventoError('Este evento ya fue reportado.', 409);
    await guardarFotos(c, id, fotos, 'testimonio');
    await guardarLista(c, id, lista, viewer);
    await historial(c, e, viewer, 'reportado', `${tardio ? 'Reportó el evento (reporte tardío)' : 'Reportó el evento'} con una lista de ${lista.unicas.length} asistentes.`);
  });
  const resumen =
    e.tipo === 'asamblea'
      ? `${rep.asistentes} asistentes · ${rep.duracionMin} min`
      : `${rep.asistentes} acompañantes · ${rep.casas} casas · ${rep.km} km · ${rep.casasHora ?? 0} casas/hora`;
  await notificar([e.zona_id, e.cpv_id], {
    tipo: 'evento.reportado',
    titulo: `${tardio ? 'Reporte tardío' : 'Reporte'}: ${titulo(e)}`,
    cuerpo: resumen,
    url: url(id),
    autorId: viewer.id,
  });
  return { ok: true, tardio, lista: resumenLista(lista) };
}

// ---------------------------------------------------------------------------
// Lista de asistencia
// ---------------------------------------------------------------------------
async function leerLista(dataUrl, nombre) {
  const buf = Buffer.isBuffer(dataUrl) ? dataUrl : listas.desdeDataUrl(dataUrl);
  if (!buf || !buf.length) throw new EventoError('Sube la lista de asistencia (Excel con la plantilla).', 422, { lista: 'Sube la lista de asistencia (Excel con la plantilla).' });
  let r;
  try {
    r = await listas.leer(buf);
  } catch (err) {
    if (err instanceof listas.ListaError) throw new EventoError(err.message, 422, { lista: err.message });
    throw err;
  }
  if (!r.unicas.length) {
    const msg = 'La lista no tiene personas con clave de elector o CURP válida.';
    throw new EventoError(msg, 422, { lista: msg });
  }
  return { ...r, archivo: String(nombre || 'asistencia.xlsx').slice(0, 200) };
}
const resumenLista = (l) => ({ archivo: l.archivo, filas: l.leidas, asistentes: l.unicas.length, repetidas: l.repetidas, errores: l.errores.length, filasConError: l.errores.slice(0, 30) });

// Reemplaza la lista del evento (al reportar o al corregirla)
async function guardarLista(c, eventoId, l, viewer) {
  await c.query('DELETE FROM evento_asistentes WHERE evento_id = $1', [eventoId]);
  for (let i = 0; i < l.unicas.length; i += 5000) {
    const lote = l.unicas.slice(i, i + 5000);
    await c.query(
      `INSERT INTO evento_asistentes (evento_id, clave_elector, curp, paterno, materno, nombres, telefono, seccion)
       SELECT $1, f.c, f.u, f.p, f.m, f.n, f.t, f.s FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[]) AS f(c, u, p, m, n, t, s)
       ON CONFLICT DO NOTHING`,
      [eventoId, lote.map((x) => x.c), lote.map((x) => x.u), lote.map((x) => x.paterno), lote.map((x) => x.materno), lote.map((x) => x.nombres), lote.map((x) => x.tel), lote.map((x) => x.seccion)]
    );
  }
  await c.query('UPDATE eventos SET asistencia = $2 WHERE id = $1', [eventoId, JSON.stringify({ ...resumenLista(l), at: new Date().toISOString(), por: viewer.name })]);
}

// Corregir la lista después del reporte (Responsable, Coordinador de Zona o CPV)
async function actualizarLista(viewer, id, buffer, archivo) {
  const { e, rol } = await cargar(viewer, id);
  if (!participa(rol)) throw new EventoError('No puedes modificar la lista de este evento.', 403);
  if (e.estado !== 'realizado') throw new EventoError('La lista de asistencia se sube con el reporte del evento.', 409);
  const l = await leerLista(buffer, archivo);
  const antes = e.asistencia?.asistentes ?? 0;
  await tx(async (c) => {
    await guardarLista(c, id, l, viewer);
    await historial(c, e, viewer, 'asistencia', `Actualizó la lista de asistencia: ${antes} → ${l.unicas.length} asistentes.`);
  });
  await notificar(involucrados(e), {
    tipo: 'evento.asistencia',
    titulo: `${viewer.name} actualizó la lista de asistencia de ${titulo(e)}`,
    cuerpo: `${l.unicas.length} asistentes${l.errores.length ? ` · ${l.errores.length} filas con error` : ''}.`,
    url: url(id),
    autorId: viewer.id,
  });
  return resumenLista(l);
}

// Cuántos asistentes son de la estructura del CPV, de sus estructuras externas, de ambas o de ninguna
async function cotejoLista(e) {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE n)::int AS nuestra,
            count(*) FILTER (WHERE x)::int AS paralelas,
            count(*) FILTER (WHERE n AND x)::int AS ambas,
            count(*) FILTER (WHERE NOT n AND NOT x)::int AS sin_estructura
     FROM (SELECT ${cotejo.enArbol('a', '$2')} AS n, ${cotejo.enExternas('a', '$2')} AS x
           FROM evento_asistentes a WHERE a.evento_id = $1) t`,
    [e.id, e.cpv_id]
  );
  const r = rows[0];
  return { total: r.total, nuestra: r.nuestra, paralelas: r.paralelas, ambas: r.ambas, sinEstructura: r.sin_estructura };
}

async function exportarLista(viewer, id) {
  const { e, rol } = await cargar(viewer, id);
  if (!participa(rol) && rol !== 'sa') throw new EventoError('No disponible.', 403);
  const { rows } = await query('SELECT * FROM evento_asistentes WHERE evento_id = $1 ORDER BY paterno, materno, nombres', [id]);
  return { buffer: await listas.exportar(rows, 'Asistencia'), nombre: `asistencia-${String(e.folio).padStart(5, '0')}.xlsx` };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
// Filtro SQL de lo que ve cada cuenta (alias e)
function filtro(viewer) {
  if (viewer.role === 'superadmin') return { sql: 'true', valor: null };
  if (viewer.role === 'promotor') return { sql: "e.rs_id = $1 AND e.estado IN ('programado', 'realizado')", valor: viewer.parentId };
  return { sql: '(e.rs_id = $1 OR e.zona_id = $1 OR e.cpv_id = $1)', valor: viewer.id };
}

const nombre = (id) => users.get(id)?.name || 'Cuenta eliminada';

function resumenFila(viewer, e, extra = {}) {
  const rol = rolEn(viewer, e);
  return {
    id: e.id,
    folio: `EV-${String(e.folio).padStart(5, '0')}`,
    tipo: e.tipo,
    estado: e.estado,
    estadoTexto: ESTADO[e.estado],
    lugar: e.lugar,
    seccion: e.seccion,
    responsable: nombre(e.rs_id),
    zona: users.get(e.zona_id)?.zona?.codigo || nombre(e.zona_id),
    fechaTentativa: fechaTxt(e.fecha_tentativa),
    inicio: e.inicio ? e.inicio.toISOString() : null,
    fin: e.fin ? e.fin.toISOString() : null,
    asistentes: e.asistentes,
    reporteTardio: e.reporte_tardio,
    turno: turnoDe(e, rol),
    updatedAt: e.updated_at.toISOString(),
    ...extra,
  };
}

// Lista de propuestas y eventos (sin promotores: ellos solo ven la agenda)
async function lista(viewer) {
  if (viewer.role === 'promotor') throw new EventoError('No disponible para tu nivel.', 403);
  const fl = filtro(viewer);
  const { rows } = await query(
    `SELECT e.*,
            (SELECT count(*)::int FROM evento_observaciones o WHERE o.evento_id = e.id) AS obs
     FROM eventos e WHERE ${fl.sql}
     ORDER BY COALESCE(e.inicio, e.fecha_tentativa::timestamptz) DESC, e.created_at DESC LIMIT 500`,
    fl.valor === null ? [] : [fl.valor]
  );
  return rows.map((e) => resumenFila(viewer, e, { observaciones: e.obs }));
}

// Agenda del mes (eventos programados o realizados de la rama)
async function agenda(viewer, mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) mes = hoyKey().slice(0, 7);
  const fl = filtro(viewer);
  const params = fl.valor === null ? [] : [fl.valor];
  const n = params.length;
  const { rows } = await query(
    `SELECT e.* FROM eventos e
     WHERE ${fl.sql} AND e.estado IN ('programado', 'realizado')
       AND (e.inicio AT TIME ZONE '${TZ}') >= ($${n + 1} || '-01')::date
       AND (e.inicio AT TIME ZONE '${TZ}') < (($${n + 1} || '-01')::date + interval '1 month')
     ORDER BY e.inicio`,
    [...params, mes]
  );
  return { mes, hoy: hoyKey(), eventos: rows.map((e) => resumenFila(viewer, e, { lat: e.lat, lng: e.lng })) };
}

async function detalle(viewer, id) {
  const { e, rol } = await cargar(viewer, id);
  const fotos = await query('SELECT id, clase FROM evento_fotos WHERE evento_id = $1 ORDER BY id', [id]);
  const esP = participa(rol);
  const dia = e.inicio ? diaDe(e.inicio) : null;
  // Lista de asistencia: el detalle y el cotejo solo para los involucrados (y el super administrador)
  const verLista = e.estado === 'realizado' && (esP || rol === 'sa');
  return {
    ...resumenFila(viewer, e),
    asistencia: verLista && e.asistencia ? { ...e.asistencia, cotejo: await cotejoLista(e) } : null,
    lat: e.lat,
    lng: e.lng,
    ruta: e.ruta,
    necesidades: e.necesidades,
    notas: e.notas,
    zonaNombre: nombre(e.zona_id),
    cpv: nombre(e.cpv_id),
    programadoPor: e.programado_por ? nombre(e.programado_por) : null,
    reporte: e.reporte,
    reportadoAt: e.reportado_at ? e.reportado_at.toISOString() : null,
    fotosLugar: fotos.rows.filter((f) => f.clase === 'lugar').map((f) => String(f.id)),
    fotosTestimonio: fotos.rows.filter((f) => f.clase === 'testimonio').map((f) => String(f.id)),
    rol,
    necesidadesCatalogo: NECESIDADES,
    puede: {
      editar: esP && EDITABLE.has(e.estado),
      observar: esP,
      pasar: rol === 'zona' && e.estado === 'revision_zona',
      enviar: rol === 'rs' && e.estado === 'ajustes',
      ajustes: (rol === 'zona' && e.estado === 'revision_zona') || (rol === 'cpv' && e.estado === 'revision_cpv'),
      rechazar: (rol === 'zona' && e.estado === 'revision_zona') || (rol === 'cpv' && e.estado === 'revision_cpv'),
      programar: rol === 'cpv' && ['revision_cpv', 'programado'].includes(e.estado),
      cancelar: (rol === 'rs' && EDITABLE.has(e.estado)) || (rol === 'cpv' && (EDITABLE.has(e.estado) || e.estado === 'programado')),
      reportar: rol === 'rs' && e.estado === 'programado' && hoyKey() >= dia,
      corregirLista: esP && e.estado === 'realizado',
    },
    reportarDesde: dia,
  };
}

async function historialDe(viewer, id) {
  const { rol } = await cargar(viewer, id);
  if (!participa(rol) && rol !== 'sa') throw new EventoError('No disponible.', 403);
  const { rows } = await query('SELECT user_name, accion, detalle, cambios, at FROM evento_historial WHERE evento_id = $1 ORDER BY at DESC, id DESC', [id]);
  return rows.map((r) => ({ autor: r.user_name, accion: r.accion, detalle: r.detalle, cambios: r.cambios, at: r.at.toISOString() }));
}

async function observaciones(viewer, id) {
  const { rol } = await cargar(viewer, id);
  if (!participa(rol) && rol !== 'sa') throw new EventoError('No disponible.', 403);
  const { rows } = await query('SELECT id, user_id, user_name, texto, at FROM evento_observaciones WHERE evento_id = $1 ORDER BY at, id', [id]);
  return rows.map((r) => ({ id: String(r.id), autor: r.user_name, texto: r.texto, at: r.at.toISOString(), propia: r.user_id === viewer.id }));
}

async function agregarObservacion(viewer, id, texto) {
  const { e, rol } = await cargar(viewer, id);
  if (!participa(rol)) throw new EventoError('No puedes dejar observaciones en este evento.', 403);
  const t = String(texto || '').trim().slice(0, 1000);
  if (!t) throw new EventoError('Escribe la observación.', 422, { texto: 'Escribe la observación.' });
  await observar({ query }, e, viewer, t);
  await notificar(involucrados(e), {
    tipo: 'evento.observacion',
    titulo: `${viewer.name} comentó en ${titulo(e)}`,
    cuerpo: t.slice(0, 200),
    url: url(id),
    autorId: viewer.id,
  });
  return { ok: true };
}

async function foto(viewer, fotoId) {
  if (!/^\d+$/.test(String(fotoId))) throw new EventoError('Foto no encontrada', 404);
  const { rows } = await query('SELECT f.image, f.evento_id FROM evento_fotos f WHERE f.id = $1', [fotoId]);
  if (!rows.length) throw new EventoError('Foto no encontrada', 404);
  await cargar(viewer, rows[0].evento_id);
  return rows[0].image;
}

// ---------------------------------------------------------------------------
// Recordatorios: el día del evento al responsable; al día siguiente, si no reportó, a zona y CPV
// ---------------------------------------------------------------------------
async function recordatorios() {
  const hoy = hoyKey();
  const { rows: porReportar } = await query(
    `UPDATE eventos SET recordatorio_at = now()
     WHERE estado = 'programado' AND recordatorio_at IS NULL AND inicio <= now()
       AND to_char(inicio AT TIME ZONE '${TZ}', 'YYYY-MM-DD') = $1
     RETURNING *`,
    [hoy]
  );
  for (const e of porReportar)
    await notificar([e.rs_id], {
      tipo: 'evento.recordatorio',
      titulo: `Hoy reporta: ${titulo(e)}`,
      cuerpo: 'Al terminar, captura asistentes y resultados. Debe reportarse hoy mismo.',
      url: url(e.id),
    });
  const { rows: sinReporte } = await query(
    `UPDATE eventos SET aviso_sin_reporte_at = now()
     WHERE estado = 'programado' AND aviso_sin_reporte_at IS NULL
       AND to_char(inicio AT TIME ZONE '${TZ}', 'YYYY-MM-DD') < $1
     RETURNING *`,
    [hoy]
  );
  for (const e of sinReporte)
    await notificar([e.rs_id, e.zona_id, e.cpv_id], {
      tipo: 'evento.sin_reporte',
      titulo: `Sin reporte: ${titulo(e)}`,
      cuerpo: `${nombre(e.rs_id)} no reportó el evento el mismo día.`,
      url: url(e.id),
    });
}

// ---------------------------------------------------------------------------
// Ruta por calles (OSRM público, perfil a pie). El servidor hace la consulta para no exponer
// la ubicación de la persona a terceros y no abrir la política de contenido del navegador.
// ---------------------------------------------------------------------------
const OSRM = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
async function rutaPorCalles(puntos) {
  const ps = String(puntos || '')
    .split(';')
    .map((p) => p.split(',').map(Number))
    .filter((p) => p.length === 2 && enMexico(p[0], p[1]));
  if (ps.length < 2 || ps.length > 25) throw new EventoError('Puntos no válidos.', 422);
  const coords = ps.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${OSRM}/${coords}?overview=full&geometries=geojson&steps=false`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'VERTEX (vertex.legislab.app)' },
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const g = j.routes?.[0];
    if (!g) throw new Error('sin ruta');
    return { trazo: g.geometry.coordinates.map(([lng, lat]) => [lat, lng]), km: Math.round((g.distance / 1000) * 100) / 100 };
  } catch {
    throw new EventoError('El servicio de rutas no respondió. Puedes desactivar «Seguir calles» y trazar a mano.', 503);
  } finally {
    clearTimeout(t);
  }
}

// Datos para el formulario: sección del responsable y entidad (para dibujar la sección en el mapa)
function contexto(viewer) {
  const rs = viewer.role === 'resp_seccion' ? viewer : null;
  const zona = rs ? users.get(rs.parentId) : viewer.role === 'coord_zona' ? viewer : null;
  const cpv = viewer.role === 'coord_promocion' ? viewer : zona ? users.get(zona.parentId) : null;
  const ctx = cpv ? require('./zonas').contexto(cpv) : null;
  return { seccion: rs?.territorio?.secciones?.[0] ?? null, entidad: ctx?.entidad?.clave ?? null, necesidades: NECESIDADES };
}

module.exports = {
  EventoError,
  actualizarLista,
  exportarLista,
  contexto,
  NECESIDADES,
  crear,
  editar,
  accion,
  reportar,
  lista,
  agenda,
  detalle,
  historialDe,
  observaciones,
  agregarObservacion,
  foto,
  recordatorios,
  rutaPorCalles,
};
