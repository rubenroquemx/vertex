// Zonas electorales: el Coordinador de Promoción del Voto (CPV) reparte su territorio en zonas,
// cada una con su Coordinador de Zona. Reglas:
//  - Una zona solo puede contener secciones del territorio del CPV.
//  - Una sección pertenece a una sola zona del mismo CPV (asignadas / vacantes).
//  - Métodos (no combinables): por municipio, por distrito local, por distrito federal (varias
//    unidades) o manual en el mapa (sección por sección).
//  - Código y color únicos dentro del CPV.
const geo = require('./geo');
const padron = require('./padron');
const territory = require('./territory');
const { users } = require('./store');

// Paleta categórica validada (daltonismo y contraste) — el orden importa: se asigna en este orden
const PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
// Colores de la paleta anterior → equivalentes nuevos (para zonas creadas antes del cambio)
const EQUIVALENTE = {
  '#b04a6f': '#e87ba4', '#0284c7': '#2a78d6', '#2fbf8a': '#1baf7a', '#e8913a': '#eb6834', '#a259f7': '#4a3aa7',
  '#e2549b': '#e87ba4', '#36a39b': '#008300', '#e5534b': '#e34948', '#7c6cf0': '#4a3aa7',
};

// Al arrancar: las zonas con colores fuera de la paleta reciben el equivalente (o el primero libre)
async function migrarColores() {
  const porCpv = new Map();
  for (const z of users.all().filter((u) => u.role === 'coord_zona')) {
    if (!porCpv.has(z.parentId)) porCpv.set(z.parentId, []);
    porCpv.get(z.parentId).push(z);
  }
  for (const zonas of porCpv.values()) {
    const usados = new Set(zonas.map((z) => z.zona?.color).filter((c) => PALETA.includes(c)));
    for (const z of zonas) {
      if (!z.zona || PALETA.includes(z.zona.color)) continue;
      const preferido = EQUIVALENTE[z.zona.color];
      const color = preferido && !usados.has(preferido) ? preferido : PALETA.find((c) => !usados.has(c)) || PALETA[0];
      usados.add(color);
      await users.update(z.id, { zona: { ...z.zona, color } });
    }
  }
}

const METODOS = {
  municipio: { field: 'municipio', name: 'Por municipio' },
  distrito_local: { field: 'distritoLocal', name: 'Por distrito local' },
  distrito_federal: { field: 'distritoFederal', name: 'Por distrito federal' },
  manual: { field: null, name: 'Manual en mapa' },
};

const zonasDe = (cpvId) => users.hijos(cpvId, 'coord_zona');

// Contexto del CPV: entidad, secciones de su territorio (con datos) y electores por sección
function contexto(cpv) {
  if (!cpv.territorio) return null;
  const state = geo.getState(cpv.territorio.entidad);
  if (!state) return null;
  const propias = territory.sectionsOf(cpv.territorio);
  const pad = padron.sectionsOf(state.meta.clave);
  const secciones = state.catalog.secciones.filter((s) => propias.has(s.clave));
  return {
    entidad: { clave: state.meta.clave, nombre: state.meta.nombre },
    catalog: state.catalog,
    secciones,
    ln: (clave) => (pad ? pad.get(clave)?.ln || 0 : null),
    hasPadron: Boolean(pad),
  };
}

// Mapa sección → zona que la ocupa (excepto la zona `excludeId`, al editarla)
function ocupadas(cpvId, excludeId = null) {
  const map = new Map();
  for (const z of zonasDe(cpvId)) {
    if (z.id === excludeId) continue;
    for (const s of z.territorio?.secciones || []) map.set(s, z);
  }
  return map;
}

const zonaInfo = (z) => ({ id: z.id, nombre: z.zona?.nombre || z.name, codigo: z.zona?.codigo || '', color: z.zona?.color || '#94a3b8' });

// Opciones para el formulario: unidades de cada método dentro del territorio del CPV
function opciones(cpv, excludeId = null) {
  const ctx = contexto(cpv);
  if (!ctx) return null;
  const taken = ocupadas(cpv.id, excludeId);
  const munName = new Map(ctx.catalog.municipios.map((m) => [m.clave, m.nombre]));

  const unidades = {};
  for (const [key, m] of Object.entries(METODOS)) {
    if (!m.field) continue;
    const acc = new Map();
    for (const s of ctx.secciones) {
      const clave = s[m.field];
      if (clave === null || clave === undefined) continue;
      if (!acc.has(clave)) {
        const nombre = key === 'municipio' ? munName.get(clave) || `Municipio ${clave}` : `${key === 'distrito_local' ? 'Distrito local' : 'Distrito federal'} ${clave}`;
        acc.set(clave, { clave, nombre, secciones: 0, libres: 0, electores: ctx.hasPadron ? 0 : null, electoresLibres: ctx.hasPadron ? 0 : null });
      }
      const u = acc.get(clave);
      u.secciones += 1;
      if (ctx.hasPadron) u.electores += ctx.ln(s.clave);
      if (!taken.has(s.clave)) {
        u.libres += 1;
        if (ctx.hasPadron) u.electoresLibres += ctx.ln(s.clave);
      }
    }
    unidades[key] = [...acc.values()].sort((a, b) => a.clave - b.clave);
  }

  const usados = new Set(zonasDe(cpv.id).filter((z) => z.id !== excludeId).map((z) => z.zona?.color));
  return {
    entidad: ctx.entidad,
    hasPadron: ctx.hasPadron,
    paleta: PALETA.map((c) => ({ color: c, usado: usados.has(c) })),
    siguienteCodigo: siguienteCodigo(cpv.id, excludeId),
    // Secciones del territorio del CPV con su municipio, distritos, electores y zona que la ocupa
    secciones: ctx.secciones.map((s) => {
      const z = taken.get(s.clave);
      return {
        clave: s.clave,
        municipio: s.municipio,
        distritoLocal: s.distritoLocal,
        distritoFederal: s.distritoFederal,
        electores: ctx.ln(s.clave),
        zona: z ? zonaInfo(z) : null,
      };
    }),
    unidades,
    municipios: Object.fromEntries(ctx.catalog.municipios.map((m) => [m.clave, m.nombre])),
  };
}

