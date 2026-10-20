// Panel del Promotor Territorial: su meta personal, lo que debe corregir, su ritmo,
// su lugar entre los promotores de su sección y sus capturas recientes.
const { query } = require('./db');
const { users, promovidos: cachePromovidos } = require('./store');
const metas = require('./metas');

const TZ = 'America/Mexico_City';
const DIAS_SERIE = 14;
const ELECCION = require('./eleccion').fecha;
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const nombre = (d) => [d.nombres, d.paterno, d.materno].filter(Boolean).join(' ');

async function promotor(pr) {
  const rs = users.get(pr.parentId);
  const zona = rs ? users.get(rs.parentId) : null;
  const cpv = zona ? users.get(zona.parentId) : null;
  const meta = cpv ? metas.configDe(cpv).factor : metas.DEFAULTS.factor;

  const [est, corregir, serie, recientes] = await Promise.all([
    query(
      `SELECT p.estatus,
              (p.estatus = 'en_revision' AND EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id AND o.at > COALESCE((SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id AND h.user_id = p.promotor_id AND h.accion = 'editado'), '-infinity'::timestamptz))) AS obs,
              count(*)::int AS n
       FROM promovidos p WHERE p.promotor_id = $1 GROUP BY 1, 2`,
      [pr.id]
    ),
    // Lo que requiere su acción: rechazados y los que tienen una observación del responsable sin respuesta
    query(
      `SELECT p.id, p.data, p.estatus, u.texto, u.at
       FROM promovidos p
       JOIN LATERAL (SELECT o.texto, o.at, o.user_id FROM promovido_observaciones o WHERE o.promovido_id = p.id ORDER BY o.at DESC, o.id DESC LIMIT 1) u ON true
       WHERE p.promotor_id = $1 AND p.estatus <> 'validado'
         AND (p.estatus = 'rechazado' OR (u.user_id IS DISTINCT FROM p.promotor_id
              AND u.at > COALESCE((SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id AND h.user_id = p.promotor_id AND h.accion = 'editado'), '-infinity'::timestamptz)))
       ORDER BY (p.estatus = 'rechazado') DESC, u.at DESC LIMIT 20`,
      [pr.id]
    ),
    query(
      `SELECT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS dia, count(*)::int AS n
       FROM promovidos WHERE promotor_id = $1 AND created_at >= now() - ($3 || ' days')::interval GROUP BY 1`,
      [pr.id, TZ, String(DIAS_SERIE + 1)]
    ),
    query('SELECT id, data, estatus, created_at FROM promovidos WHERE promotor_id = $1 ORDER BY created_at DESC LIMIT 5', [pr.id]),
  ]);

  const e = { aprobados: 0, revision: 0, observaciones: 0, rechazados: 0 };
  for (const r of est.rows) {
    if (r.estatus === 'validado') e.aprobados += r.n;
    else if (r.estatus === 'rechazado') e.rechazados += r.n;
    else if (r.obs) e.observaciones += r.n;
    else e.revision += r.n;
  }
  const total = e.aprobados + e.revision + e.observaciones + e.rechazados;

  const hoy = new Date();
  const dias = Array.from({ length: DIAS_SERIE }, (_, i) => FMT_DIA.format(new Date(hoy.getTime() - (DIAS_SERIE - 1 - i) * 86400000)));
  const porDia = new Map(serie.rows.map((r) => [r.dia, r.n]));
  const conteo = dias.map((d) => porDia.get(d) || 0);
  // Racha: días seguidos con al menos una captura, contando desde hoy (o ayer si hoy aún no captura)
  let racha = 0;
  for (let i = conteo.length - 1 - (conteo[conteo.length - 1] ? 0 : 1); i >= 0 && conteo[i]; i--) racha += 1;

  // Lugar entre los promotores de su sección (solo su posición; no se exponen datos de los demás)
  const companeros = rs ? users.hijos(rs.id, 'promotor') : [pr];
  const porPromotor = new Map(companeros.map((u) => [u.id, cachePromovidos.dePromotor(u.id).size]));
  const mio = porPromotor.get(pr.id) || 0;
  const lugar = 1 + [...porPromotor.values()].filter((n) => n > mio).length;

  const diasRestantes = Math.max(0, Math.ceil((ELECCION - Date.now()) / 86400000));
  const faltan = Math.max(0, meta - total);
  return {
    meta,
    total,
    faltan,
    estatus: e,
    eleccion: { dias: diasRestantes },
    // Promovidos por semana para llegar a su meta antes de la elección
    porSemana: diasRestantes ? Math.ceil((faltan / diasRestantes) * 7) : faltan,
    seccion: rs?.territorio?.secciones?.[0] ?? null,
    responsable: rs ? { name: rs.name, phone: rs.phone || '' } : null,
    serie: { dias, conteo, semana: conteo.slice(-7).reduce((t, v) => t + v, 0), semanaAnterior: conteo.slice(0, 7).reduce((t, v) => t + v, 0) },
    racha,
    lugar: { posicion: lugar, de: companeros.length },
    corregir: corregir.rows.map((r) => ({ id: r.id, nombre: nombre(r.data), estatus: r.estatus, mensaje: r.texto, at: r.at.toISOString() })),
    recientes: recientes.rows.map((r) => ({ id: r.id, nombre: nombre(r.data), estatus: r.estatus, at: r.created_at.toISOString() })),
  };
}

module.exports = { promotor };
