// Datos de ejemplo (scripts/datos-ejemplo.js): cuentas y promovidos marcados con data.ejemplo = true,
// y el material de ejemplo listado en ejemplo-material.json. El super administrador los puede
// borrar antes de operar con datos reales; lo capturado a mano no se toca.
const { query, tx } = require('./db');
const { users, promovidos: cachePromovidos } = require('./store');
const MATERIAL = require('./ejemplo-material.json');
const agenda = require('./ejemplo-agenda');

async function contar() {
  const { rows } = await query(
    `SELECT (SELECT count(*)::int FROM users WHERE data->>'ejemplo' = 'true') AS cuentas,
            (SELECT count(*)::int FROM promovidos WHERE data->>'ejemplo' = 'true') AS promovidos,
            (SELECT count(*)::int FROM material_articulos WHERE id = ANY($1::uuid[])) AS articulos,
            (SELECT count(*)::int FROM material_ordenes WHERE id = ANY($2::uuid[])) AS ordenes,
            (SELECT count(*)::int FROM eventos WHERE id = ANY($3::uuid[])) AS eventos,
            (SELECT count(*)::int FROM estructuras_externas WHERE id = ANY($4::uuid[])) AS externas`,
    [MATERIAL.articulos, MATERIAL.ordenes, agenda.ids().eventos, agenda.ids().externas]
  );
  return rows[0];
}

async function borrar() {
  const antes = await contar();
  let borrados = [];
  await tx(async (c) => {
    const p = await c.query("DELETE FROM promovidos WHERE data->>'ejemplo' = 'true' RETURNING id");
    borrados = p.rows.map((r) => r.id);
    await c.query('DELETE FROM material_ordenes WHERE id = ANY($1::uuid[])', [MATERIAL.ordenes]);
    await c.query('DELETE FROM material_articulos WHERE id = ANY($1::uuid[])', [MATERIAL.articulos]);
    // Agenda y estructuras paralelas de ejemplo (con sus fotos, listas de asistencia e historial)
    const { eventos, externas } = agenda.ids();
    await c.query('DELETE FROM eventos WHERE id = ANY($1::uuid[])', [eventos]);
    await c.query('DELETE FROM estructuras_externas WHERE id = ANY($1::uuid[])', [externas]);
    await c.query('DELETE FROM notificaciones WHERE url = ANY($1)', [eventos.map((id) => `/agenda/eventos/${id}`)]);
    // Notificaciones que apuntaban a lo borrado
    await c.query("DELETE FROM notificaciones WHERE url = ANY($1)", [borrados.map((id) => `/promovidos/${id}`)]);
  });
  cachePromovidos.olvidar(new Set(borrados));
  // Cuentas: primero promotores, luego responsables (se borran en cascada sus sesiones y órdenes)
  const cuentas = users.all().filter((u) => u.ejemplo);
  await users.removeMany(new Set(cuentas.filter((u) => u.role === 'promotor').map((u) => u.id)));
  await users.removeMany(new Set(cuentas.filter((u) => u.role !== 'promotor').map((u) => u.id)));
  // Órdenes de material que se quedaron sin artículos
  await query('DELETE FROM material_ordenes o WHERE NOT EXISTS (SELECT 1 FROM material_orden_items i WHERE i.orden_id = o.id)');
  return antes;
}

module.exports = { contar, borrar };
