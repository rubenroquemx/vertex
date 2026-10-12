// Panel del Responsable de Sección: cuántos Promotores Territoriales debe tener en su sección,
// según el factor de conversión que configuró su Coordinador de Promoción del Voto (CPV).
const { users, promovidos: cachePromovidos } = require('./store');
const metas = require('./metas');
const responsables = require('./responsables');
const promovidos = require('./promovidos');

function resumen(resp) {
  const zona = users.get(resp.parentId);
  const cpv = zona ? users.get(zona.parentId) : null;
  const ctx = zona ? responsables.contexto(zona) : null;
  const cfg = cpv ? metas.configDe(cpv) : { ...metas.DEFAULTS };
  const registrados = users.all().filter((u) => u.parentId === resp.id && u.role === 'promotor').length;
  const claves = resp.territorio?.secciones || [];
  const secciones = ctx
    ? ctx.secciones
        .filter((s) => claves.includes(s.clave))
        .map((s) => {
          const electores = ctx.ln(s.clave);
          const m = electores === null ? { meta: null, promotores: null } : metas.metaSeccion(electores, cfg);
          return { clave: s.clave, municipio: ctx.municipios[s.municipio] || `Municipio ${s.municipio}`, electores, ...m };
        })
    : [];
  const sum = (k) => (secciones.some((s) => s[k] === null) ? null : secciones.reduce((t, s) => t + s[k], 0));
  return {
    zona: zona ? { nombre: zona.zona?.nombre || zona.name, codigo: zona.zona?.codigo || '' } : null,
    config: cfg,
    hasPadron: Boolean(ctx?.hasPadron),
    secciones,
    electores: sum('electores'),
    meta: sum('meta'),
    promotores: sum('promotores'),
    registrados,
    promovidos: promovidos.contarDeResponsable(resp.id),
  };
}

// Avance de cada Promotor Territorial hacia su meta de promovidos (el factor de conversión del CPV)
function avancePromotores(resp) {
  const zona = users.get(resp.parentId);
  const cpv = zona ? users.get(zona.parentId) : null;
  const { factor } = cpv ? metas.configDe(cpv) : metas.DEFAULTS;
  const porPromotor = {};
  for (const p of cachePromovidos.all()) {
    if (p.responsableId !== resp.id) continue;
    const a = (porPromotor[p.promotorId] ||= { capturados: 0, aprobados: 0 });
    a.capturados += 1;
    if (p.estatus === 'validado') a.aprobados += 1;
  }
  return { meta: factor, porPromotor };
}

// --- Escritorio del Responsable de Sección -------------------------------------------
const { query } = require('./db');
const TZ = 'America/Mexico_City';
const DIAS_SERIE = 30;
const ELECCION = new Date('2027-06-06T08:00:00-06:00');
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

