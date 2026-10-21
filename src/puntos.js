// Puntos en el mapa de la sección: puntos de interés (Responsable de Sección y sus promotores) y
// ubicación de las casillas (solo el Responsable). Los ve todo el equipo de la sección.
const crypto = require('crypto');
const { query } = require('./db');
const { users } = require('./store');

class PuntoError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const TIPOS = new Set(['interes', 'casilla']);
// Límites de México (para descartar coordenadas sin sentido)
const enMexico = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > 14 && lat < 33 && lng > -118.5 && lng < -86;
const limpio = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// Responsable de Sección dueño del mapa: la propia cuenta o el Responsable del promotor
function rsDe(u) {
  if (u?.role === 'resp_seccion') return u;
  if (u?.role === 'promotor') return users.get(u.parentId) || null;
  return null;
}

const formato = (r, viewer, rs) => ({
  id: r.id,
  tipo: r.tipo,
  nombre: r.nombre,
  descripcion: r.descripcion,
  lat: r.lat,
  lng: r.lng,
  autor: r.user_id ? users.get(r.user_id)?.name || 'Cuenta eliminada' : 'Cuenta eliminada',
  createdAt: r.created_at.toISOString(),
  puedeBorrar: viewer.id === r.user_id || viewer.id === rs.id,
});

async function lista(viewer) {
  const rs = rsDe(viewer);
  if (!rs) return [];
  const { rows } = await query('SELECT * FROM seccion_puntos WHERE rs_id = $1 ORDER BY tipo DESC, created_at', [rs.id]);
  return rows.map((r) => formato(r, viewer, rs));
}

async function crear(viewer, body) {
  const rs = rsDe(viewer);
  if (!rs) throw new PuntoError('Tu cuenta no tiene sección.', 403);
  const tipo = String(body.tipo || '');
  if (!TIPOS.has(tipo)) throw new PuntoError('Tipo de punto no válido.');
  if (tipo === 'casilla' && viewer.role !== 'resp_seccion') throw new PuntoError('Solo el Responsable de Sección ubica las casillas.', 403);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const errors = {};
  if (!enMexico(lat, lng)) errors.ubicacion = 'Toca el mapa para colocar el pin.';
  let nombre = limpio(body.nombre, 80);
  if (tipo === 'casilla' && !nombre) nombre = 'Casilla';
  if (nombre.length < 2) errors.nombre = 'Escribe el nombre del punto.';
  const descripcion = String(body.descripcion ?? '').trim().slice(0, 500);
  if (Object.keys(errors).length) throw new PuntoError('Revisa los datos marcados', 422, errors);
  const id = crypto.randomUUID();
  const { rows } = await query(
    'INSERT INTO seccion_puntos (id, rs_id, user_id, tipo, nombre, descripcion, lat, lng) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [id, rs.id, viewer.id, tipo, nombre, descripcion, lat, lng]
  );
  return formato(rows[0], viewer, rs);
}

async function borrar(viewer, id) {
  const rs = rsDe(viewer);
  if (!rs || !/^[0-9a-f-]{36}$/.test(String(id))) throw new PuntoError('Punto no encontrado', 404);
  const { rows } = await query('SELECT * FROM seccion_puntos WHERE id = $1 AND rs_id = $2', [id, rs.id]);
  if (!rows.length) throw new PuntoError('Punto no encontrado', 404);
  if (viewer.id !== rows[0].user_id && viewer.id !== rs.id) throw new PuntoError('Solo quien lo creó o el Responsable de Sección puede borrarlo.', 403);
  await query('DELETE FROM seccion_puntos WHERE id = $1', [id]);
  return { ok: true };
}

module.exports = { PuntoError, lista, crear, borrar };
