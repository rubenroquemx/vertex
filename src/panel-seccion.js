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

module.exports = { resumen, avancePromotores };
