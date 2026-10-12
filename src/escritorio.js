// Escritorio (dashboard) del Coordinador de Promoción del Voto: avance de toda su estructura
// contra la meta, ritmo de captura, revisión, mapa por sección, zonas, responsables y material.
// Solo cifras agregadas: no expone datos personales de promovidos.
const { query } = require('./db');
const { users } = require('./store');
const zonas = require('./zonas');
const metas = require('./metas');

const TZ = 'America/Mexico_City';
const DIAS_SERIE = 30;
// Apertura de casillas de la jornada electoral (hora del centro)
const ELECCION = new Date('2027-06-06T08:00:00-06:00');
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const diaKey = (d) => FMT_DIA.format(d);

async function cpv(cpvUser) {
  const resumen = zonas.resumen(cpvUser);
  const ctx = zonas.contexto(cpvUser);
  if (!resumen.entidad || !ctx) return { entidad: null };
  const cfg = metas.configDe(cpvUser);
  const all = users.all();
  const hijos = new Map();
  for (const u of all) {
    if (!hijos.has(u.parentId)) hijos.set(u.parentId, []);
    hijos.get(u.parentId).push(u);
  }
  const de = (id, role) => (hijos.get(id) || []).filter((u) => u.role === role);

  // Meta por sección (lista nominal × participación × conversión) y su zona
  const zonaDeSeccion = new Map();
  for (const z of resumen.zonas) for (const s of users.get(z.id)?.territorio?.secciones || []) zonaDeSeccion.set(s, z.id);
  const secciones = new Map(
    ctx.secciones.map((s) => {
      const e = ctx.hasPadron ? ctx.ln(s.clave) : null;
      const m = e === null ? { meta: 0, promotores: 0 } : metas.metaSeccion(e, cfg);
      return [s.clave, { c: s.clave, z: zonaDeSeccion.get(s.clave) || null, e, meta: m.meta, promotoresMeta: m.promotores, p: 0, rs: null, promotores: 0 }];
    })
  );

  // Estructura: responsables (una sección cada uno) y sus promotores
  const responsables = [];
  for (const z of resumen.zonas)
    for (const r of de(z.id, 'resp_seccion')) {
      const sec = r.territorio?.secciones?.[0];
      const promotores = de(r.id, 'promotor').length;
      responsables.push({ id: r.id, name: r.name, zona: z.id, seccion: sec ?? null, promotores });
      const s = secciones.get(sec);
      if (s) {
        s.rs = r.name;
        s.promotores += promotores;
      }
    }
  const rsIds = responsables.map((r) => r.id);
  const zonaDeRS = new Map(responsables.map((r) => [r.id, r.zona]));

  const [prom, serie, material, inventario] = await Promise.all([
    query(
      `SELECT p.responsable_id AS rs, p.seccion, p.estatus,
              (p.estatus = 'en_revision' AND EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id)) AS obs,
              count(*)::int AS n,
              count(*) FILTER (WHERE p.estatus = 'en_revision' AND p.created_at < now() - interval '3 days')::int AS viejos
       FROM promovidos p WHERE p.responsable_id = ANY($1::uuid[]) GROUP BY 1, 2, 3, 4`,
      [rsIds]
    ),
    query(
      `SELECT p.responsable_id AS rs, to_char(p.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS dia, count(*)::int AS n
       FROM promovidos p WHERE p.responsable_id = ANY($1::uuid[]) AND p.created_at >= now() - ($3 || ' days')::interval GROUP BY 1, 2`,
      [rsIds, TZ, String(DIAS_SERIE + 1)]
    ),
    query(
      `SELECT o.de_id, o.para_id, o.estado, count(*)::int AS n FROM material_ordenes o WHERE o.cpv_id = $1 GROUP BY 1, 2, 3`,
      [cpvUser.id]
    ),
    query('SELECT COALESCE(sum(cantidad), 0)::int AS n FROM material_entradas WHERE cpv_id = $1', [cpvUser.id]),
  ]);

  // Serie de 30 días (hoy incluido)
  const hoy = new Date();
  const dias = Array.from({ length: DIAS_SERIE }, (_, i) => diaKey(new Date(hoy.getTime() - (DIAS_SERIE - 1 - i) * 86400000)));
  const idxDia = new Map(dias.map((d, i) => [d, i]));

  const porZona = new Map(
    resumen.zonas.map((z) => [
      z.id,
      {
        id: z.id,
        codigo: z.codigo,
        nombre: z.nombre,
        color: z.color,
        coordinador: z.coordinador.name,
        secciones: z.secciones,
        seccionesCubiertas: 0,
        responsables: 0,
        promotores: 0,
        promotoresMeta: 0,
        meta: 0,
        promovidos: 0,
        aprobados: 0,
        porRevisar: 0,
        serie: dias.map(() => 0),
        material: { ordenes: 0, pendientes: 0, sinEvidencia: 0, conEvidencia: 0, porRecibir: 0 },
      },
    ])
  );
  for (const s of secciones.values()) {
    const z = porZona.get(s.z);
    if (!z) continue;
    z.meta += s.meta;
    z.promotoresMeta += s.promotoresMeta;
  }
  for (const r of responsables) {
    const z = porZona.get(r.zona);
    z.responsables += 1;
    z.promotores += r.promotores;
    if (r.seccion !== null && secciones.get(r.seccion)?.z === r.zona) z.seccionesCubiertas += 1;
  }

  const est = { aprobados: 0, revision: 0, observaciones: 0, rechazados: 0, viejos: 0 };
  const porRS = new Map();
  for (const r of prom.rows) {
    const s = secciones.get(r.seccion);
    if (s) s.p += r.n;
    const z = porZona.get(zonaDeRS.get(r.rs));
    if (z) {
      z.promovidos += r.n;
      if (r.estatus === 'validado') z.aprobados += r.n;
      if (r.estatus === 'en_revision') z.porRevisar += r.n;
    }
    porRS.set(r.rs, (porRS.get(r.rs) || 0) + r.n);
    if (r.estatus === 'validado') est.aprobados += r.n;
    else if (r.estatus === 'rechazado') est.rechazados += r.n;
    else if (r.obs) est.observaciones += r.n;
    else est.revision += r.n;
    est.viejos += r.viejos;
  }
  const total = dias.map(() => 0);
  for (const r of serie.rows) {
    const i = idxDia.get(r.dia);
    if (i === undefined) continue;
    total[i] += r.n;
    const z = porZona.get(zonaDeRS.get(r.rs));
    if (z) z.serie[i] += r.n;
  }

  // Material: lo del CPV a cada zona y lo de cada zona a sus responsables
  const mat = { inventario: inventario.rows[0].n, ordenes: 0, pendientes: 0, sinEvidencia: 0, conEvidencia: 0, porRecibirZonas: 0 };
  for (const r of material.rows) {
    if (r.de_id === cpvUser.id) {
      if (r.estado === 'pendiente') {
        mat.porRecibirZonas += r.n;
        const z = porZona.get(r.para_id);
        if (z) z.material.porRecibir += r.n;
      }
      continue;
    }
    const z = porZona.get(r.de_id);
    mat.ordenes += r.n;
    if (z) z.material.ordenes += r.n;
    const k = r.estado === 'pendiente' ? 'pendientes' : r.estado === 'recibida' ? 'sinEvidencia' : 'conEvidencia';
    mat[k] += r.n;
    if (z) z.material[k] += r.n;
  }

  // Responsables: avance de su sección contra su meta
  const rsAvance = responsables
    .filter((r) => r.seccion !== null && secciones.get(r.seccion)?.meta)
    .map((r) => {
      const s = secciones.get(r.seccion);
      const z = porZona.get(r.zona);
      return { name: r.name, seccion: r.seccion, zona: z?.codigo || '', color: z?.color || '#a3a3a3', promotores: r.promotores, promovidos: porRS.get(r.id) || 0, meta: s.meta };
    })
    .map((r) => ({ ...r, avance: r.promovidos / r.meta }));
  const ordenados = [...rsAvance].sort((a, b) => b.avance - a.avance || b.promovidos - a.promovidos);

  const z = [...porZona.values()];
  const totalSecciones = [...secciones.values()];
  const metaTotal = totalSecciones.reduce((t, s) => t + s.meta, 0);
  const promovidos = est.aprobados + est.revision + est.observaciones + est.rechazados;
  const semana = total.slice(-7).reduce((t, v) => t + v, 0);
  const diasRestantes = Math.max(0, Math.ceil((ELECCION - Date.now()) / 86400000));
  const promedio7d = semana / 7;
  const faltan = Math.max(0, metaTotal - promovidos);
  const proyeccion = promedio7d > 0 && faltan > 0 ? new Date(Date.now() + (faltan / promedio7d) * 86400000).toISOString() : null;

  return {
    entidad: resumen.entidad,
    totales: resumen.totales,
    eleccion: { fecha: ELECCION.toISOString(), dias: diasRestantes },
    kpis: {
      zonas: z.length,
      responsables: responsables.length,
      secciones: totalSecciones.length,
      seccionesCubiertas: totalSecciones.filter((s) => s.rs).length,
      promotores: z.reduce((t, x) => t + x.promotores, 0),
      promotoresMeta: totalSecciones.reduce((t, s) => t + s.promotoresMeta, 0),
      promovidos,
      meta: metaTotal,
      hoy: total[total.length - 1],
      semana,
      semanaAnterior: total.slice(-14, -7).reduce((t, v) => t + v, 0),
    },
    ritmo: {
      promedio7d: Math.round(promedio7d),
      necesario: diasRestantes ? Math.ceil(faltan / diasRestantes) : faltan,
      faltan,
      proyeccion,
    },
    estatus: est,
    serie: { dias, total },
    zonas: z,
    material: mat,
    responsables: { total: rsAvance.length, mejores: ordenados.slice(0, 5), rezagados: ordenados.slice(-5).reverse() },
    // Para el mapa: sección, zona, electores, meta, promovidos y si tiene responsable
    secciones: totalSecciones.map((s) => ({ c: s.c, z: s.z, e: s.e, m: s.meta, p: s.p, rs: s.rs })),
  };
}

module.exports = { cpv };
