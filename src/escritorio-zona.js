// Panel del Coordinador de Zona: avance de su zona contra la meta, ritmo de captura, mapa por
// sección, pendientes y el detalle de cada Responsable de Sección. Solo cifras agregadas.
const { query } = require('./db');
const { users } = require('./store');
const zonas = require('./zonas');
const metas = require('./metas');

const TZ = 'America/Mexico_City';
const DIAS_SERIE = 30;
const ELECCION = require('./eleccion').fecha;
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

async function zona(cz) {
  const cpv = users.get(cz.parentId);
  const ctx = cpv ? zonas.contexto(cpv) : null;
  const claves = cz.territorio?.secciones || [];
  if (!ctx || !claves.length) return { entidad: null };
  const cfg = metas.configDe(cpv);
  const hijosDe = (id, role) => users.hijos(id, role);

  const secciones = new Map(
    claves.map((c) => {
      const e = ctx.hasPadron ? ctx.ln(c) : null;
      const m = e === null ? { meta: 0, promotores: 0 } : metas.metaSeccion(e, cfg);
      return [c, { c, e, m: m.meta, pm: m.promotores, p: 0, rs: null }];
    })
  );
  const responsables = hijosDe(cz.id, 'resp_seccion').map((r) => {
    const sec = r.territorio?.secciones?.[0] ?? null;
    const s = secciones.get(sec);
    if (s) s.rs = r.name;
    return {
      id: r.id,
      name: r.name,
      phone: r.phone || '',
      seccion: sec,
      meta: s?.m || 0,
      promotoresMeta: s?.pm || 0,
      promotores: hijosDe(r.id, 'promotor').length,
      promovidos: 0,
      aprobados: 0,
      porRevisar: 0,
      observaciones: 0,
      viejos: 0,
      ultima: null,
      serie: null,
      material: { pendientes: 0, sinEvidencia: 0, conEvidencia: 0 },
    };
  });
  const porId = new Map(responsables.map((r) => [r.id, r]));
  const ids = responsables.map((r) => r.id);

  const [prom, serie, mat] = await Promise.all([
    query(
      `SELECT p.responsable_id AS rs, p.seccion, p.estatus,
              (p.estatus = 'en_revision' AND EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id AND o.at > COALESCE((SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id AND h.user_id = p.promotor_id AND h.accion = 'editado'), '-infinity'::timestamptz))) AS obs,
              count(*)::int AS n,
              count(*) FILTER (WHERE p.estatus = 'en_revision' AND p.created_at < now() - interval '3 days')::int AS viejos,
              max(p.created_at) AS ultima
       FROM promovidos p WHERE p.responsable_id = ANY($1::uuid[]) GROUP BY 1, 2, 3, 4`,
      [ids]
    ),
    query(
      `SELECT p.responsable_id AS rs, to_char(p.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS dia, count(*)::int AS n
       FROM promovidos p WHERE p.responsable_id = ANY($1::uuid[]) AND p.created_at >= now() - ($3 || ' days')::interval GROUP BY 1, 2`,
      [ids, TZ, String(DIAS_SERIE + 1)]
    ),
    query(
      `SELECT o.de_id, o.para_id, o.estado, count(*)::int AS n,
              COALESCE(sum((SELECT sum(i.cantidad) FROM material_orden_items i WHERE i.orden_id = o.id)), 0)::int AS unidades
       FROM material_ordenes o WHERE o.de_id = $1 OR o.para_id = $1 GROUP BY 1, 2, 3`,
      [cz.id]
    ),
  ]);

  const est = { aprobados: 0, revision: 0, observaciones: 0, rechazados: 0, viejos: 0 };
  for (const x of prom.rows) {
    const r = porId.get(x.rs);
    const s = secciones.get(x.seccion);
    if (s) s.p += x.n;
    if (r) {
      r.promovidos += x.n;
      if (x.estatus === 'validado') r.aprobados += x.n;
      if (x.estatus === 'en_revision') r.porRevisar += x.n;
      if (x.obs) r.observaciones += x.n;
      r.viejos += x.viejos;
      if (!r.ultima || x.ultima > r.ultima) r.ultima = x.ultima;
    }
    if (x.estatus === 'validado') est.aprobados += x.n;
    else if (x.estatus === 'rechazado') est.rechazados += x.n;
    else if (x.obs) est.observaciones += x.n;
    else est.revision += x.n;
    est.viejos += x.viejos;
  }

  const hoy = new Date();
  const dias = Array.from({ length: DIAS_SERIE }, (_, i) => FMT_DIA.format(new Date(hoy.getTime() - (DIAS_SERIE - 1 - i) * 86400000)));
  const idx = new Map(dias.map((d, i) => [d, i]));
  const total = dias.map(() => 0);
  for (const r of responsables) r.serie = dias.map(() => 0);
  for (const x of serie.rows) {
    const i = idx.get(x.dia);
    if (i === undefined) continue;
    total[i] += x.n;
    const r = porId.get(x.rs);
    if (r) r.serie[i] += x.n;
  }

  // Material: lo que el CPV le entregó a la zona y lo que la zona entregó a sus responsables
  const material = { recibidas: 0, porRecibir: 0, unidadesRecibidas: 0, unidadesEntregadas: 0, ordenes: 0, pendientes: 0, sinEvidencia: 0, conEvidencia: 0 };
  for (const x of mat.rows) {
    if (x.para_id === cz.id) {
      if (x.estado === 'pendiente') material.porRecibir += x.n;
      else {
        material.recibidas += x.n;
        material.unidadesRecibidas += x.unidades;
      }
    } else {
      material.unidadesEntregadas += x.unidades;
      material.ordenes += x.n;
      const k = x.estado === 'pendiente' ? 'pendientes' : x.estado === 'recibida' ? 'sinEvidencia' : 'conEvidencia';
      material[k] += x.n;
      const r = porId.get(x.para_id);
      if (r) r.material[k] += x.n;
    }
  }

  const lista = [...secciones.values()];
  const meta = lista.reduce((t, s) => t + s.m, 0);
  const promovidos = est.aprobados + est.revision + est.observaciones + est.rechazados;
  const semana = total.slice(-7).reduce((t, v) => t + v, 0);
  const diasRestantes = Math.max(0, Math.ceil((ELECCION - Date.now()) / 86400000));
  const promedio7d = semana / 7;
  const faltan = Math.max(0, meta - promovidos);

  return {
    entidad: ctx.entidad,
    zona: { nombre: cz.zona?.nombre || cz.name, codigo: cz.zona?.codigo || '', color: cz.zona?.color || '#2a78d6' },
    cpv: cpv.name,
    eleccion: { dias: diasRestantes },
    kpis: {
      secciones: lista.length,
      seccionesCubiertas: lista.filter((s) => s.rs).length,
      responsables: responsables.length,
      promotores: responsables.reduce((t, r) => t + r.promotores, 0),
      promotoresMeta: lista.reduce((t, s) => t + s.pm, 0),
      promovidos,
      meta,
      hoy: total[total.length - 1],
      semana,
      semanaAnterior: total.slice(-14, -7).reduce((t, v) => t + v, 0),
    },
    ritmo: {
      promedio7d: Math.round(promedio7d),
      necesario: diasRestantes ? Math.ceil(faltan / diasRestantes) : faltan,
      faltan,
      proyeccion: promedio7d > 0 && faltan > 0 ? new Date(Date.now() + (faltan / promedio7d) * 86400000).toISOString() : null,
    },
    estatus: est,
    serie: { dias, total },
    material,
    responsables: responsables.map((r) => ({ ...r, ultima: r.ultima ? r.ultima.toISOString() : null })),
    vacantes: lista.filter((s) => !s.rs).map((s) => ({ c: s.c, e: s.e, m: s.m })).sort((a, b) => b.m - a.m),
    secciones: lista.map((s) => ({ c: s.c, z: null, e: s.e, m: s.m, p: s.p, rs: s.rs })),
  };
}

module.exports = { zona };
