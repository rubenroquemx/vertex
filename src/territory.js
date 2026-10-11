// Territorio asignado a una cuenta: una sola unidad de una entidad.
//   { entidad, tipo: 'estatal' | 'municipio' | 'distrito_local' | 'distrito_federal', clave }
// Se resuelve contra la cartografía cargada (secciones) y el padrón (electores).
const geo = require('./geo');
const padron = require('./padron');

const TIPOS = [
  { key: 'estatal', name: 'Estatal', field: null },
  { key: 'municipio', name: 'Municipio', field: 'municipio' },
  { key: 'distrito_local', name: 'Distrito local', field: 'distritoLocal' },
  { key: 'distrito_federal', name: 'Distrito federal', field: 'distritoFederal' },
];
const TIPO_BY_KEY = new Map(TIPOS.map((t) => [t.key, t]));

// Opciones seleccionables por tipo, con número de secciones y electores (lista nominal)
function options(entidad) {
  const state = geo.getState(entidad);
  if (!state) return null;
  const { meta, catalog } = state;
  const pad = padron.sectionsOf(meta.clave);
  const ln = (s) => (pad ? pad.get(s.clave)?.ln || 0 : null);

  const group = (field, list, label) => {
    const acc = new Map(list.map((u) => [u.clave, { clave: u.clave, nombre: label(u), secciones: 0, electores: pad ? 0 : null }]));
    for (const s of catalog.secciones) {
      const unit = acc.get(s[field]);
      if (!unit) continue;
      unit.secciones += 1;
      if (pad) unit.electores += ln(s);
    }
    return [...acc.values()];
  };

  const totalElectores = pad ? catalog.secciones.reduce((t, s) => t + ln(s), 0) : null;
  return {
    entidad: { clave: meta.clave, nombre: meta.nombre },
    padron: pad ? { corte: padron.summary().states.find((s) => s.clave === meta.clave)?.corte || null } : null,
    tipos: {
      estatal: [{ clave: meta.clave, nombre: meta.nombre, secciones: catalog.secciones.length, electores: totalElectores }],
      municipio: group('municipio', catalog.municipios, (m) => m.nombre || `Municipio ${m.clave}`),
      distrito_local: group('distritoLocal', catalog.distritosLocales, (d) => `Distrito local ${d.clave}`),
      distrito_federal: group('distritoFederal', catalog.distritosFederales, (d) => `Distrito federal ${d.clave}`),
    },
  };
}

// Valida un territorio; devuelve { territorio normalizado, resumen } o un mensaje de error
function resolve(input) {
  const entidad = Number(input?.entidad);
  const tipo = String(input?.tipo || '');
  const clave = Number(input?.clave);
  if (!TIPO_BY_KEY.has(tipo)) return { error: 'Elige el método de asignación.' };
  const opts = options(entidad);
  if (!opts) return { error: 'La entidad seleccionada no tiene cartografía cargada.' };
  const unit = opts.tipos[tipo].find((u) => u.clave === (tipo === 'estatal' ? entidad : clave));
  if (!unit) return { error: `Elige ${tipo === 'estatal' ? 'la entidad' : `un ${TIPO_BY_KEY.get(tipo).name.toLowerCase()}`}.` };
  return {
    territorio: { entidad, tipo, clave: unit.clave },
    resumen: { entidad: opts.entidad.nombre, tipo: TIPO_BY_KEY.get(tipo).name, nombre: unit.nombre, secciones: unit.secciones, electores: unit.electores },
  };
}

// Conjunto de secciones de un territorio (para validar que el territorio de un subordinado
// quede dentro del de su superior, en los niveles inferiores)
function sectionsOf(territorio) {
  // Territorio definido por lista explícita de secciones (zonas y niveles inferiores)
  if (territorio?.tipo === 'secciones') return new Set(territorio.secciones || []);
  const state = geo.getState(territorio?.entidad);
  if (!state) return new Set();
  const t = TIPO_BY_KEY.get(territorio.tipo);
  if (!t) return new Set();
  return new Set(state.catalog.secciones.filter((s) => !t.field || s[t.field] === territorio.clave).map((s) => s.clave));
}

module.exports = { TIPOS, options, resolve, sectionsOf };