function siguienteCodigo(cpvId, excludeId) {
  const usados = new Set(zonasDe(cpvId).filter((z) => z.id !== excludeId).map((z) => (z.zona?.codigo || '').toUpperCase()));
  for (let n = 1; n < 1000; n++) {
    const c = `ZONA-${String(n).padStart(2, '0')}`;
    if (!usados.has(c)) return c;
  }
  return '';
}

// Valida datos de la zona y su territorio. Devuelve { errors, zona, territorio }
function validar(cpv, body, excludeId = null) {
  const errors = {};
  const ctx = contexto(cpv);
  if (!ctx) return { errors: { territorio: 'Tu cuenta no tiene territorio asignado; no puedes crear zonas.' } };
  const hermanas = zonasDe(cpv.id).filter((z) => z.id !== excludeId);

  const nombre = String(body.zonaNombre || '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 2 || nombre.length > 60) errors.zonaNombre = 'Escribe el nombre de la zona (2 a 60 caracteres).';
  else if (hermanas.some((z) => (z.zona?.nombre || '').toLowerCase() === nombre.toLowerCase())) errors.zonaNombre = 'Ya tienes una zona con ese nombre.';

  const codigo = String(body.zonaCodigo || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(codigo)) errors.zonaCodigo = 'De 2 a 20 caracteres: letras, números, guion o guion bajo.';
  else if (hermanas.some((z) => (z.zona?.codigo || '').toUpperCase() === codigo)) errors.zonaCodigo = 'Ese código ya lo usa otra zona.';

  const color = String(body.zonaColor || '').toLowerCase();
  if (!PALETA.includes(color)) errors.zonaColor = 'Elige un color.';
  else if (hermanas.some((z) => z.zona?.color === color)) errors.zonaColor = 'Ese color ya lo usa otra zona.';

  // Territorio: se calcula en el servidor dentro del territorio del CPV, sin secciones de otras zonas
  const t = body.territorio || {};
  const metodo = String(t.metodo || '');
  const taken = ocupadas(cpv.id, excludeId);
  let secciones = [];
  let unidades = [];
  if (!METODOS[metodo]) {
    errors.territorio = 'Elige el método de asignación.';
  } else if (metodo === 'manual') {
    const propias = new Set(ctx.secciones.map((s) => s.clave));
    const pedidas = [...new Set((Array.isArray(t.secciones) ? t.secciones : []).map(Number))];
    if (pedidas.some((s) => !propias.has(s))) errors.territorio = 'Hay secciones fuera de tu territorio.';
    else if (pedidas.some((s) => taken.has(s))) errors.territorio = 'Algunas secciones ya pertenecen a otra zona.';
    secciones = pedidas;
  } else {
    const field = METODOS[metodo].field;
    unidades = [...new Set((Array.isArray(t.unidades) ? t.unidades : []).map(Number))];
    const validas = new Set(ctx.secciones.map((s) => s[field]));
    if (unidades.some((u) => !validas.has(u))) errors.territorio = 'Hay opciones fuera de tu territorio.';
    const set = new Set(unidades);
    secciones = ctx.secciones.filter((s) => set.has(s[field]) && !taken.has(s.clave)).map((s) => s.clave);
  }
  if (!errors.territorio && !secciones.length) errors.territorio = 'La zona debe tener al menos una sección libre.';

  return {
    errors,
    zona: { nombre, codigo, color },
    territorio: { entidad: ctx.entidad.clave, tipo: 'secciones', metodo, unidades, secciones: secciones.sort((a, b) => a - b) },
  };
}

// Resumen de una zona y del territorio del CPV (asignadas / vacantes / electores)
function resumen(cpv) {
  const ctx = contexto(cpv);
  const zonas = zonasDe(cpv.id);
  if (!ctx) return { entidad: null, zonas: zonas.map((z) => ({ ...zonaInfo(z), secciones: 0, electores: null })), totales: null };
  const lista = zonas
    .map((z) => {
      const secs = z.territorio?.secciones || [];
      return {
        ...zonaInfo(z),
        coordinador: { id: z.id, name: z.name, username: z.username || null, phone: z.phone || '' },
        metodo: METODOS[z.territorio?.metodo]?.name || '',
        secciones: secs.length,
        electores: ctx.hasPadron ? secs.reduce((t, s) => t + ctx.ln(s), 0) : null,
      };
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  const asignadas = lista.reduce((t, z) => t + z.secciones, 0);
  const totalElectores = ctx.hasPadron ? ctx.secciones.reduce((t, s) => t + ctx.ln(s.clave), 0) : null;
  return {
    entidad: ctx.entidad,
    zonas: lista,
    totales: {
      secciones: ctx.secciones.length,
      asignadas,
      vacantes: ctx.secciones.length - asignadas,
      electores: totalElectores,
      electoresAsignados: ctx.hasPadron ? lista.reduce((t, z) => t + z.electores, 0) : null,
    },
  };
}

module.exports = { PALETA, migrarColores, METODOS, zonasDe, opciones, validar, resumen, contexto };
