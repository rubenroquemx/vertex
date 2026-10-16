// Panel del Super administrador: visión de todo el sistema, solo con cifras agregadas
// (nunca datos personales de promovidos).
const { query } = require('./db');
const { users } = require('./store');
const metas = require('./metas');
const territory = require('./territory');
const padron = require('./padron');
const whatsapp = require('./whatsapp');

const TZ = 'America/Mexico_City';
const DIAS_SERIE = 30;

// Acciones de la bitácora que se muestran como actividad (sin consultas de fichas ni PDFs)
const ACCIONES = {
  login: 'inició sesión',
  'user.create': 'creó una cuenta',
  'user.update': 'actualizó una cuenta',
  'user.delete': 'eliminó una rama de cuentas',
  'zona.create': 'creó una zona',
  'zona.update': 'actualizó una zona',
  'responsable.create': 'dio de alta un Responsable de Sección',
  'responsable.update': 'actualizó un Responsable de Sección',
  'promovido.create': 'capturó un promovido',
  'promovido.update': 'modificó un promovido',
  'promovido.aprobar': 'aprobó un promovido',
  'promovido.rechazar': 'rechazó un promovido',
  'config.update': 'cambió su factor de conversión',
  'material.articulo': 'agregó un artículo de material',
  'material.orden': 'creó una orden de entrega de material',
  'externa.carga': 'cargó una estructura externa',
  'externa.eliminar': 'eliminó una estructura externa',
  'settings.whatsapp': 'cambió la configuración de WhatsApp',
  'password.reset': 'restableció su contraseña',
  'god_mode.start': 'entró en modo dios',
};

const diaKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

