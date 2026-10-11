// Responsables de Sección: el Coordinador de Zona reparte las secciones de su zona.
// Reglas:
//  - Solo secciones de la zona del coordinador; cada responsable tiene una sola sección.
//  - Cada sección puede tener un solo Responsable de Sección.
const geo = require('./geo');
const padron = require('./padron');
const { users } = require('./store');

const responsablesDe = (zonaId) => users.all().filter((u) => u.parentId === zonaId && u.role === 'resp_seccion');

// Secciones de la zona con sus datos (municipio, distritos, electores)
function contexto(zona) {
  const t = zona.territorio;
  if (!t || t.tipo !== 'secciones' || !t.secciones?.length) return null;
  const state = geo.getState(t.entidad);
  if (!state) return null;
  const propias = new Set(t.secciones);
  const pad = padron.sectionsOf(state.meta.clave);
  return {
    entidad: { clave: state.meta.clave, nombre: state.meta.nombre },
    municipios: Object.fromEntries(state.catalog.municipios.map((m) => [m.clave, m.nombre])),
    secciones: state.catalog.secciones.filter((s) => propias.has(s.clave)),
    ln: (c) => (pad ? pad.get(c)?.ln || 0 : null),
    hasPadron: Boolean(pad),
  };
}

// Sección → responsable que la tiene (excepto `excludeId`, al editarlo)
function ocupadas(zonaId, excludeId = null) {
  const map = new Map();
  for (const r of responsablesDe(zonaId)) {
    if (r.id === excludeId) continue;
    for (const s of r.territorio?.secciones || []) map.set(s, r);
  }
  return map;
}

function opciones(zona, excludeId = null) {
  const ctx = contexto(zona);
  if (!ctx) return null;
  const taken = ocupadas(zona.id, excludeId);
  return {
    entidad: ctx.entidad,
    zona: { nombre: zona.zona?.nombre || '', codigo: zona.zona?.codigo || '', color: zona.zona?.color || null },
    hasPadron: ctx.hasPadron,
    municipios: ctx.municipios,
    secciones: ctx.secciones.map((s) => {
      const r = taken.get(s.clave);
      return {
        clave: s.clave,
        municipio: s.municipio,
        distritoLocal: s.distritoLocal,
        distritoFederal: s.distritoFederal,
        electores: ctx.ln(s.clave),
        responsable: r ? { id: r.id, name: r.name } : null,
      };
    }),
  };
}

function validar(zona, body, excludeId = null) {
  const ctx = contexto(zona);
  if (!ctx) return { errors: { territorio: 'Tu zona no tiene secciones asignadas; no puedes crear responsables.' } };
  const propias = new Set(ctx.secciones.map((s) => s.clave));
  const taken = ocupadas(zona.id, excludeId);
  const pedidas = [...new Set((Array.isArray(body.secciones) ? body.secciones : []).map(Number))].sort((a, b) => a - b);
  const errors = {};
  if (!pedidas.length) errors.territorio = 'Elige la sección.';
  else if (pedidas.length > 1) errors.territorio = 'Cada responsable puede tener una sola sección.';
  else if (pedidas.some((s) => !propias.has(s))) errors.territorio = 'Hay secciones fuera de tu zona.';
  else {
    const ocupada = pedidas.find((s) => taken.has(s));
    if (ocupada) errors.territorio = `La sección ${ocupada} ya tiene responsable (${taken.get(ocupada).name}).`;
  }
  return { errors, territorio: { entidad: ctx.entidad.clave, tipo: 'secciones', metodo: 'manual', secciones: pedidas } };
}

function resumen(zona) {
  const ctx = contexto(zona);
  const lista = responsablesDe(zona.id).map((r) => {
    const secs = r.territorio?.secciones || [];
    return {
      id: r.id,
      name: r.name,
      username: r.username || null,
      phone: r.phone || '',
      secciones: secs,
      electores: ctx?.hasPadron ? secs.reduce((t, s) => t + ctx.ln(s), 0) : null,
    };
  });
  lista.sort((a, b) => (a.secciones[0] ?? 1e9) - (b.secciones[0] ?? 1e9));
  if (!ctx) return { entidad: null, zona: zona.zona || null, responsables: lista, totales: null };
  const cubiertas = new Set(lista.flatMap((r) => r.secciones));
  const total = ctx.secciones.length;
  const electores = ctx.hasPadron ? ctx.secciones.reduce((t, s) => t + ctx.ln(s.clave), 0) : null;
  return {
    entidad: ctx.entidad,
    zona: zona.zona || null,
    responsables: lista,
    totales: {
      secciones: total,
      cubiertas: cubiertas.size,
      sinResponsable: total - cubiertas.size,
      electores,
      electoresCubiertos: ctx.hasPadron ? [...cubiertas].reduce((t, s) => t + ctx.ln(s), 0) : null,
    },
  };
}

module.exports = { responsablesDe, opciones, validar, resumen };
