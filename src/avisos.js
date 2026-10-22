// Centro de avisos del CPV: envía una notificación (push al celular y en la campana) a su estructura,
// eligiendo niveles (Coordinadores de Zona, Responsables de Sección, Promotores) y alcance
// (global, por zona o por sección). Queda un historial con a cuántas personas llegó.
const crypto = require('crypto');
const { query } = require('./db');
const { users } = require('./store');
const { notificar } = require('./notificaciones');

class AvisoError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const NIVELES = ['coord_zona', 'resp_seccion', 'promotor'];
const ALCANCES = new Set(['global', 'zonas', 'secciones']);
const MAX_POR_DIA = 30;
const limpio = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const seccionDe = (rs) => rs.territorio?.secciones?.[0] ?? null;

// Zonas y secciones del CPV (para el formulario): solo secciones que ya tienen Responsable
function opciones(cpv) {
  const zonas = [];
  const secciones = [];
  for (const z of users.hijos(cpv.id, 'coord_zona')) {
    zonas.push({ id: z.id, codigo: z.zona?.codigo || '', nombre: z.zona?.nombre || z.name, color: z.zona?.color || '#94a3b8' });
    for (const rs of users.hijos(z.id, 'resp_seccion')) {
      const s = seccionDe(rs);
      if (s !== null) secciones.push({ clave: Number(s), zona: z.id });
    }
  }
  zonas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.nombre.localeCompare(b.nombre, 'es'));
  secciones.sort((a, b) => a.clave - b.clave);
  return { zonas, secciones };
}

// Normaliza y valida la elección de destinatarios
function leerFiltro(body) {
  const niveles = [...new Set(Array.isArray(body.niveles) ? body.niveles.map(String) : [])].filter((n) => NIVELES.includes(n));
  const alcance = ALCANCES.has(body.alcance) ? body.alcance : 'global';
  const zonas = [...new Set(Array.isArray(body.zonas) ? body.zonas.map(String) : [])];
  const secciones = [...new Set(Array.isArray(body.secciones) ? body.secciones.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [])];
  const errors = {};
  if (!niveles.length) errors.niveles = 'Elige al menos un nivel.';
  if (alcance === 'zonas' && !zonas.length) errors.zonas = 'Elige al menos una zona.';
  if (alcance === 'secciones' && !secciones.length) errors.secciones = 'Elige al menos una sección.';
  return { niveles, alcance, zonas, secciones, errors };
}

// Cuentas de la estructura del CPV que reciben el aviso
function destinatarios(cpv, filtro) {
  const { niveles, alcance } = filtro;
  const zonasSel = new Set(filtro.zonas);
  const seccionesSel = new Set(filtro.secciones);
  const ids = new Set();
  for (const z of users.hijos(cpv.id, 'coord_zona')) {
    if (alcance === 'zonas' && !zonasSel.has(z.id)) continue;
    const responsables = users
      .hijos(z.id, 'resp_seccion')
      .filter((rs) => alcance !== 'secciones' || seccionesSel.has(Number(seccionDe(rs))));
    // Por sección: el Coordinador de Zona recibe si alguna de las secciones elegidas es de su zona
    if (niveles.includes('coord_zona') && (alcance !== 'secciones' || responsables.length)) ids.add(z.id);
    for (const rs of responsables) {
      if (niveles.includes('resp_seccion')) ids.add(rs.id);
      if (niveles.includes('promotor')) for (const p of users.hijos(rs.id, 'promotor')) ids.add(p.id);
    }
  }
  return [...ids];
}

async function conteo(cpv, body) {
  const f = leerFiltro(body || {});
  if (Object.keys(f.errors).length) return { destinatarios: 0, conPush: 0 };
  const ids = destinatarios(cpv, f);
  return { destinatarios: ids.length, conPush: await conPush(ids) };
}

async function conPush(ids) {
  if (!ids.length) return 0;
  const { rows } = await query('SELECT count(DISTINCT user_id)::int AS n FROM push_suscripciones WHERE user_id = ANY($1::uuid[])', [ids]);
  return rows[0].n;
}

async function enviar(cpv, autor, body) {
  const f = leerFiltro(body || {});
  const titulo = limpio(body?.titulo, 80);
  const cuerpo = String(body?.cuerpo ?? '').trim().slice(0, 300);
  const errors = { ...f.errors };
  if (titulo.length < 3) errors.titulo = 'Escribe el título del aviso.';
  if (cuerpo.length < 3) errors.cuerpo = 'Escribe el mensaje.';
  if (Object.keys(errors).length) throw new AvisoError('Revisa los datos marcados', 422, errors);
  const hoy = await query("SELECT count(*)::int AS n FROM avisos_cpv WHERE cpv_id = $1 AND created_at > now() - interval '1 day'", [cpv.id]);
  if (hoy.rows[0].n >= MAX_POR_DIA) throw new AvisoError(`Ya enviaste ${MAX_POR_DIA} avisos en las últimas 24 horas; intenta más tarde.`, 429);
  const ids = destinatarios(cpv, f);
  if (!ids.length) throw new AvisoError('Nadie de tu estructura coincide con lo que elegiste.', 422, { niveles: 'Nadie coincide con estos filtros.' });
  const push = await conPush(ids);
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO avisos_cpv (id, cpv_id, autor_id, titulo, cuerpo, niveles, alcance, zonas, secciones, destinatarios, con_push)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, cpv.id, autor.id, titulo, cuerpo, f.niveles, f.alcance, f.alcance === 'zonas' ? f.zonas : [], f.alcance === 'secciones' ? f.secciones : [], ids.length, push]
  );
  await notificar(ids, { tipo: 'cpv.aviso', titulo, cuerpo, url: '/notificaciones', autorId: cpv.id });
  return { id, destinatarios: ids.length, conPush: push };
}

async function historial(cpv) {
  const { rows } = await query('SELECT * FROM avisos_cpv WHERE cpv_id = $1 ORDER BY created_at DESC LIMIT 50', [cpv.id]);
  const zonaNombre = new Map(opciones(cpv).zonas.map((z) => [z.id, `${z.codigo ? `${z.codigo} · ` : ''}${z.nombre}`]));
  return rows.map((r) => ({
    id: r.id,
    titulo: r.titulo,
    cuerpo: r.cuerpo,
    niveles: r.niveles,
    alcance: r.alcance,
    zonas: r.zonas.map((z) => zonaNombre.get(z) || 'Zona eliminada'),
    secciones: r.secciones,
    destinatarios: r.destinatarios,
    conPush: r.con_push,
    autor: users.get(r.autor_id)?.name || 'Cuenta eliminada',
    at: r.created_at.toISOString(),
  }));
}

module.exports = { AvisoError, NIVELES, opciones, leerFiltro, destinatarios, conteo, enviar, historial };
