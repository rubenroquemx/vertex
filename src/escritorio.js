// Escritorio (dashboard) del Coordinador de Promoción del Voto: cifras agregadas de toda su
// estructura. Solo devuelve totales por zona; no expone las cuentas de niveles inferiores.
const { users, promovidos } = require('./store');
const zonas = require('./zonas');

const TZ = 'America/Mexico_City';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// Últimos 7 días (hoy incluido), en hora de la Ciudad de México
function ultimos7() {
  const hoy = new Date();
  return Array.from({ length: 7 }, (_, i) => dayKey(new Date(hoy.getTime() - (6 - i) * 86400000)));
}

function cpv(cpvUser) {
  const resumen = zonas.resumen(cpvUser);
  const ctx = zonas.contexto(cpvUser);
  const all = users.all();
  const hijos = new Map();
  for (const u of all) {
    if (!hijos.has(u.parentId)) hijos.set(u.parentId, []);
    hijos.get(u.parentId).push(u);
  }
  const of = (id, role) => (hijos.get(id) || []).filter((u) => u.role === role);

  const dias = ultimos7();
  const hoy = dias[6];
  const zonaDePromotor = new Map();
  const porZona = resumen.zonas.map((z) => {
    const responsables = of(z.id, 'resp_seccion');
    const promotores = responsables.flatMap((r) => of(r.id, 'promotor'));
    for (const p of promotores) zonaDePromotor.set(p.id, z.id);
    // Secciones de la zona que ya tienen Responsable de Sección asignado
    const propias = new Set(all.find((u) => u.id === z.id)?.territorio?.secciones || []);
    const cubiertas = new Set();
    for (const r of responsables) for (const s of r.territorio?.secciones || []) if (propias.has(s)) cubiertas.add(s);
    return {
      id: z.id,
      codigo: z.codigo,
      nombre: z.nombre,
      color: z.color,
      coordinador: z.coordinador.name,
      secciones: z.secciones,
      electores: z.electores,
      responsables: responsables.length,
      seccionesCubiertas: cubiertas.size,
      promotores: promotores.length,
      promovidos: 0,
      promovidos7d: 0,
      serie: dias.map(() => 0),
    };
  });

  const idx = new Map(porZona.map((z, i) => [z.id, i]));
  const zonaDeSeccion = new Map();
  for (const z of porZona) for (const sec of all.find((u) => u.id === z.id)?.territorio?.secciones || []) zonaDeSeccion.set(sec, z.id);
  const total = dias.map(() => 0);
  let totalPromovidos = 0;
  let promovidosHoy = 0;
  for (const p of promovidos.all()) {
    const zid = zonaDePromotor.get(p.promotorId);
    if (zid === undefined) continue;
    const z = porZona[idx.get(zid)];
    z.promovidos += 1;
    totalPromovidos += 1;
    const d = dias.indexOf(dayKey(new Date(p.createdAt)));
    if (d >= 0) {
      z.serie[d] += 1;
      z.promovidos7d += 1;
      total[d] += 1;
    }
    if (d === 6) promovidosHoy += 1;
  }

  return {
    entidad: resumen.entidad,
    totales: resumen.totales,
    kpis: {
      zonas: porZona.length,
      coordinadores: porZona.length,
      vacantes: resumen.totales ? resumen.totales.vacantes : 0,
      responsables: porZona.reduce((t, z) => t + z.responsables, 0),
      promotores: porZona.reduce((t, z) => t + z.promotores, 0),
      promovidos: totalPromovidos,
      promovidosHoy,
    },
    zonas: porZona,
    serie: { dias, hoy, total },
    // Sección → zona, para pintar el mapa del territorio
    secciones: ctx ? ctx.secciones.map((s) => ({ c: s.clave, z: zonaDeSeccion.get(s.clave) || null, e: ctx.ln(s.clave) })) : [],
  };
}

module.exports = { cpv };
