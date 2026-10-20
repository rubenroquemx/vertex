// Informe por periodo de cada nivel (SA, CPV, Coordinador de Zona, Responsable de Sección y
// Promotor Territorial): cifras del periodo contra el anterior, avance acumulado contra la meta,
// revisión, material, desempeño de cada unidad a cargo y un análisis FODA con acciones sugeridas.
// Solo cifras agregadas: nunca datos personales de promovidos.
const { query } = require('./db');
const { users } = require('./store');
const panelSa = require('./panel-sa');
const escritorio = require('./escritorio');
const escritorioZona = require('./escritorio-zona');
const panelSeccion = require('./panel-seccion');
const escritorioPromotor = require('./escritorio-promotor');

const TZ = 'America/Mexico_City';
const ELECCION = require('./eleccion').fecha;
const DIA = 86400000;
const MAX_DIAS = 366;
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const FMT_LARGO = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const DIAS_SEMANA = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

class InformeError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const hoyKey = () => FMT_DIA.format(new Date());
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && FMT_DIA.format(new Date(`${s}T12:00:00Z`)) === s;
const sumarDias = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);
// Fin del día `key` en la hora del centro (sin horario de verano desde 2022)
const finDe = (key) => new Date(Date.parse(`${key}T00:00:00-06:00`) + DIA);
const largo = (key) => FMT_LARGO.format(new Date(`${key}T12:00:00Z`));
const n = (v) => Math.round(v).toLocaleString('es-MX');
const dec = (v) => (v < 10 && v % 1 ? v.toLocaleString('es-MX', { maximumFractionDigits: 1 }) : n(v));
const pc = (v) => `${v > 0 && v < 0.01 ? (v * 100).toFixed(1) : n(v * 100)}%`;
const lista = (nombres, max = 3) => (nombres.length > max ? `${nombres.slice(0, max).join(', ')} y ${nombres.length - max} más` : nombres.join(', ').replace(/, ([^,]*)$/, ' y $1'));
const plural = (k, s, p) => (k === 1 ? s : p);

function validar({ desde, hasta } = {}) {
  const fields = {};
  if (!esFecha(desde)) fields.desde = 'Elige la fecha de inicio.';
  if (!esFecha(hasta)) fields.hasta = 'Elige la fecha de fin.';
  if (!Object.keys(fields).length) {
    if (hasta > hoyKey()) fields.hasta = 'La fecha de fin no puede ser posterior a hoy.';
    else if (desde > hasta) fields.desde = 'La fecha de inicio debe ser anterior a la de fin.';
    else if (diasEntre(desde, hasta) + 1 > MAX_DIAS) fields.desde = `El periodo puede abarcar hasta ${MAX_DIAS} días.`;
  }
  if (Object.keys(fields).length) throw new InformeError('Revisa el periodo del informe.', 422, fields);
}

// ---------------------------------------------------------------------------
// Alcance de cada nivel: unidades a cargo, metas vigentes y filtros de consulta
// ---------------------------------------------------------------------------
function hijosDe(id, role) {
  return users.hijos(id, role);
}