async function escritorio(resp) {
  const r = resumen(resp);
  const s = r.secciones[0] || null;
  const zona = users.get(resp.parentId);
  const promotores = users
    .all()
    .filter((u) => u.parentId === resp.id && u.role === 'promotor')
    .map((u) => ({ id: u.id, name: u.name, phone: u.phone || '', promovidos: 0, aprobados: 0, porRevisar: 0, rechazados: 0, ultima: null, serie: null }));
  const porId = new Map(promotores.map((p) => [p.id, p]));

  const hoy = new Date();
  const dias = Array.from({ length: DIAS_SERIE }, (_, i) => FMT_DIA.format(new Date(hoy.getTime() - (DIAS_SERIE - 1 - i) * 86400000)));
  const idx = new Map(dias.map((d, i) => [d, i]));
  for (const p of promotores) p.serie = dias.map(() => 0);

  const [prom, serie, mat, siguiente] = await Promise.all([
    query(
      `SELECT p.promotor_id AS pr, p.estatus,
              (p.estatus = 'en_revision' AND EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id)) AS obs,
              count(*)::int AS n,
              count(*) FILTER (WHERE p.estatus = 'en_revision' AND p.created_at < now() - interval '3 days')::int AS viejos,
              max(p.created_at) AS ultima
       FROM promovidos p WHERE p.responsable_id = $1 GROUP BY 1, 2, 3`,
      [resp.id]
    ),
    query(
      `SELECT p.promotor_id AS pr, to_char(p.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS dia, count(*)::int AS n
       FROM promovidos p WHERE p.responsable_id = $1 AND p.created_at >= now() - ($3 || ' days')::interval GROUP BY 1, 2`,
      [resp.id, TZ, String(DIAS_SERIE + 1)]
    ),
    query(
      `SELECT id, estado, (SELECT count(*)::int FROM material_evidencias ev WHERE ev.orden_id = o.id) AS fotos
       FROM material_ordenes o WHERE para_id = $1 ORDER BY created_at`,
      [resp.id]
    ),
    promovidos.siguientePendiente(resp.id),
  ]);

  const est = { aprobados: 0, revision: 0, observaciones: 0, rechazados: 0, viejos: 0 };
  for (const x of prom.rows) {
    const p = porId.get(x.pr);
    if (p) {
      p.promovidos += x.n;
      if (x.estatus === 'validado') p.aprobados += x.n;
      if (x.estatus === 'en_revision') p.porRevisar += x.n;
      if (x.estatus === 'rechazado') p.rechazados += x.n;
      if (!p.ultima || x.ultima > p.ultima) p.ultima = x.ultima;
    }
    if (x.estatus === 'validado') est.aprobados += x.n;
    else if (x.estatus === 'rechazado') est.rechazados += x.n;
    else if (x.obs) est.observaciones += x.n;
    else est.revision += x.n;
    est.viejos += x.viejos;
  }
  const total = dias.map(() => 0);
  for (const x of serie.rows) {
    const i = idx.get(x.dia);
    if (i === undefined) continue;
    total[i] += x.n;
    const p = porId.get(x.pr);
    if (p) p.serie[i] += x.n;
  }
  const material = { porRecibir: [], sinEvidencia: [], conEvidencia: 0, total: mat.rows.length };
  for (const o of mat.rows) {
    if (o.estado === 'pendiente') material.porRecibir.push(o.id);
    else if (o.estado === 'recibida') material.sinEvidencia.push(o.id);
    else material.conEvidencia += 1;
  }

  const meta = s?.meta || 0;
  const capturados = est.aprobados + est.revision + est.observaciones + est.rechazados;
  const semana = total.slice(-7).reduce((t, v) => t + v, 0);
  const diasRestantes = Math.max(0, Math.ceil((ELECCION - Date.now()) / 86400000));
  const promedio7d = semana / 7;
  const faltan = Math.max(0, meta - capturados);

  return {
    seccion: s ? { clave: s.clave, municipio: s.municipio, electores: s.electores } : null,
    zona: zona ? { nombre: zona.zona?.nombre || zona.name, codigo: zona.zona?.codigo || '', color: zona.zona?.color || '#2a78d6', coordinador: zona.name } : null,
    metaPorPromotor: r.config.factor,
    eleccion: { dias: diasRestantes },
    kpis: { meta, promovidos: capturados, promotores: promotores.length, promotoresMeta: s?.promotores || 0, hoy: total[total.length - 1], semana, semanaAnterior: total.slice(-14, -7).reduce((t, v) => t + v, 0) },
    ritmo: {
      promedio7d: Math.round(promedio7d * 10) / 10,
      necesario: diasRestantes ? Math.ceil(faltan / diasRestantes) : faltan,
      faltan,
      proyeccion: promedio7d > 0 && faltan > 0 ? new Date(Date.now() + (faltan / promedio7d) * 86400000).toISOString() : null,
    },
    estatus: est,
    siguiente,
    serie: { dias, total },
    material,
    promotores: promotores.map((p) => ({ ...p, ultima: p.ultima ? p.ultima.toISOString() : null })),
  };
}

module.exports = { resumen, avancePromotores, escritorio };
