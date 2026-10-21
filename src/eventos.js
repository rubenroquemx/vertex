// Agenda: asambleas y recorridos.
// Solo el CPV los crea: los prepara en borrador y, al publicarlos, aparecen en la agenda de los destinatarios
// (toda su red o las zonas que elija, con sus Responsables de Sección y Promotores Territoriales).
// Al crearlo designa quién lo reporta (él mismo, un Coordinador de Zona o un Responsable de Sección):
// esa persona envía el reporte el día del evento con la lista de asistencia; después se acepta, marcado como tardío.
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
const ESTADO = { borrador: 'Borrador', programado: 'Publicado', realizado: 'Realizado', cancelado: 'Cancelado' };
const EDITABLE = new Set(['borrador', 'programado']);
const ROLES_REPORTAN = new Set(['coord_promocion', 'coord_zona', 'resp_seccion']);
// Límites de México (para descartar coordenadas sin sentido)
const enMexico = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 14 && lat < 33 && lng > -118.5 && lng < -86;

class EventoError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const titulo = (e) => `${TIPO[e.tipo]} · ${e.lugar}`;
const url = (id) => `/agenda/eventos/${id}`;
const nombre = (id) => users.get(id)?.name || 'Cuenta eliminada';

// ---------------------------------------------------------------------------
// Red del CPV: zonas, responsables y promotores
// ---------------------------------------------------------------------------
const hijos = (id, role) => users.hijos(id, role);
// Zona (Coordinador de Zona) y CPV a los que pertenece una cuenta
function ubicar(u) {
  if (!u) return {};
  if (u.role === 'coord_promocion') return { cpv: u.id };
  if (u.role === 'coord_zona') return { zona: u.id, cpv: u.parentId };
  if (u.role === 'resp_seccion') return { zona: u.parentId, cpv: users.get(u.parentId)?.parentId };
  if (u.role === 'promotor') {
    const rs = users.get(u.parentId);
    return { zona: rs?.parentId, cpv: users.get(rs?.parentId)?.parentId };
  }
  return {};
}
const zonasDe = (e) => (e.alcance === 'red' ? hijos(e.cpv_id, 'coord_zona').map((z) => z.id) : e.zonas || []);
// Todas las cuentas que deben ver el evento en su agenda
function audiencia(e) {
  const ids = new Set([e.cpv_id, e.reporta_id].filter(Boolean));
  for (const z of zonasDe(e)) {
    ids.add(z);
    for (const rs of hijos(z, 'resp_seccion')) {
      ids.add(rs.id);
      for (const p of hijos(rs.id, 'promotor')) ids.add(p.id);
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
function rolEn(viewer, e) {
  if (viewer.id === e.cpv_id) return 'cpv';
  if (viewer.role === 'superadmin') return 'sa';
  if (!e.publicado_at) return null; // los borradores solo los ve el CPV
  if (viewer.id === e.reporta_id) return 'reporta';
  const u = ubicar(viewer);
  if (u.cpv === e.cpv_id && u.zona && (e.alcance === 'red' || (e.zonas || []).includes(u.zona))) return 'red';
  return null;
}
const reporta = (viewer, e) => viewer.id === e.reporta_id;

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

// Qué toca hacer (para resaltarlo en las listas)
function turnoDe(viewer, e) {
  if (viewer.id === e.cpv_id && e.estado === 'borrador') return 'Publicar';
  if (reporta(viewer, e) && e.estado === 'programado' && e.inicio && hoyKey() >= diaDe(e.inicio)) return 'Reportar';
  return null;
}

// ---------------------------------------------------------------------------
// Validación
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

// "YYYY-MM-DDTHH:MM" en hora del centro (sin horario de verano desde 2022)
function fechaHora(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(`${s}:00-06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// `publicar`: además de los datos básicos exige fecha y hora futuras, destinatarios y quién reporta
function validar(cpv, tipo, body, { publicar, inicioAnterior = null }) {
  const f = {};
  const d = {};
  const lugar = String(body.lugar ?? '').trim().replace(/\s+/g, ' ');
  if (!lugar) f.lugar = tipo === 'asamblea' ? 'Escribe el lugar de la asamblea.' : 'Escribe la comunidad o colonia del recorrido.';
  else if (lugar.length > 160) f.lugar = 'Máximo 160 caracteres.';
  d.lugar = lugar;
  if (tipo === 'asamblea') {
    d.lat = Number(body.lat);
    d.lng = Number(body.lng);
    if (!enMexico(d.lat, d.lng)) {
      if (publicar) f.ubicacion = 'Marca en el mapa dónde será la asamblea.';
      d.lat = null;
      d.lng = null;
    }
  } else {
    d.ruta = limpiarRuta(body.ruta);
    if (!d.ruta && publicar) f.ruta = 'Traza la ruta del recorrido en el mapa (mínimo dos puntos).';
  }
  d.inicio = body.inicio ? fechaHora(body.inicio) : null;
  d.fin = body.fin ? fechaHora(body.fin) : null;
  if (body.inicio && !d.inicio) f.inicio = 'Fecha u hora no válida.';
  else if (!d.inicio && publicar) f.inicio = 'Elige la fecha y la hora de inicio.';
  // Al publicar, la fecha debe ser futura (salvo que no haya cambiado respecto a la ya publicada)
  else if (d.inicio && publicar && d.inicio < new Date() && !(inicioAnterior && +inicioAnterior === +d.inicio)) f.inicio = 'La fecha y hora deben ser futuras.';
  if (body.fin && !d.fin) f.fin = 'Hora de término no válida.';
  else if (d.fin && d.inicio && d.fin <= d.inicio) f.fin = 'Debe terminar después de iniciar.';
  const asis = Number(String(body.asistentes ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(asis) || asis < 1 || asis > 200000)
    f.asistentes = tipo === 'asamblea' ? 'Escribe cuántos asistentes esperas (número entero).' : 'Escribe cuántas personas acompañarán al candidato.';
  d.asistentes = asis;
  const nec = Array.isArray(body.necesidades) ? body.necesidades : [];
  d.necesidades = [...new Set(nec.map((x) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, 20);
  d.notas = String(body.notas ?? '').trim().slice(0, 2000);
  // Destinatarios
  d.alcance = body.alcance === 'zonas' ? 'zonas' : 'red';
  const propias = new Set(hijos(cpv.id, 'coord_zona').map((z) => z.id));
  d.zonas = d.alcance === 'zonas' ? [...new Set((Array.isArray(body.zonas) ? body.zonas : []).map(String))].filter((z) => propias.has(z)) : [];
  if (d.alcance === 'zonas' && !d.zonas.length) f.zonas = 'Elige al menos un Coordinador de Zona.';
  // Quién reporta: el CPV, un Coordinador de Zona o un Responsable de Sección de su red
  d.reportaId = body.reportaId ? String(body.reportaId) : null;
  const r = d.reportaId ? users.get(d.reportaId) : null;
  if (d.reportaId && (!r || !ROLES_REPORTAN.has(r.role) || ubicar(r).cpv !== cpv.id)) f.reportaId = 'Elige a una persona de tu red.';
  else if (!d.reportaId && publicar) f.reportaId = 'Elige quién reportará el evento.';
  return { f, d };
}

// ---------------------------------------------------------------------------
// Historial y fotos
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

const cuandoTxt = (d) => (d.inicio ? `${FMT_CORTO.format(d.inicio)}${d.fin ? ` a ${FMT_CORTO.format(d.fin)}` : ''}` : 'sin fecha');
const paraTxt = (d) => (d.alcance === 'red' ? 'toda la red' : d.zonas.map((z) => users.get(z)?.zona?.codigo || nombre(z)).join(', '));

// Aviso a los destinatarios al publicar o al cambiar un evento publicado
async function avisarPublicacion(e, viewer, { cambio = false } = {}) {
  const fecha = e.inicio ? FMT_CORTO.format(e.inicio) : '';
  await notificar(audiencia(e), {
    tipo: cambio ? 'evento.cambio' : 'evento.programado',
    titulo: `${cambio ? 'Cambio: ' : ''}${TIPO[e.tipo]} el ${fecha}`,
    cuerpo: `${e.lugar}. ${cambio ? 'Revisa los datos actualizados en tu agenda.' : 'Ya está en tu agenda.'}`,
    url: url(e.id),
    autorId: viewer.id,
  });
  if (e.reporta_id && e.reporta_id !== viewer.id)
    await notificar([e.reporta_id], {
      tipo: 'evento.encargado',
      titulo: `Te toca reportar: ${titulo(e)}`,
      cuerpo: `El ${fecha}. Al terminar, envía el reporte con la lista de asistencia.`,
      url: url(e.id),
      autorId: viewer.id,
    });
}

// ---------------------------------------------------------------------------
// Crear y editar (solo el CPV)
// ---------------------------------------------------------------------------
async function crear(cpv, body) {
  if (cpv.role !== 'coord_promocion') throw new EventoError('Solo el CPV crea asambleas y recorridos.', 403);
  const tipo = body.tipo === 'recorrido' ? 'recorrido' : body.tipo === 'asamblea' ? 'asamblea' : null;
  if (!tipo) throw new EventoError('Tipo de evento no válido.', 422);
  const publicar = body.publicar === true;
  const { f, d } = validar(cpv, tipo, body, { publicar });
  const bufs = fotosDe(body.fotos, MAX_FOTOS_LUGAR);
  if (Object.keys(f).length) throw new EventoError('Revisa los datos marcados.', 422, f);
  const id = crypto.randomUUID();
  const e = { id, tipo, cpv_id: cpv.id, lugar: d.lugar, inicio: d.inicio, fin: d.fin, alcance: d.alcance, zonas: d.zonas, reporta_id: d.reportaId };
  await tx(async (c) => {
    await c.query(
      `INSERT INTO eventos (id, tipo, estado, cpv_id, lugar, lat, lng, ruta, asistentes, necesidades, notas, inicio, fin,
                            alcance, zonas, reporta_id, creado_por, programado_por, publicado_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $4, $17, $18)`,
      [
        id,
        tipo,
        publicar ? 'programado' : 'borrador',
        cpv.id,
        d.lugar,
        tipo === 'asamblea' ? d.lat : null,
        tipo === 'asamblea' ? d.lng : null,
        tipo === 'recorrido' && d.ruta ? JSON.stringify(d.ruta) : null,
        d.asistentes,
        JSON.stringify(d.necesidades),
        d.notas,
        d.inicio,
        d.fin,
        d.alcance,
        d.zonas,
        d.reportaId,
        publicar ? cpv.id : null,
        publicar ? new Date() : null,
      ]
    );
    await guardarFotos(c, id, bufs, 'lugar');
    await historial(c, e, cpv, publicar ? 'publicado' : 'creado', publicar ? `Publicó para ${paraTxt(d)}: ${cuandoTxt(d)}.` : 'Guardó el borrador.');
  });
  if (publicar) await avisarPublicacion(e, cpv);
  return { id, estado: publicar ? 'programado' : 'borrador' };
}

const fechaTxt = (v) => (v ? FMT_CORTO.format(v) : '');

async function editar(viewer, id, body) {
  const { e, rol } = await cargar(viewer, id);
  if (rol !== 'cpv') throw new EventoError('Solo el CPV modifica el evento.', 403);
  if (!EDITABLE.has(e.estado)) throw new EventoError(`Ya no se puede modificar: el evento está ${ESTADO[e.estado].toLowerCase()}.`, 409);
  const publicado = e.estado === 'programado';
  // `publicar: true` en un borrador lo publica; uno ya publicado se valida siempre como publicado
  const publicar = publicado || body.publicar === true;
  const { f, d } = validar(viewer, e.tipo, body, { publicar, inicioAnterior: e.inicio });
  const nuevas = fotosDe(body.fotosNuevas, MAX_FOTOS_LUGAR);
  const quitar = (Array.isArray(body.fotosQuitar) ? body.fotosQuitar : []).map(Number).filter(Number.isInteger);
  const ya = (await query("SELECT id FROM evento_fotos WHERE evento_id = $1 AND clase = 'lugar'", [id])).rows.map((r) => Number(r.id));
  const quedan = ya.filter((x) => !quitar.includes(x)).length + nuevas.length;
  if (quedan > MAX_FOTOS_LUGAR) f.fotos = `Máximo ${MAX_FOTOS_LUGAR} fotos del lugar (quedarían ${quedan}).`;
  if (Object.keys(f).length) throw new EventoError('Revisa los datos marcados.', 422, f);

  const cambios = [];
  const cmp = (campo, antes, despues) => String(antes ?? '') !== String(despues ?? '') && cambios.push({ campo, antes: String(antes ?? ''), despues: String(despues ?? '') });
  cmp('Lugar', e.lugar, d.lugar);
  cmp('Inicio', fechaTxt(e.inicio), fechaTxt(d.inicio));
  cmp('Término', fechaTxt(e.fin), fechaTxt(d.fin));
  cmp('Asistentes esperados', e.asistentes, d.asistentes);
  cmp('Necesidades técnicas', (e.necesidades || []).join(', '), d.necesidades.join(', '));
  cmp('Notas', e.notas, d.notas);
  cmp('Destinatarios', paraTxt({ alcance: e.alcance, zonas: e.zonas || [] }), paraTxt(d));
  cmp('Quién reporta', e.reporta_id ? nombre(e.reporta_id) : '', d.reportaId ? nombre(d.reportaId) : '');
  if (e.tipo === 'asamblea' && (e.lat !== d.lat || e.lng !== d.lng)) cambios.push({ campo: 'Ubicación', antes: '', despues: d.lat ? 'nueva ubicación en el mapa' : 'sin ubicación' });
  if (e.tipo === 'recorrido' && JSON.stringify(e.ruta?.trazo || null) !== JSON.stringify(d.ruta?.trazo || null))
    cambios.push({ campo: 'Ruta', antes: e.ruta ? `${e.ruta.km} km` : '', despues: d.ruta ? `${d.ruta.km} km` : 'sin ruta' });
  const quitadas = quitar.filter((x) => ya.includes(x)).length;
  if (quitadas) cambios.push({ campo: 'Fotos del lugar', antes: '', despues: `${quitadas} quitadas` });
  if (nuevas.length) cambios.push({ campo: 'Fotos del lugar', antes: '', despues: `${nuevas.length} agregadas` });
  const seVaAPublicar = !publicado && body.publicar === true;
  if (!cambios.length && !seVaAPublicar) return { cambios: 0, estado: e.estado };

  await tx(async (c) => {
    await c.query(
      `UPDATE eventos SET lugar = $2, lat = $3, lng = $4, ruta = $5, asistentes = $6, necesidades = $7, notas = $8,
              inicio = $9, fin = $10, alcance = $11, zonas = $12, reporta_id = $13, updated_at = now(),
              estado = CASE WHEN $14::boolean THEN 'programado' ELSE estado END,
              publicado_at = CASE WHEN $14::boolean THEN now() ELSE publicado_at END,
              programado_por = CASE WHEN $14::boolean THEN $15::uuid ELSE programado_por END,
              recordatorio_at = CASE WHEN inicio IS DISTINCT FROM $9::timestamptz THEN NULL ELSE recordatorio_at END,
              aviso_sin_reporte_at = CASE WHEN inicio IS DISTINCT FROM $9::timestamptz THEN NULL ELSE aviso_sin_reporte_at END
       WHERE id = $1`,
      [
        id,
        d.lugar,
        e.tipo === 'asamblea' ? d.lat : null,
        e.tipo === 'asamblea' ? d.lng : null,
        e.tipo === 'recorrido' && d.ruta ? JSON.stringify(d.ruta) : null,
        d.asistentes,
        JSON.stringify(d.necesidades),
        d.notas,
        d.inicio,
        d.fin,
        d.alcance,
        d.zonas,
        d.reportaId,
        seVaAPublicar,
        viewer.id,
      ]
    );
    if (quitar.length) await c.query("DELETE FROM evento_fotos WHERE evento_id = $1 AND clase = 'lugar' AND id = ANY($2::bigint[])", [id, quitar]);
    await guardarFotos(c, id, nuevas, 'lugar');
    if (cambios.length) await historial(c, e, viewer, 'editado', '', cambios);
    if (seVaAPublicar) await historial(c, e, viewer, 'publicado', `Publicó para ${paraTxt(d)}: ${cuandoTxt(d)}.`);
  });
  const actual = { ...e, lugar: d.lugar, inicio: d.inicio, fin: d.fin, alcance: d.alcance, zonas: d.zonas, reporta_id: d.reportaId };
  if (seVaAPublicar) await avisarPublicacion(actual, viewer);
  else if (publicado) {
    // Cambios que importan a la red: fecha, lugar o destinatarios (los nuevos destinatarios también se enteran)
    const relevantes = cambios.some((c) => ['Lugar', 'Inicio', 'Término', 'Destinatarios', 'Ubicación', 'Ruta'].includes(c.campo));
    if (relevantes) await avisarPublicacion(actual, viewer, { cambio: true });
    else if (e.reporta_id !== d.reportaId && d.reportaId && d.reportaId !== viewer.id)
      await notificar([d.reportaId], { tipo: 'evento.encargado', titulo: `Te toca reportar: ${titulo(actual)}`, cuerpo: `El ${fechaTxt(d.inicio)}.`, url: url(id), autorId: viewer.id });
  }
  return { cambios: cambios.length, estado: seVaAPublicar ? 'programado' : e.estado };
}

// Cancelar un evento publicado (con motivo) o eliminar un borrador
async function cancelar(viewer, id, motivo) {
  const { e, rol } = await cargar(viewer, id);
  if (rol !== 'cpv') throw new EventoError('Solo el CPV cancela el evento.', 403);
  if (e.estado === 'borrador') {
    await query('DELETE FROM eventos WHERE id = $1', [id]);
    return { eliminado: true };
  }
  if (e.estado !== 'programado') throw new EventoError('Solo se cancelan eventos publicados.', 409);
  const m = String(motivo || '').trim().slice(0, 1000);
  if (m.length < 5) throw new EventoError('Escribe el motivo de la cancelación.', 422, { motivo: 'Escribe el motivo de la cancelación.' });
  await tx(async (c) => {
    await c.query("UPDATE eventos SET estado = 'cancelado', updated_at = now() WHERE id = $1", [id]);
    await historial(c, e, viewer, 'cancelado', `Canceló: ${m}`);
  });
  await notificar(audiencia(e), { tipo: 'evento.cancelado', titulo: `Cancelado: ${titulo(e)}`, cuerpo: m, url: url(id), autorId: viewer.id });
  return { estado: 'cancelado' };
}

// ---------------------------------------------------------------------------
// Reporte (la persona designada; el día del evento, después queda como tardío)
// ---------------------------------------------------------------------------
async function reportar(viewer, id, body) {
  const { e } = await cargar(viewer, id);
  if (!reporta(viewer, e)) throw new EventoError('Este evento lo reporta otra persona.', 403);
  if (e.estado !== 'programado') throw new EventoError(e.estado === 'realizado' ? 'Este evento ya fue reportado.' : 'Solo se reportan eventos publicados.', 409);
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
  await notificar([e.cpv_id], { tipo: 'evento.reportado', titulo: `${tardio ? 'Reporte tardío' : 'Reporte'}: ${titulo(e)}`, cuerpo: resumen, url: url(id), autorId: viewer.id });
  return { ok: true, tardio, lista: resumenLista(lista) };
}

// ---------------------------------------------------------------------------
// Lista de asistencia
// ---------------------------------------------------------------------------
async function leerLista(dataUrl, nombreArchivo) {
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
  return { ...r, archivo: String(nombreArchivo || 'asistencia.xlsx').slice(0, 200) };
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

// Corregir la lista después del reporte (quien reporta o el CPV)
async function actualizarLista(viewer, id, buffer, archivo) {
  const { e, rol } = await cargar(viewer, id);
  if (rol !== 'cpv' && !reporta(viewer, e)) throw new EventoError('No puedes modificar la lista de este evento.', 403);
  if (e.estado !== 'realizado') throw new EventoError('La lista de asistencia se sube con el reporte del evento.', 409);
  const l = await leerLista(buffer, archivo);
  const antes = e.asistencia?.asistentes ?? 0;
  await tx(async (c) => {
    await guardarLista(c, id, l, viewer);
    await historial(c, e, viewer, 'asistencia', `Actualizó la lista de asistencia: ${antes} → ${l.unicas.length} asistentes.`);
  });
  await notificar([e.cpv_id, e.reporta_id].filter(Boolean), {
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
  if (rol !== 'cpv' && rol !== 'sa' && !reporta(viewer, e)) throw new EventoError('No disponible.', 403);
  const { rows } = await query('SELECT * FROM evento_asistentes WHERE evento_id = $1 ORDER BY paterno, materno, nombres', [id]);
  return { buffer: await listas.exportar(rows, 'Asistencia'), nombre: `asistencia-${String(e.folio).padStart(5, '0')}.xlsx` };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
// Eventos publicados que le tocan a la cuenta (alias e): los de su zona o toda la red de su CPV, o los que reporta
function filtroRed(viewer) {
  const u = ubicar(viewer);
  return {
    sql: `e.publicado_at IS NOT NULL AND (e.reporta_id = $1 OR (e.cpv_id = $2 AND (e.alcance = 'red' OR $3::uuid = ANY(e.zonas))))`,
    params: [viewer.id, u.cpv || null, u.zona || null],
  };
}

// La estructura (Coordinador de Zona, Responsable de Sección y Promotor), salvo quien reporta el evento,
// solo ve el lugar, la fecha y la hora de inicio (en los recorridos, el punto de inicio). No ve
// reportes ni puede abrir los eventos pasados (salvo para enviar la selfie de su asistencia).
const ESTRUCTURA = new Set(['coord_zona', 'resp_seccion', 'promotor']);
const restringido = (viewer, e) => ESTRUCTURA.has(viewer.role) && e.reporta_id !== viewer.id;
const pasado = (e) => e.estado !== 'programado' || (e.inicio && diaDe(e.inicio) < hoyKey());

// Asistencia de la estructura: confirma antes del evento y, al terminar, envía una selfie
const HORAS_EVENTO = 3; // sin hora de fin, el evento se da por terminado 3 horas después de iniciar
const HORAS_SELFIE = 72; // plazo para enviar la selfie después del aviso
const finDe = (e) => (e.fin ? new Date(e.fin) : new Date(new Date(e.inicio).getTime() + HORAS_EVENTO * 3600000));
const limiteSelfie = (e) => new Date(finDe(e).getTime() + HORAS_SELFIE * 3600000);
const ASISTENCIA = { confirmada: 'Asistencia confirmada', acreditada: 'Asistencia acreditada', retirada: 'Asistencia retirada' };
const asistenciaDe = (e, a) =>
  a
    ? {
        estado: a.estado,
        estadoTexto: a.estado === 'confirmada' && Date.now() >= finDe(e).getTime() ? 'Falta tu selfie' : ASISTENCIA[a.estado],
        confirmadaAt: a.confirmada_at.toISOString(),
        selfieAt: a.selfie_at ? a.selfie_at.toISOString() : null,
        limite: limiteSelfie(e).toISOString(),
      }
    : null;
// Puede enviar la selfie: confirmó, el evento ya inició y no ha vencido el plazo
const puedeSelfie = (e, a) => a?.estado === 'confirmada' && e.inicio && Date.now() >= new Date(e.inicio).getTime() && Date.now() <= limiteSelfie(e).getTime();

async function asistenciasDe(viewer, ids) {
  if (!ESTRUCTURA.has(viewer.role) || !ids.length) return new Map();
  const { rows } = await query('SELECT evento_id, estado, confirmada_at, selfie_at FROM evento_asistencias WHERE user_id = $1 AND evento_id = ANY($2::uuid[])', [viewer.id, ids]);
  return new Map(rows.map((r) => [r.evento_id, r]));
}

function resumenFila(viewer, e, extra = {}, asis = null) {
  const fila = { ...resumenBase(viewer, e, extra), miAsistencia: asistenciaDe(e, asis) };
  if (!restringido(viewer, e)) return fila;
  return {
    ...fila,
    reporteTardio: false,
    reporta: null,
    // El evento pasado no se abre, salvo para enviar la selfie de su asistencia
    sinDetalle: pasado(e) && !puedeSelfie(e, asis),
    fin: null,
    asistentes: null,
  };
}

function resumenBase(viewer, e, extra) {
  return {
    id: e.id,
    folio: `EV-${String(e.folio).padStart(5, '0')}`,
    tipo: e.tipo,
    estado: e.estado,
    estadoTexto: ESTADO[e.estado],
    lugar: e.lugar,
    inicio: e.inicio ? e.inicio.toISOString() : null,
    fin: e.fin ? e.fin.toISOString() : null,
    asistentes: e.asistentes,
    alcance: e.alcance,
    para: paraTxt({ alcance: e.alcance, zonas: e.zonas || [] }),
    reporta: e.reporta_id ? nombre(e.reporta_id) : null,
    reportaYo: e.reporta_id === viewer.id,
    reporteTardio: e.reporte_tardio,
    turno: turnoDe(viewer, e),
    updatedAt: e.updated_at.toISOString(),
    ...extra,
  };
}

// Lista de gestión: el CPV ve todos los suyos; los demás, los que les toca reportar
async function lista(viewer) {
  let sql;
  let params;
  if (viewer.role === 'superadmin') [sql, params] = ['true', []];
  else if (viewer.role === 'coord_promocion') [sql, params] = ['e.cpv_id = $1', [viewer.id]];
  else [sql, params] = ['e.publicado_at IS NOT NULL AND e.reporta_id = $1', [viewer.id]];
  const { rows } = await query(`SELECT e.* FROM eventos e WHERE ${sql} ORDER BY COALESCE(e.inicio, e.created_at) DESC LIMIT 500`, params);
  return rows.map((e) => resumenFila(viewer, e));
}

// Agenda del mes: eventos publicados (programados o realizados) que le tocan a la cuenta
async function agenda(viewer, mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) mes = hoyKey().slice(0, 7);
  let filtro;
  if (viewer.role === 'superadmin') filtro = { sql: 'true', params: [] };
  else if (viewer.role === 'coord_promocion') filtro = { sql: 'e.cpv_id = $1', params: [viewer.id] };
  else filtro = filtroRed(viewer);
  const n = filtro.params.length;
  const { rows } = await query(
    `SELECT e.* FROM eventos e
     WHERE ${filtro.sql} AND e.estado IN ('programado', 'realizado') AND e.inicio IS NOT NULL
       AND (e.inicio AT TIME ZONE '${TZ}') >= ($${n + 1} || '-01')::date
       AND (e.inicio AT TIME ZONE '${TZ}') < (($${n + 1} || '-01')::date + interval '1 month')
     ORDER BY e.inicio`,
    [...filtro.params, mes]
  );
  // Pendientes de reportar de cualquier mes (para quien reporta)
  const pendientes =
    viewer.role === 'superadmin'
      ? []
      : (await query("SELECT e.* FROM eventos e WHERE e.reporta_id = $1 AND e.estado = 'programado' AND e.inicio <= now() ORDER BY e.inicio", [viewer.id])).rows;
  const asis = await asistenciasDe(viewer, rows.map((e) => e.id));
  return {
    mes,
    hoy: hoyKey(),
    eventos: rows.map((e) => resumenFila(viewer, e, {}, asis.get(e.id))),
    porReportar: pendientes.map((e) => resumenFila(viewer, e)),
  };
}

async function detalle(viewer, id) {
  const { e, rol } = await cargar(viewer, id);
  const fotos = await query('SELECT id, clase FROM evento_fotos WHERE evento_id = $1 ORDER BY id', [id]);
  const dia = e.inicio ? diaDe(e.inicio) : null;
  const esCPV = rol === 'cpv';
  const yo = reporta(viewer, e);
  // La lista de asistencia y su cotejo: el CPV, quien reporta y el super administrador
  const verLista = e.estado === 'realizado' && (esCPV || yo || rol === 'sa');
  const asis = (await asistenciasDe(viewer, [e.id])).get(e.id) || null;
  if (restringido(viewer, e) && pasado(e) && !puedeSelfie(e, asis)) throw new EventoError('Este evento ya pasó.', 404);
  // Asistencia de la estructura (para el CPV y el super administrador)
  const asistentesEstructura =
    esCPV || rol === 'sa'
      ? (
          await query('SELECT user_id, estado, confirmada_at, selfie_at FROM evento_asistencias WHERE evento_id = $1 ORDER BY confirmada_at', [e.id])
        ).rows.map((a) => ({
          userId: a.user_id,
          nombre: nombre(a.user_id),
          rol: users.get(a.user_id)?.role || null,
          estado: a.estado,
          estadoTexto: ASISTENCIA[a.estado],
          selfie: a.selfie_at ? `/api/eventos/${e.id}/asistencias/${a.user_id}/selfie` : null,
        }))
      : null;
  const out = {
    ...resumenFila(viewer, e, {}, asis),
    asistentesEstructura,
    lat: e.lat,
    lng: e.lng,
    ruta: e.ruta,
    necesidades: e.necesidades,
    notas: e.notas,
    zonas: e.zonas || [],
    reportaId: e.reporta_id,
    cpv: nombre(e.cpv_id),
    publicadoAt: e.publicado_at ? e.publicado_at.toISOString() : null,
    reporte: e.reporte,
    reportadoAt: e.reportado_at ? e.reportado_at.toISOString() : null,
    asistencia: verLista && e.asistencia ? { ...e.asistencia, cotejo: await cotejoLista(e) } : null,
    fotosLugar: fotos.rows.filter((f) => f.clase === 'lugar').map((f) => String(f.id)),
    fotosTestimonio: fotos.rows.filter((f) => f.clase === 'testimonio').map((f) => String(f.id)),
    rol,
    puede: {
      editar: esCPV && EDITABLE.has(e.estado),
      publicar: esCPV && e.estado === 'borrador',
      cancelar: esCPV && e.estado === 'programado',
      eliminar: esCPV && e.estado === 'borrador',
      reportar: yo && e.estado === 'programado' && hoyKey() >= dia,
      corregirLista: e.estado === 'realizado' && (esCPV || yo),
      historial: esCPV || rol === 'sa' || yo,
      confirmarAsistencia: ESTRUCTURA.has(viewer.role) && e.estado === 'programado' && Boolean(e.inicio) && new Date(e.inicio) > new Date() && !asis,
      cancelarAsistencia: asis?.estado === 'confirmada' && Boolean(e.inicio) && new Date(e.inicio) > new Date(),
      selfie: puedeSelfie(e, asis),
    },
    reportarDesde: dia,
  };
  if (!restringido(viewer, e)) return out;
  // Solo lugar, fecha y hora de inicio (y en los recorridos, el punto de inicio)
  const ini = e.tipo === 'recorrido' ? e.ruta?.puntos?.[0] : null;
  Object.assign(out, {
    soloInicio: true,
    lat: ini ? ini[0] : e.lat,
    lng: ini ? ini[1] : e.lng,
    ruta: null,
    para: '',
    cpv: null,
    zonas: [],
    necesidades: [],
    notas: '',
    fotosLugar: [],
    reporte: null,
    reportadoAt: null,
    asistencia: null,
    fotosTestimonio: [],
    publicadoAt: null,
  });
  return out;
}

// --- Asistencia de la estructura ---------------------------------------------
async function confirmarAsistencia(viewer, id) {
  const { e } = await cargar(viewer, id);
  if (!ESTRUCTURA.has(viewer.role)) throw new EventoError('Solo la estructura confirma asistencia.', 403);
  if (e.estado !== 'programado' || !e.inicio || new Date(e.inicio) <= new Date()) throw new EventoError('Solo se confirma antes de que empiece el evento.', 409);
  await query('INSERT INTO evento_asistencias (evento_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [e.id, viewer.id]);
  return { ok: true };
}

async function cancelarAsistencia(viewer, id) {
  const { e } = await cargar(viewer, id);
  if (!e.inicio || new Date(e.inicio) <= new Date()) throw new EventoError('El evento ya empezó.', 409);
  await query("DELETE FROM evento_asistencias WHERE evento_id = $1 AND user_id = $2 AND estado = 'confirmada'", [e.id, viewer.id]);
  return { ok: true };
}

function selfieValida(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  return buf && buf.length > 1000 && buf.length < 6 * 1024 * 1024 && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
}

async function enviarSelfie(viewer, id, dataUrl) {
  const { e } = await cargar(viewer, id);
  const asis = (await asistenciasDe(viewer, [e.id])).get(e.id) || null;
  if (!asis) throw new EventoError('No confirmaste tu asistencia a este evento.', 409);
  if (asis.estado === 'acreditada') throw new EventoError('Tu asistencia ya está acreditada.', 409);
  if (asis.estado === 'retirada') throw new EventoError('Venció el plazo para enviar la selfie.', 409);
  if (Date.now() < new Date(e.inicio).getTime()) throw new EventoError('La selfie se envía en el evento o al terminar.', 409);
  if (Date.now() > limiteSelfie(e).getTime()) throw new EventoError('Venció el plazo para enviar la selfie.', 409);
  const buf = selfieValida(dataUrl);
  if (!buf) throw new EventoError('La foto no es válida; vuelve a tomarla.', 422, { selfie: 'La foto no es válida; vuelve a tomarla.' });
  const img = await fotosLib.comprimir(buf, fotosLib.EVIDENCIA);
  await query(
    "UPDATE evento_asistencias SET estado = 'acreditada', selfie = $3, selfie_at = now() WHERE evento_id = $1 AND user_id = $2 AND estado = 'confirmada'",
    [e.id, viewer.id, img]
  );
  return { ok: true };
}

// La selfie la ven quien la tomó, el CPV del evento y el super administrador
async function selfieDe(viewer, id, userId) {
  const { e, rol } = await cargar(viewer, id);
  if (viewer.id !== userId && rol !== 'cpv' && rol !== 'sa') throw new EventoError('Foto no encontrada', 404);
  const { rows } = await query('SELECT selfie FROM evento_asistencias WHERE evento_id = $1 AND user_id = $2 AND selfie IS NOT NULL', [e.id, userId]);
  if (!rows.length) throw new EventoError('Foto no encontrada', 404);
  return rows[0].selfie;
}

// Eventos ya ocurridos (o de hoy, ya iniciados) que le tocan a la cuenta: para ligarles una
// activación de material. Nunca eventos futuros.
async function pasadosDe(viewer, dias = 90) {
  const f = filtroRed(viewer);
  const n = f.params.length;
  const { rows } = await query(
    `SELECT e.* FROM eventos e
     WHERE ${f.sql} AND e.estado IN ('programado', 'realizado') AND e.inicio IS NOT NULL
       AND e.inicio <= now() AND e.inicio > now() - ($${n + 1}::int * interval '1 day')
     ORDER BY e.inicio DESC LIMIT 100`,
    [...f.params, dias]
  );
  return rows.map((e) => ({ id: e.id, tipo: e.tipo, tipoTexto: TIPO[e.tipo], lugar: e.lugar, inicio: e.inicio.toISOString() }));
}

async function historialDe(viewer, id) {
  const { e, rol } = await cargar(viewer, id);
  if (rol !== 'cpv' && rol !== 'sa' && !reporta(viewer, e)) throw new EventoError('No disponible.', 403);
  const { rows } = await query('SELECT user_name, accion, detalle, cambios, at FROM evento_historial WHERE evento_id = $1 ORDER BY at DESC, id DESC', [id]);
  return rows.map((r) => ({ autor: r.user_name, accion: r.accion, detalle: r.detalle, cambios: r.cambios, at: r.at.toISOString() }));
}

async function foto(viewer, fotoId) {
  if (!/^\d+$/.test(String(fotoId))) throw new EventoError('Foto no encontrada', 404);
  const { rows } = await query('SELECT f.image, f.evento_id, f.clase FROM evento_fotos f WHERE f.id = $1', [fotoId]);
  if (!rows.length) throw new EventoError('Foto no encontrada', 404);
  const { e } = await cargar(viewer, rows[0].evento_id);
  if (restringido(viewer, e)) throw new EventoError('Foto no encontrada', 404);
  return rows[0].image;
}

// Datos para el formulario del CPV: entidad (mapa), sus zonas y quiénes pueden reportar
function contexto(viewer) {
  if (viewer.role !== 'coord_promocion') throw new EventoError('Solo el CPV crea asambleas y recorridos.', 403);
  const ctx = require('./zonas').contexto(viewer);
  const zonas = hijos(viewer.id, 'coord_zona').map((z) => ({
    id: z.id,
    nombre: z.name,
    codigo: z.zona?.codigo || '',
    zona: z.zona?.nombre || '',
    responsables: hijos(z.id, 'resp_seccion').map((r) => ({ id: r.id, nombre: r.name, seccion: r.territorio?.secciones?.[0] ?? null })),
  }));
  return { entidad: ctx?.entidad?.clave ?? null, necesidades: NECESIDADES, yo: { id: viewer.id, nombre: viewer.name }, zonas };
}

// ---------------------------------------------------------------------------
// Recordatorios: el día del evento a quien reporta; al día siguiente, si no reportó, a él y al CPV
// ---------------------------------------------------------------------------
async function recordatorios() {
  const hoy = hoyKey();
  const { rows: porReportar } = await query(
    `UPDATE eventos SET recordatorio_at = now()
     WHERE estado = 'programado' AND recordatorio_at IS NULL AND inicio <= now() AND reporta_id IS NOT NULL
       AND to_char(inicio AT TIME ZONE '${TZ}', 'YYYY-MM-DD') = $1
     RETURNING *`,
    [hoy]
  );
  for (const e of porReportar)
    await notificar([e.reporta_id], {
      tipo: 'evento.recordatorio',
      titulo: `Hoy reporta: ${titulo(e)}`,
      cuerpo: 'Al terminar, captura los resultados y sube la lista de asistencia. Debe reportarse hoy mismo.',
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
    await notificar([e.reporta_id, e.cpv_id].filter(Boolean), {
      tipo: 'evento.sin_reporte',
      titulo: `Sin reporte: ${titulo(e)}`,
      cuerpo: `${e.reporta_id ? nombre(e.reporta_id) : 'Nadie'} no reportó el evento el mismo día.`,
      url: url(e.id),
    });

  // Asistencia: al terminar el evento (su hora de fin o 3 horas después de iniciar) se pide la selfie
  const finSql = `COALESCE(e.fin, e.inicio + interval '${HORAS_EVENTO} hours')`;
  const { rows: pedirSelfie } = await query(
    `UPDATE evento_asistencias a SET aviso_at = now() FROM eventos e
     WHERE e.id = a.evento_id AND a.estado = 'confirmada' AND a.aviso_at IS NULL
       AND e.estado IN ('programado', 'realizado') AND ${finSql} <= now()
     RETURNING a.user_id, e.*`
  );
  for (const x of pedirSelfie)
    await notificar([x.user_id], {
      tipo: 'evento.selfie',
      titulo: `Envía tu selfie de asistencia: ${titulo(x)}`,
      cuerpo: `Para que cuente tu asistencia, envía tu selfie del evento en las próximas ${HORAS_SELFIE} horas.`,
      url: url(x.id),
    });
  // Sin selfie 72 horas después de terminar el evento, la asistencia se retira
  const { rows: retiradas } = await query(
    `UPDATE evento_asistencias a SET estado = 'retirada', retirada_at = now() FROM eventos e
     WHERE e.id = a.evento_id AND a.estado = 'confirmada'
       AND e.estado IN ('programado', 'realizado') AND ${finSql} + interval '${HORAS_SELFIE} hours' <= now()
     RETURNING a.user_id, e.*`
  );
  for (const x of retiradas)
    await notificar([x.user_id], {
      tipo: 'evento.asistencia_retirada',
      titulo: `Se quitó tu asistencia: ${titulo(x)}`,
      cuerpo: `No se recibió tu selfie en las ${HORAS_SELFIE} horas siguientes al evento.`,
      url: '/agenda',
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

module.exports = {
  EventoError,
  NECESIDADES,
  contexto,
  crear,
  editar,
  cancelar,
  reportar,
  actualizarLista,
  exportarLista,
  lista,
  agenda,
  detalle,
  historialDe,
  pasadosDe,
  confirmarAsistencia,
  cancelarAsistencia,
  enviarSelfie,
  selfieDe,
  foto,
  recordatorios,
  rutaPorCalles,
};