async function alcance(user) {
  const role = user.role;
  if (role === 'superadmin') {
    const d = await panelSa.resumen();
    const grupo = new Map();
    for (const c of d.cpvs) for (const z of hijosDe(c.id, 'coord_zona')) for (const r of hijosDe(z.id, 'resp_seccion')) grupo.set(r.id, c.id);
    const t = d.totales;
    return {
      rol: 'sa',
      nivel: 'Super administrador',
      titulo: 'Todo el sistema',
      unidad: { singular: 'CPV', plural: 'CPV', rezagados: 'CPV rezagados', columna: 'Coordinador de Promoción del Voto' },
      unidades: d.cpvs.map((c) => ({ id: c.id, nombre: c.name, detalle: c.territorio?.nombre || '', meta: c.meta || 0, promotores: c.promotores })),
      grupo,
      porPromotor: false,
      filtro: { sql: 'p.responsable_id = ANY($1::uuid[])', valor: [...grupo.keys()] },
      material: { sql: '$1::uuid IS NULL', valor: null },
      totales: { meta: t.meta, promotores: t.promotores, promotoresMeta: t.promotoresMeta, secciones: t.secciones, cubiertas: t.seccionesCubiertas },
    };
  }
  if (role === 'coord_promocion') {
    const d = await escritorio.cpv(user);
    if (!d.entidad) throw new InformeError('Aún no tienes territorio ni zonas para generar un informe.', 409);
    const grupo = new Map();
    for (const z of d.zonas) for (const r of hijosDe(z.id, 'resp_seccion')) grupo.set(r.id, z.id);
    const k = d.kpis;
    return {
      rol: 'cpv',
      nivel: 'Coordinador de Promoción del Voto',
      titulo: `Estructura de ${user.name}`,
      unidad: { singular: 'zona', plural: 'zonas', rezagados: 'Zonas rezagadas', columna: 'Zona' },
      unidades: d.zonas.map((z) => ({ id: z.id, nombre: `${z.codigo} · ${z.nombre}`, detalle: z.coordinador, meta: z.meta, promotores: z.promotores })),
      grupo,
      porPromotor: false,
      filtro: { sql: 'p.responsable_id = ANY($1::uuid[])', valor: [...grupo.keys()] },
      material: { sql: 'o.cpv_id = $1', valor: user.id },
      totales: { meta: k.meta, promotores: k.promotores, promotoresMeta: k.promotoresMeta, secciones: k.secciones, cubiertas: k.seccionesCubiertas },
    };
  }
  if (role === 'coord_zona') {
    const d = await escritorioZona.zona(user);
    if (!d.entidad) throw new InformeError('Aún no tienes secciones asignadas para generar un informe.', 409);
    const k = d.kpis;
    return {
      rol: 'cz',
      nivel: 'Coordinador de Zona',
      titulo: `Zona ${[d.zona.codigo, d.zona.nombre].filter(Boolean).join(' · ')}`,
      unidad: { singular: 'responsable', plural: 'responsables', rezagados: 'Responsables rezagados', columna: 'Responsable de Sección' },
      unidades: d.responsables.map((r) => ({
        id: r.id,
        nombre: r.name,
        detalle: r.seccion !== null ? `Sección ${String(r.seccion).padStart(4, '0')}` : 'Sin sección',
        meta: r.meta,
        promotores: r.promotores,
      })),
      grupo: new Map(d.responsables.map((r) => [r.id, r.id])),
      porPromotor: false,
      filtro: { sql: 'p.responsable_id = ANY($1::uuid[])', valor: d.responsables.map((r) => r.id) },
      material: { sql: '(o.de_id = $1 OR o.para_id = $1)', valor: user.id },
      totales: { meta: k.meta, promotores: k.promotores, promotoresMeta: k.promotoresMeta, secciones: k.secciones, cubiertas: k.seccionesCubiertas },
      vacantes: d.vacantes,
    };
  }
  if (role === 'resp_seccion') {
    const d = await panelSeccion.escritorio(user);
    if (!d.seccion) throw new InformeError('Aún no tienes sección asignada para generar un informe.', 409);
    const k = d.kpis;
    return {
      rol: 'rs',
      nivel: 'Responsable de Sección',
      titulo: `Sección ${String(d.seccion.clave).padStart(4, '0')} · ${d.seccion.municipio}`,
      unidad: { singular: 'promotor', plural: 'promotores', rezagados: 'Promotores rezagados', columna: 'Promotor Territorial' },
      unidades: d.promotores.map((p) => ({ id: p.id, nombre: p.name, detalle: '', meta: d.metaPorPromotor, promotores: 1 })),
      grupo: new Map(d.promotores.map((p) => [p.id, p.id])),
      porPromotor: true,
      filtro: { sql: 'p.responsable_id = $1', valor: user.id },
      material: { sql: 'o.para_id = $1', valor: user.id },
      totales: { meta: k.meta, promotores: k.promotores, promotoresMeta: k.promotoresMeta, secciones: null, cubiertas: null },
    };
  }
  if (role === 'promotor') {
    const d = await escritorioPromotor.promotor(user);
    return {
      rol: 'pt',
      nivel: 'Promotor Territorial',
      titulo: user.name,
      unidad: null,
      unidades: [],
      grupo: new Map(),
      porPromotor: true,
      filtro: { sql: 'p.promotor_id = $1', valor: user.id },
      material: null,
      totales: { meta: d.meta, promotores: null, promotoresMeta: null, secciones: null, cubiertas: null },
      promotor: { lugar: d.lugar, corregir: d.corregir.length, porSemana: d.porSemana },
    };
  }
  throw new InformeError('Tu nivel no tiene informes.', 403);
}

