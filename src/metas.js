// Factor de conversión del CPV y metas por sección.
//   meta de promovidos     = ⌈ lista nominal × participación × conversión ⌉
//   promotores necesarios  = ⌈ meta de promovidos ÷ factor ⌉   (mínimo recomendado)
// Los valores aplican a todo el territorio del CPV; si cambian, las metas se recalculan al momento.
const zonas = require('./zonas');

const DEFAULTS = { participacion: 48, conversion: 60, factor: 20 };

const configDe = (cpv) => ({ ...DEFAULTS, ...(cpv.config || {}) });

// Evita errores de coma flotante al redondear hacia arriba (p. ej. 288.00000000000006 → 288)
const ceil = (x) => Math.ceil(x - 1e-9);

function metaSeccion(electores, cfg) {
  const meta = ceil((electores * cfg.participacion * cfg.conversion) / 10000);
  return { meta, promotores: meta ? ceil(meta / cfg.factor) : 0 };
}

function validar(body) {
  const errors = {};
  const n = (v) => Number(String(v ?? '').replace(',', '.'));
  const participacion = n(body.participacion);
  const conversion = n(body.conversion);
  const factor = n(body.factor);
  if (!(participacion > 0 && participacion <= 100)) errors.participacion = 'Escribe un porcentaje entre 1 y 100.';
  if (!(conversion > 0 && conversion <= 100)) errors.conversion = 'Escribe un porcentaje entre 1 y 100.';
  if (!(Number.isInteger(factor) && factor >= 1 && factor <= 1000)) errors.factor = 'Escribe un número entero entre 1 y 1,000.';
  return {
    errors,
    config: { participacion: Math.round(participacion * 10) / 10, conversion: Math.round(conversion * 10) / 10, factor },
  };
}

// Metas de todo el territorio del CPV, por zona y totales
function resumen(cpv, cfg = configDe(cpv)) {
  const ctx = zonas.contexto(cpv);
  if (!ctx || !ctx.hasPadron) return { config: cfg, territorio: null, zonas: [] };
  const zonaDeSeccion = new Map();
  const res = zonas.resumen(cpv);
  for (const z of zonas.zonasDe(cpv.id)) for (const s of z.territorio?.secciones || []) zonaDeSeccion.set(s, z.id);
  const porZona = new Map(res.zonas.map((z) => [z.id, { id: z.id, codigo: z.codigo, nombre: z.nombre, color: z.color, secciones: 0, electores: 0, meta: 0, promotores: 0 }]));
  const total = { secciones: 0, electores: 0, meta: 0, promotores: 0 };
  for (const s of ctx.secciones) {
    const ln = ctx.ln(s.clave);
    const m = metaSeccion(ln, cfg);
    total.secciones += 1;
    total.electores += ln;
    total.meta += m.meta;
    total.promotores += m.promotores;
    const z = porZona.get(zonaDeSeccion.get(s.clave));
    if (z) {
      z.secciones += 1;
      z.electores += ln;
      z.meta += m.meta;
      z.promotores += m.promotores;
    }
  }
  return { config: cfg, territorio: total, zonas: [...porZona.values()] };
}

module.exports = { DEFAULTS, configDe, metaSeccion, validar, resumen };