async function resumen() {
  const all = users.all();
  const hijos = new Map();
  for (const u of all) {
    if (!hijos.has(u.parentId)) hijos.set(u.parentId, []);
    hijos.get(u.parentId).push(u);
  }
  const de = (id, role) => (hijos.get(id) || []).filter((u) => u.role === role);
  const cpvs = all.filter((u) => u.role === 'coord_promocion');

  // Promovidos por CPV y estatus (la cadena promotor → responsable → zona → CPV se resuelve en SQL)
  const [porEstatus, serie, material, actividad, sesiones] = await Promise.all([
    query(
      `SELECT z.parent_id AS cpv, p.estatus,
              (p.estatus = 'en_revision' AND EXISTS (SELECT 1 FROM promovido_observaciones o WHERE o.promovido_id = p.id AND o.user_id IS DISTINCT FROM p.promotor_id AND o.at > COALESCE((SELECT max(h.at) FROM promovido_historial h WHERE h.promovido_id = p.id AND h.user_id = p.promotor_id AND h.accion = 'editado'), '-infinity'::timestamptz))) AS obs,
              count(*)::int AS n, max(p.created_at) AS ultimo
       FROM promovidos p
       JOIN users pr ON pr.id = p.promotor_id JOIN users rs ON rs.id = pr.parent_id JOIN users z ON z.id = rs.parent_id
       GROUP BY 1, 2, 3`
    ),
    query(
      `SELECT z.parent_id AS cpv, to_char(p.created_at AT TIME ZONE $1, 'YYYY-MM-DD') AS dia, count(*)::int AS n
       FROM promovidos p
       JOIN users pr ON pr.id = p.promotor_id JOIN users rs ON rs.id = pr.parent_id JOIN users z ON z.id = rs.parent_id
       WHERE p.created_at >= now() - ($2 || ' days')::interval
       GROUP BY 1, 2`,
      [TZ, String(DIAS_SERIE + 1)]
    ),
    query(
      `SELECT o.cpv_id AS cpv, (o.de_id = o.cpv_id) AS del_cpv, o.estado, count(*)::int AS n,
              COALESCE(sum((SELECT sum(i.cantidad) FROM material_orden_items i WHERE i.orden_id = o.id)), 0)::int AS unidades
       FROM material_ordenes o GROUP BY 1, 2, 3`
    ),
    query(
      `SELECT action, by_user, as_user, at FROM audit WHERE action = ANY($1) ORDER BY at DESC LIMIT 14`,
      [Object.keys(ACCIONES)]
    ),
    query(
      `SELECT (SELECT count(DISTINCT user_id)::int FROM sessions WHERE expires_at > now()) AS activas,
              (SELECT count(DISTINCT by_user)::int FROM audit WHERE action = 'login' AND at > now() - interval '7 days') AS accesos7d,
              (SELECT COALESCE(sum(cantidad), 0)::int FROM material_entradas) AS inventario,
              (SELECT count(*)::int FROM material_evidencias) AS fotos`
    ),
  ]);

  // Días de la serie (hoy incluido)
  const hoy = new Date();
  const dias = Array.from({ length: DIAS_SERIE }, (_, i) => diaKey(new Date(hoy.getTime() - (DIAS_SERIE - 1 - i) * 86400000)));
  const idxDia = new Map(dias.map((d, i) => [d, i]));

  const fila = cpvs.map((cpv) => {
    const zonas = de(cpv.id, 'coord_zona');
    const responsables = zonas.flatMap((z) => de(z.id, 'resp_seccion'));
    const promotores = responsables.flatMap((r) => de(r.id, 'promotor'));
    const m = metas.resumen(cpv).territorio;
    const propias = new Set(zonas.flatMap((z) => z.territorio?.secciones || []));
    const cubiertas = new Set(responsables.flatMap((r) => (r.territorio?.secciones || []).filter((s) => propias.has(s))));
    const est = { aprobados: 0, revision: 0, observaciones: 0, rechazados: 0 };
    let ultimo = null;
    for (const r of porEstatus.rows.filter((x) => x.cpv === cpv.id)) {
      if (r.estatus === 'validado') est.aprobados += r.n;
      else if (r.estatus === 'rechazado') est.rechazados += r.n;
      else if (r.obs) est.observaciones += r.n;
      else est.revision += r.n;
      if (!ultimo || r.ultimo > ultimo) ultimo = r.ultimo;
    }
    const s = dias.map(() => 0);
    for (const r of serie.rows.filter((x) => x.cpv === cpv.id)) if (idxDia.has(r.dia)) s[idxDia.get(r.dia)] += r.n;
    const mat = { unidadesZonas: 0, ordenes: 0, pendientes: 0, sinEvidencia: 0, conEvidencia: 0 };
    for (const r of material.rows.filter((x) => x.cpv === cpv.id)) {
      if (r.del_cpv) mat.unidadesZonas += r.unidades;
      else {
        mat.ordenes += r.n;
        if (r.estado === 'pendiente') mat.pendientes += r.n;
        if (r.estado === 'recibida') mat.sinEvidencia += r.n;
        if (r.estado === 'comprobada') mat.conEvidencia += r.n;
      }
    }
    let terr = null;
    if (cpv.territorio) {
      const t = territory.resolve(cpv.territorio);
      terr = t.resumen ? { entidad: t.resumen.entidad, tipo: t.resumen.tipo, nombre: t.resumen.nombre } : null;
    }
    return {
      id: cpv.id,
      name: cpv.name,
      candidato: cpv.candidato || '',
      partidos: cpv.partidos || [],
      territorio: terr,
      zonas: zonas.length,
      responsables: responsables.length,
      promotores: promotores.length,
      promotoresMeta: m?.promotores ?? null,
      secciones: m?.secciones ?? propias.size,
      seccionesCubiertas: cubiertas.size,
      promovidos: est.aprobados + est.revision + est.observaciones + est.rechazados,
      meta: m?.meta ?? null,
      estatus: est,
      serie: s,
      material: mat,
      ultimaCaptura: ultimo ? ultimo.toISOString() : null,
    };
  });

  const suma = (k) => fila.reduce((t, c) => t + (c[k] || 0), 0);
  const sumaEst = (k) => fila.reduce((t, c) => t + c.estatus[k], 0);
  const sumaMat = (k) => fila.reduce((t, c) => t + c.material[k], 0);
  const total = dias.map((_, i) => fila.reduce((t, c) => t + c.serie[i], 0));
  const nombre = (id) => users.get(id)?.name || 'Cuenta eliminada';
  const sx = sesiones.rows[0];
  const pad = padron.summary();

  return {
    totales: {
      cpvs: cpvs.length,
      zonas: suma('zonas'),
      responsables: suma('responsables'),
      promotores: suma('promotores'),
      promotoresMeta: suma('promotoresMeta'),
      secciones: suma('secciones'),
      seccionesCubiertas: suma('seccionesCubiertas'),
      promovidos: suma('promovidos'),
      meta: suma('meta'),
      estatus: { aprobados: sumaEst('aprobados'), revision: sumaEst('revision'), observaciones: sumaEst('observaciones'), rechazados: sumaEst('rechazados') },
      hoy: total[total.length - 1],
      semana: total.slice(-7).reduce((t, v) => t + v, 0),
      semanaAnterior: total.slice(-14, -7).reduce((t, v) => t + v, 0),
    },
    serie: { dias, total },
    cpvs: fila.sort((a, b) => b.promovidos - a.promovidos),
    material: {
      inventario: sx.inventario,
      unidadesZonas: sumaMat('unidadesZonas'),
      ordenes: sumaMat('ordenes'),
      pendientes: sumaMat('pendientes'),
      sinEvidencia: sumaMat('sinEvidencia'),
      conEvidencia: sumaMat('conEvidencia'),
      fotos: sx.fotos,
    },
    sistema: {
      usuarios: all.filter((u) => u.role !== 'superadmin').length,
      sesionesActivas: sx.activas,
      accesos7d: sx.accesos7d,
      entidadesPadron: pad.states.length,
      whatsapp: whatsapp.listo(),
    },
    actividad: actividad.rows.map((r) => ({
      quien: nombre(r.by_user),
      como: r.as_user && r.as_user !== r.by_user ? nombre(r.as_user) : null,
      texto: ACCIONES[r.action],
      at: r.at.toISOString(),
    })),
  };
}

module.exports = { resumen };