// Primera captura de la estructura (para el atajo «Desde el inicio»)
async function inicio(user) {
  const a = await alcance(user);
  const r = await query(`SELECT to_char(min(p.created_at) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS primera FROM promovidos p WHERE ${a.filtro.sql}`, [a.filtro.valor]);
  return { primera: r.rows[0].primera, hoy: hoyKey(), maxDias: MAX_DIAS };
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------
async function generar(user, periodo) {
  validar(periodo);
  const { desde, hasta } = periodo;
  const a = await alcance(user);
  const B = `WITH b AS (SELECT ($2::date)::timestamp AT TIME ZONE '${TZ}' AS ini, ($3::date + 1)::timestamp AT TIME ZONE '${TZ}' AS fin)`;
  const P = [a.filtro.valor, desde, hasta];
  const [base, serie, motivos, material, primera] = await Promise.all([
    query(
      `${B}
       SELECT p.responsable_id AS rs, p.promotor_id AS pr,
              count(*) FILTER (WHERE p.created_at >= b.ini AND p.created_at < b.fin)::int AS capturados,
              count(*) FILTER (WHERE p.created_at < b.fin)::int AS acumulado,
              count(*) FILTER (WHERE p.created_at >= b.ini - (b.fin - b.ini) AND p.created_at < b.ini)::int AS anterior,
              count(*) FILTER (WHERE p.estatus = 'validado' AND p.revisado_at >= b.ini AND p.revisado_at < b.fin)::int AS aprobados,
              count(*) FILTER (WHERE p.estatus = 'rechazado' AND p.revisado_at >= b.ini AND p.revisado_at < b.fin)::int AS rechazados,
              COALESCE(sum(EXTRACT(EPOCH FROM p.revisado_at - p.created_at)) FILTER (WHERE p.estatus <> 'en_revision' AND p.revisado_at >= b.ini AND p.revisado_at < b.fin), 0)::float AS seg,
              count(*) FILTER (WHERE p.estatus = 'en_revision')::int AS en_revision,
              count(*) FILTER (WHERE p.estatus = 'en_revision' AND p.created_at < now() - interval '3 days')::int AS viejos
       FROM promovidos p, b WHERE ${a.filtro.sql} GROUP BY 1, 2`,
      P
    ),
    query(
      `${B}
       SELECT to_char(p.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS dia, count(*)::int AS n
       FROM promovidos p, b WHERE ${a.filtro.sql} AND p.created_at >= b.ini AND p.created_at < b.fin GROUP BY 1`,
      P
    ),
    query(
      `${B}
       SELECT CASE WHEN o.texto ILIKE 'Rechazado: INE no vigente%' THEN 'INE no vigente'
                   WHEN o.texto ILIKE 'Rechazado: Secci_n inv_lida%' THEN 'Sección inválida'
                   ELSE 'Otro motivo' END AS motivo, count(*)::int AS n
       FROM promovido_observaciones o JOIN promovidos p ON p.id = o.promovido_id, b
       WHERE ${a.filtro.sql} AND o.texto LIKE 'Rechazado:%' AND o.at >= b.ini AND o.at < b.fin GROUP BY 1 ORDER BY 2 DESC`,
      P
    ),
    a.material
      ? query(
          `${B}
           SELECT count(*) FILTER (WHERE o.created_at >= b.ini AND o.created_at < b.fin)::int AS creadas,
                  COALESCE(sum((SELECT sum(i.cantidad) FROM material_orden_items i WHERE i.orden_id = o.id)) FILTER (WHERE o.created_at >= b.ini AND o.created_at < b.fin), 0)::int AS unidades,
                  count(*) FILTER (WHERE o.recibida_at >= b.ini AND o.recibida_at < b.fin)::int AS recibidas,
                  count(*) FILTER (WHERE o.comprobada_at >= b.ini AND o.comprobada_at < b.fin)::int AS comprobadas,
                  avg(EXTRACT(EPOCH FROM o.recibida_at - o.created_at)) FILTER (WHERE o.recibida_at >= b.ini AND o.recibida_at < b.fin)::float AS seg_recibir,
                  count(*) FILTER (WHERE o.estado = 'pendiente')::int AS pendientes,
                  count(*) FILTER (WHERE o.estado = 'recibida')::int AS sin_evidencia
           FROM material_ordenes o, b WHERE ${a.material.sql}`,
          [a.material.valor, desde, hasta]
        )
      : null,
    query(`SELECT to_char(min(p.created_at) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS dia FROM promovidos p WHERE ${a.filtro.sql}`, [a.filtro.valor]),
  ]);

  // ---- Totales y unidades
  const tot = { capturados: 0, acumulado: 0, anterior: 0, aprobados: 0, rechazados: 0, seg: 0, enRevision: 0, viejos: 0 };
  const activos = new Set();
  const porUnidad = new Map(a.unidades.map((u) => [u.id, { ...u, capturados: 0, acumulado: 0, aprobados: 0, rechazados: 0, activos: new Set() }]));
  for (const r of base.rows) {
    tot.capturados += r.capturados;
    tot.acumulado += r.acumulado;
    tot.anterior += r.anterior;
    tot.aprobados += r.aprobados;
    tot.rechazados += r.rechazados;
    tot.seg += r.seg;
    tot.enRevision += r.en_revision;
    tot.viejos += r.viejos;
    if (r.capturados && r.pr) activos.add(r.pr);
    const u = porUnidad.get(a.grupo.get(a.porPromotor ? r.pr : r.rs));
    if (!u) continue;
    u.capturados += r.capturados;
    u.acumulado += r.acumulado;
    u.aprobados += r.aprobados;
    u.rechazados += r.rechazados;
    if (r.capturados && r.pr) u.activos.add(r.pr);
  }
  const unidades = [...porUnidad.values()].map((u) => ({
    nombre: u.nombre,
    detalle: u.detalle,
    meta: u.meta,
    capturados: u.capturados,
    acumulado: u.acumulado,
    avance: u.meta ? u.acumulado / u.meta : null,
    aprobados: u.aprobados,
    rechazados: u.rechazados,
    activos: u.activos.size,
    promotores: u.promotores,
  }));

  // ---- Serie diaria del periodo. Si la estructura empezó a capturar dentro del periodo, el ritmo y la
  // serie se miden desde su primera captura (los días previos no cuentan como días sin captura).
  const pedido = diasEntre(desde, hasta) + 1;
  const primeraCaptura = primera.rows[0].dia;
  const inicio = primeraCaptura && primeraCaptura > desde && primeraCaptura <= hasta ? primeraCaptura : desde;
  const len = diasEntre(inicio, hasta) + 1;
  const dias = Array.from({ length: len }, (_, i) => sumarDias(inicio, i));
  const porDia = new Map(serie.rows.map((r) => [r.dia, r.n]));
  const total = dias.map((d) => porDia.get(d) || 0);

  // ---- Indicadores
  const t = a.totales;
  const fin = finDe(hasta);
  const diasEleccion = Math.max(0, Math.ceil((ELECCION - fin) / DIA));
  const faltan = Math.max(0, (t.meta || 0) - tot.acumulado);
  const ritmo = tot.capturados / len;
  const necesario = diasEleccion ? faltan / diasEleccion : faltan;
  const llegada = ritmo > 0 && faltan > 0 ? new Date(fin.getTime() + (faltan / ritmo) * DIA) : null;
  const revisados = tot.aprobados + tot.rechazados;
  const kpis = {
    capturados: tot.capturados,
    anterior: tot.anterior,
    variacion: tot.anterior ? (tot.capturados - tot.anterior) / tot.anterior : null,
    acumulado: tot.acumulado,
    meta: t.meta || 0,
    avance: t.meta ? tot.acumulado / t.meta : null,
    faltan,
    ritmo,
    necesario,
    llegada: llegada ? llegada.toISOString() : null,
    llegaATiempo: faltan === 0 || (llegada !== null && llegada <= ELECCION),
    diasEleccion,
    aprobados: tot.aprobados,
    rechazados: tot.rechazados,
    tasaRechazo: revisados ? tot.rechazados / revisados : null,
    horasRevision: revisados ? tot.seg / revisados / 3600 : null,
    enRevision: tot.enRevision,
    viejos: tot.viejos,
    promotores: t.promotores,
    promotoresMeta: t.promotoresMeta,
    activos: activos.size,
    secciones: t.secciones,
    cubiertas: t.cubiertas,
  };
  const m = material?.rows[0] || null;
  const mat = m
    ? {
        creadas: m.creadas,
        unidades: m.unidades,
        recibidas: m.recibidas,
        comprobadas: m.comprobadas,
        horasRecibir: m.seg_recibir === null ? null : m.seg_recibir / 3600,
        pendientes: m.pendientes,
        sinEvidencia: m.sin_evidencia,
      }
    : null;

  const ctx = { a, kpis, unidades, dias, total, len, motivos: motivos.rows, mat, revisados };
  const foda = analizar(ctx);
  return {
    generado: new Date().toISOString(),
    por: user.name,
    periodo: { desde, hasta, dias: pedido, inicio, diasMedidos: len, anterior: { desde: sumarDias(desde, -pedido), hasta: sumarDias(desde, -1) } },
    ambito: { nivel: a.nivel, titulo: a.titulo },
    unidad: a.unidad,
    kpis,
    serie: { dias, total },
    motivos: motivos.rows,
    material: mat,
    unidades: unidades.sort((x, y) => (y.avance ?? -1) - (x.avance ?? -1) || y.capturados - x.capturados),
    foda,
    acciones: [...foda.amenazas, ...foda.debilidades, ...foda.oportunidades].filter((x) => x.accion).slice(0, 5).map((x) => x.accion),
    resumen: resumir(ctx, desde, hasta, pedido),
  };
}

function resumir({ kpis: k }, desde, hasta, len) {
  const partes = [];
  partes.push(
    `Del ${largo(desde)} al ${largo(hasta)} (${n(len)} ${plural(len, 'día', 'días')}) se capturaron ${n(k.capturados)} promovidos` +
      (k.variacion !== null ? `, ${k.variacion >= 0 ? `${pc(k.variacion)} más` : `${pc(-k.variacion)} menos`} que en el periodo anterior.` : '.')
  );
  if (k.meta) partes.push(`Al cierre del periodo el avance era de ${n(k.acumulado)} de ${n(k.meta)} (${pc(k.avance)} de la meta).`);
  if (k.meta && k.faltan === 0) partes.push('La meta ya estaba cumplida.');
  else if (k.meta && k.ritmo === 0) partes.push('Sin capturas en el periodo no hay proyección de llegada a la meta.');
  else if (k.meta)
    partes.push(
      k.llegaATiempo
        ? `Al ritmo del periodo (${dec(k.ritmo)} al día) la meta se alcanzaría el ${FMT_LARGO.format(new Date(k.llegada))}, antes de la elección.`
        : `Al ritmo del periodo (${dec(k.ritmo)} al día) la meta no se alcanza antes de la elección: se necesitan ${dec(k.necesario)} al día.`
    );
  return partes.join(' ');
}

// ---------------------------------------------------------------------------
// FODA: reglas sobre las cifras del periodo. Cada punto lleva su dato y, cuando aplica, una acción.
// ---------------------------------------------------------------------------
function analizar({ a, kpis: k, unidades, dias, total, len, motivos, mat, revisados }) {
  const F = [];
  const O = [];
  const D = [];
  const A = [];
  const u = a.unidad;
  // Acción en la voz de cada nivel: `voz({ rs: '…', pt: '…' }, 'genérica')`
  const voz = (porRol, otra) => porRol[a.rol] ?? otra;
  const conMeta = unidades.filter((x) => x.meta > 0);
  const avanceGeneral = k.avance ?? 0;
  const inactivosPromotores = k.promotores !== null ? Math.max(0, k.promotores - k.activos) : 0;
  const porActivoDia = k.activos ? k.capturados / k.activos / len : 0;

  // --- Ritmo y meta
  if (k.meta && k.faltan === 0) F.push({ titulo: 'Meta cumplida', texto: `Al cierre del periodo se tenían ${n(k.acumulado)} promovidos de una meta de ${n(k.meta)}.` });
  else if (k.meta && k.capturados && k.ritmo >= k.necesario)
    F.push({ titulo: 'Ritmo suficiente', texto: `Se capturaron ${dec(k.ritmo)} promovidos al día; para llegar a la meta se necesitan ${dec(k.necesario)}.` });
  else if (k.meta && k.faltan)
    D.push({
      titulo: 'Ritmo insuficiente',
      texto: `Se capturaron ${dec(k.ritmo)} promovidos al día, ${pc(k.necesario ? k.ritmo / k.necesario : 0)} de los ${dec(k.necesario)} que se necesitan.`,
      accion: `Subir la captura a ${dec(Math.ceil(k.necesario))} promovidos al día para llegar a la meta antes de la elección.`,
    });
  if (k.meta && k.faltan) {
    if (!k.capturados)
      A.push({ titulo: 'Captura detenida', texto: `No hubo capturas en el periodo y faltan ${n(k.faltan)} promovidos para la meta.`, accion: 'Reactivar la captura de inmediato con toda la estructura.' });
    else if (!k.llegaATiempo)
      A.push({
        titulo: 'La meta no se alcanza a tiempo',
        texto: `Al ritmo del periodo la meta se alcanzaría el ${FMT_LARGO.format(new Date(k.llegada))}, después de la elección.`,
      });
    if (k.diasEleccion <= 90)
      A.push({ titulo: 'Poco tiempo', texto: `Quedaban ${n(k.diasEleccion)} días para la elección al cierre del periodo y faltaban ${n(k.faltan)} promovidos.` });
  }

  // --- Comparación con el periodo anterior y tendencia dentro del periodo
  if (k.variacion !== null && k.variacion >= 0.1)
    F.push({ titulo: 'Crecimiento', texto: `${pc(k.variacion)} más capturas que en el periodo anterior (${n(k.anterior)} → ${n(k.capturados)}).` });
  if (k.variacion !== null && k.variacion <= -0.1)
    D.push({
      titulo: 'Menos capturas que el periodo anterior',
      texto: `${pc(-k.variacion)} menos (${n(k.anterior)} → ${n(k.capturados)}).`,
      accion: voz(
        { pt: 'Retomar el ritmo del periodo anterior con una cuota diaria fija.', rs: 'Revisar con tus promotores qué cambió respecto al periodo anterior.' },
        'Revisar con los niveles a cargo qué cambió respecto al periodo anterior.'
      ),
    });
  if (len >= 6) {
    const mitad = Math.floor(len / 2);
    const s1 = total.slice(0, mitad).reduce((x, v) => x + v, 0);
    const s2 = total.slice(len - mitad).reduce((x, v) => x + v, 0);
    if (s1 >= 10 && s2 <= s1 * 0.8)
      A.push({
        titulo: 'Tendencia a la baja',
        texto: `En la segunda mitad del periodo se capturó ${pc((s1 - s2) / s1)} menos que en la primera (${n(s1)} → ${n(s2)}).`,
        accion: voz({ pt: 'Retomar el ritmo que tenías en la primera mitad del periodo.' }, 'Detener la caída antes de que se vuelva el ritmo normal: reunión de seguimiento con los niveles a cargo.'),
      });
    else if (s1 >= 10 && s2 >= s1 * 1.2) F.push({ titulo: 'Tendencia al alza', texto: `La segunda mitad del periodo capturó ${pc((s2 - s1) / s1)} más que la primera.` });
  }
  const sinCaptura = total.filter((v) => !v).length;
  if (k.capturados && len >= 7 && sinCaptura / len >= 0.3)
    D.push({ titulo: 'Días sin captura', texto: `${n(sinCaptura)} de ${n(len)} días no tuvieron ninguna captura.`, accion: 'Fijar una cuota diaria mínima para no dejar días en cero.' });

  // Mejor día de la semana (con al menos dos semanas de datos)
  if (len >= 14 && k.capturados) {
    const suma = Array(7).fill(0);
    const cuenta = Array(7).fill(0);
    dias.forEach((d, i) => {
      const w = new Date(`${d}T12:00:00Z`).getUTCDay();
      suma[w] += total[i];
      cuenta[w] += 1;
    });
    const prom = suma.map((s, w) => (cuenta[w] ? s / cuenta[w] : 0));
    const media = k.capturados / len;
    const mejor = prom.indexOf(Math.max(...prom));
    if (media && prom[mejor] >= media * 1.2)
      O.push({
        titulo: `Los ${DIAS_SEMANA[mejor]} rinden más`,
        texto: `En promedio se capturan ${dec(prom[mejor])} esos días, ${pc(prom[mejor] / media - 1)} más que el promedio diario.`,
        accion: voz({ pt: `Programar tus recorridos los ${DIAS_SEMANA[mejor]}.` }, `Concentrar brigadas y recorridos los ${DIAS_SEMANA[mejor]}.`),
      });
  }

  // --- Revisión
  if (revisados >= 10 && k.tasaRechazo <= 0.05) F.push({ titulo: 'Captura de calidad', texto: `Solo ${pc(k.tasaRechazo)} de ${n(revisados)} promovidos revisados fueron rechazados.` });
  if (revisados >= 5 && k.tasaRechazo >= 0.15) {
    const principal = motivos[0];
    D.push({
      titulo: 'Muchos rechazos',
      texto: `${pc(k.tasaRechazo)} de lo revisado se rechazó${principal ? `; motivo más frecuente: ${principal.motivo.toLowerCase()}` : ''}.`,
      accion: voz(
        { pt: 'Antes de guardar, verificar que la INE sea legible, esté vigente y sea de tu sección.', rs: 'Capacitar a tus promotores en la toma de la INE y la verificación de vigencia y sección.' },
        'Capacitar a los promotores en la toma de la INE y la verificación de vigencia y sección.'
      ),
    });
  }
  if (k.horasRevision !== null && k.horasRevision <= 24 && revisados >= 5)
    F.push({ titulo: 'Revisión ágil', texto: `Cada promovido se revisó en ${dec(k.horasRevision)} h en promedio desde su captura.` });
  if (k.horasRevision !== null && k.horasRevision > 72)
    D.push({
      titulo: 'Revisión lenta',
      texto: `La revisión tomó ${dec(k.horasRevision / 24)} días en promedio desde la captura.`,
      accion: voz(
        { rs: 'Revisar a diario lo que capturan tus promotores.', pt: 'Pedir a tu Responsable de Sección que revise tus registros pendientes.', cz: 'Pedir a tus Responsables de Sección revisar a diario lo capturado.' },
        'Pedir a los Responsables de Sección revisar a diario lo capturado.'
      ),
    });
  if (k.viejos)
    D.push({ titulo: 'Revisiones atrasadas', texto: `Hoy hay ${n(k.viejos)} ${plural(k.viejos, 'promovido', 'promovidos')} esperando revisión hace más de 3 días.` });
  if (k.enRevision) {
    const porDia = revisados / len;
    const diasCola = porDia ? k.enRevision / porDia : Infinity;
    if (diasCola > 7)
      A.push({
        titulo: 'Rezago de revisión',
        texto: porDia
          ? `Hay ${n(k.enRevision)} promovidos en revisión; al ritmo del periodo (${dec(porDia)} al día) tomaría ${n(diasCola)} días revisarlos.`
          : `Hay ${n(k.enRevision)} promovidos en revisión y no se revisó ninguno en el periodo.`,
        accion: voz(
          { rs: `Revisar los ${n(k.enRevision)} promovidos pendientes: aún no cuentan como aprobados.`, pt: `Pedir a tu Responsable de Sección que revise tus ${n(k.enRevision)} promovidos pendientes.` },
          `Liberar la revisión pendiente: ${n(k.enRevision)} promovidos aún no cuentan como aprobados.`
        ),
      });
    if (k.tasaRechazo !== null && k.tasaRechazo < 0.15 && diasCola <= 7)
      O.push({ titulo: 'Aprobaciones a la mano', texto: `${n(k.enRevision)} promovidos en revisión pueden sumarse a los aprobados con una revisión rápida.` });
  }
  const ine = motivos.find((x) => x.motivo === 'INE no vigente');
  const totalMotivos = motivos.reduce((s, x) => s + x.n, 0);
  if (ine && totalMotivos >= 5 && ine.n / totalMotivos >= 0.3)
    A.push({
      titulo: 'Credenciales vencidas',
      texto: `${pc(ine.n / totalMotivos)} de los rechazos con motivo fueron por INE no vigente: reduce la base de personas que se pueden promover.`,
      accion: 'Verificar la vigencia de la INE antes de capturar para no perder tiempo en registros que se rechazarán.',
    });

  // --- Unidades a cargo
  if (u && conMeta.length) {
    const orden = [...conMeta].sort((x, y) => y.avance - x.avance);
    const mejores = orden.filter((x) => x.avance > 0).slice(0, conMeta.length >= 6 ? 3 : 1);
    if (mejores.length)
      F.push({ titulo: mejores.length > 1 ? `Mejores ${u.plural}` : `Mejor ${u.singular}`, texto: `Avance contra su meta: ${lista(mejores.map((x) => `${x.nombre} (${pc(x.avance)})`))}.` });
    if (conMeta.length >= 3) {
      const rezagadas = orden.filter((x) => x.avance < avanceGeneral * 0.5).reverse();
      if (rezagadas.length)
        D.push({
          titulo: u.rezagados,
          texto: `${n(rezagadas.length)} con menos de la mitad del avance general (${pc(avanceGeneral)}): ${lista(rezagadas.map((x) => `${x.nombre} (${pc(x.avance)})`))}.`,
          accion: `Dar seguimiento personal a ${lista(rezagadas.map((x) => x.nombre), 2)}.`,
        });
    }
    const cerca = orden.filter((x) => x.avance >= 0.8 && x.avance < 1);
    if (cerca.length)
      O.push({
        titulo: 'Cerca de su meta',
        texto: `${n(cerca.length)} ${plural(cerca.length, u.singular, u.plural)} ya ${plural(cerca.length, 'pasa', 'pasan')} del 80%: ${lista(cerca.map((x) => `${x.nombre} (${pc(x.avance)})`))}.`,
        accion: `Empujar el cierre de ${lista(cerca.map((x) => x.nombre), 2)}: ${plural(cerca.length, 'le', 'les')} falta poco para cumplir.`,
      });
  }
  if (u && unidades.length) {
    const sinCapturas = unidades.filter((x) => !x.capturados);
    if (sinCapturas.length && sinCapturas.length < unidades.length)
      D.push({
        titulo: `Sin capturas en el periodo`,
        texto: `${n(sinCapturas.length)} de ${n(unidades.length)} ${u.plural}: ${lista(sinCapturas.map((x) => x.nombre))}.`,
        accion: `Contactar a ${lista(sinCapturas.map((x) => x.nombre), 2)} para reactivar su captura.`,
      });
    if (unidades.length >= 5 && k.capturados) {
      const orden = [...unidades].sort((x, y) => y.capturados - x.capturados);
      const top = Math.max(1, Math.ceil(unidades.length * 0.2));
      const share = orden.slice(0, top).reduce((s, x) => s + x.capturados, 0) / k.capturados;
      if (share >= 0.5)
        A.push({
          titulo: 'Avance concentrado',
          texto: `${n(top)} de ${n(unidades.length)} ${u.plural} ${plural(top, 'aporta', 'aportan')} ${pc(share)} de las capturas: si ${plural(top, 'falla', 'fallan')}, el avance se detiene.`,
          accion: 'Repartir la carga: que las unidades más fuertes acompañen a las rezagadas.',
        });
    }
  }

  // --- Estructura y cobertura
  if (k.promotores !== null && k.promotores > 0) {
    if (k.activos / k.promotores >= 0.8) F.push({ titulo: 'Estructura activa', texto: `${n(k.activos)} de ${n(k.promotores)} promotores capturaron en el periodo.` });
    if (inactivosPromotores && porActivoDia > 0 && a.unidad?.singular !== 'promotor')
      O.push({
        titulo: 'Promotores por reactivar',
        texto: `${n(inactivosPromotores)} promotores no capturaron en el periodo; con el promedio de los activos (${dec(porActivoDia)} al día cada uno) sumarían ${dec(inactivosPromotores * porActivoDia)} promovidos al día.`,
        accion: `Reactivar a los ${n(inactivosPromotores)} promotores sin capturas.`,
      });
    else if (inactivosPromotores && porActivoDia > 0)
      O.push({
        titulo: 'Promotores por reactivar',
        texto: `Si los ${n(inactivosPromotores)} promotores sin capturas aportaran como los activos, sumarían ${dec(inactivosPromotores * porActivoDia)} promovidos al día.`,
      });
  }
  if (k.promotoresMeta) {
    const faltanP = k.promotoresMeta - (k.promotores || 0);
    if (faltanP <= 0) F.push({ titulo: 'Estructura completa', texto: `Hay ${n(k.promotores)} promotores de ${n(k.promotoresMeta)} necesarios.` });
    else {
      O.push({
        titulo: 'Reclutar promotores',
        texto: `Faltan ${n(faltanP)} de ${n(k.promotoresMeta)} promotores necesarios${porActivoDia ? `; con el promedio actual sumarían ${dec(faltanP * porActivoDia)} promovidos al día` : ''}.`,
        accion: `Reclutar ${n(faltanP)} ${plural(faltanP, 'promotor', 'promotores')} más.`,
      });
      if ((k.promotores || 0) < k.promotoresMeta * 0.5)
        D.push({ titulo: 'Estructura incompleta', texto: `Solo hay ${pc((k.promotores || 0) / k.promotoresMeta)} de los promotores necesarios (${n(k.promotores || 0)} de ${n(k.promotoresMeta)}).` });
    }
  }
  if (k.secciones) {
    const vac = k.secciones - k.cubiertas;
    if (k.cubiertas / k.secciones >= 0.9) F.push({ titulo: 'Cobertura territorial', texto: `${n(k.cubiertas)} de ${n(k.secciones)} secciones tienen Responsable de Sección.` });
    if (vac > 0) {
      const metaVac = (a.vacantes || []).reduce((s, x) => s + (x.m || 0), 0);
      O.push({
        titulo: 'Secciones sin responsable',
        texto: `${n(vac)} ${plural(vac, 'sección no tiene', 'secciones no tienen')} Responsable de Sección${metaVac ? ` y suman una meta de ${n(metaVac)} promovidos` : ''}.`,
        accion: `Nombrar Responsable en ${n(vac)} ${plural(vac, 'sección', 'secciones')} vacantes.`,
      });
    }
  }

  // --- Material
  if (mat) {
    if (mat.recibidas && !mat.sinEvidencia && mat.comprobadas) F.push({ titulo: 'Material comprobado', texto: `${n(mat.comprobadas)} ${plural(mat.comprobadas, 'orden comprobada', 'órdenes comprobadas')} con fotos en el periodo y ninguna pendiente de evidencia.` });
    if (mat.sinEvidencia)
      D.push({
        titulo: 'Material sin evidencia',
        texto: `${n(mat.sinEvidencia)} ${plural(mat.sinEvidencia, 'orden recibida no tiene', 'órdenes recibidas no tienen')} sus fotos de entrega.`,
        accion: voz(
          { rs: 'Subir las 5 fotos de cada entrega de material recibida.', cz: 'Pedir a tus Responsables de Sección las 5 fotos de cada entrega pendiente.' },
          'Pedir a los Responsables de Sección las 5 fotos de cada entrega pendiente.'
        ),
      });
    if (mat.pendientes)
      A.push({
        titulo: 'Material sin confirmar',
        texto: `${n(mat.pendientes)} ${plural(mat.pendientes, 'orden de material no se ha confirmado como recibida', 'órdenes de material no se han confirmado como recibidas')}: riesgo de material extraviado.`,
        accion: voz({ rs: 'Confirmar «Recibido» en tus órdenes de material pendientes.' }, 'Confirmar con quien recibe las órdenes de material pendientes.'),
      });
  }

  // --- Promotor Territorial
  if (a.promotor) {
    const p = a.promotor;
    if (p.lugar?.de > 1 && p.lugar.posicion === 1) F.push({ titulo: 'Primer lugar', texto: `Vas en primer lugar entre los ${n(p.lugar.de)} promotores de tu sección.` });
    else if (p.lugar?.de > 1 && p.lugar.posicion > p.lugar.de / 2)
      D.push({ titulo: 'Debajo de la mitad de tu sección', texto: `Vas en el lugar ${n(p.lugar.posicion)} de ${n(p.lugar.de)} promotores de tu sección.` });
    if (p.corregir)
      D.push({ titulo: 'Registros por corregir', texto: `Tienes ${n(p.corregir)} ${plural(p.corregir, 'promovido', 'promovidos')} rechazados o con observaciones.`, accion: 'Corregir primero los promovidos rechazados u observados.' });
    if (k.faltan && p.porSemana) O.push({ titulo: 'Cuota semanal', texto: `Con ${n(p.porSemana)} promovidos por semana llegas a tu meta antes de la elección.`, accion: `Capturar al menos ${n(p.porSemana)} promovidos por semana.` });
  }

  const vacio = { titulo: 'Sin hallazgos', texto: 'Con las cifras de este periodo no hay puntos que destacar aquí.' };
  if (k.capturados && !F.length) F.push({ titulo: 'Captura en marcha', texto: `Se capturaron ${n(k.capturados)} promovidos en el periodo.` });
  for (const q of [F, O, D, A]) if (!q.length) q.push(vacio);
  return { fortalezas: F.slice(0, 6), oportunidades: O.slice(0, 6), debilidades: D.slice(0, 6), amenazas: A.slice(0, 6) };
}

module.exports = { generar, inicio, InformeError };
