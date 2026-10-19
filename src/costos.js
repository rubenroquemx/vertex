// Calculadora de costos (semi pública): cotiza VERTEX según el tipo de elección y la lista
// nominal del territorio. Solo la abre quien tiene el enlace con la clave; los parámetros
// los define el super administrador.
//
//   operación de la campaña completa = precio ancla × (lista nominal ÷ lista ancla)^exponente × factor del tipo
//   mensualidad                      = operación ÷ meses de referencia   (redondeada hacia arriba)
//   meses a pagar                    = de la fecha de contratación al cierre, mínimo `minMeses`
//   total                            = instalación + mensualidad × meses   (sin IVA; el IVA se suma aparte)
// Todos los meses se pagan por adelantado: el primer pago es la instalación más el primer mes.
const crypto = require('crypto');
const settings = require('./settings');
const padron = require('./padron');
const geo = require('./geo');

const KEY = 'costos';
const TIPOS = {
  estatal: 'Estatal (gubernatura o jefatura de gobierno)',
  federal: 'Diputación federal',
  local: 'Diputación local',
  municipal: 'Municipal (presidencia o alcaldía)',
};
const DEFAULTS = {
  token: null,
  instalacion: 6500,
  anclaNombre: 'Ciudad de México',
  anclaLn: 7950660,
  anclaPrecio: 2000000,
  exponente: 0.8,
  mesesRef: 9,
  fechaFin: '2027-07-06',
  minMeses: 4,
  iva: 16,
  redondeo: 100,
  factores: { estatal: 1, federal: 1, local: 1, municipal: 1 },
};

class CostosError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const config = () => {
  const c = settings.get(KEY) || {};
  return { ...DEFAULTS, ...c, factores: { ...DEFAULTS.factores, ...(c.factores || {}) } };
};

// Compara en tiempo constante para no filtrar la clave por tiempos de respuesta
function tokenValido(token) {
  const t = config().token;
  if (!t || typeof token !== 'string' || token.length !== t.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(t));
}

const nuevoToken = () => crypto.randomBytes(18).toString('base64url');

function validar(body) {
  const errors = {};
  const num = (v) => Number(String(v ?? '').replace(/[,\s$]/g, ''));
  const c = config();
  const out = {
    instalacion: num(body.instalacion),
    anclaNombre: String(body.anclaNombre ?? c.anclaNombre).trim().slice(0, 80) || c.anclaNombre,
    anclaLn: num(body.anclaLn),
    anclaPrecio: num(body.anclaPrecio),
    exponente: num(body.exponente),
    mesesRef: num(body.mesesRef),
    fechaFin: String(body.fechaFin || '').slice(0, 10),
    minMeses: num(body.minMeses),
    iva: num(body.iva),
    redondeo: num(body.redondeo),
    factores: {},
  };
  if (!(out.instalacion >= 0 && out.instalacion <= 10000000)) errors.instalacion = 'Escribe un monto entre 0 y 10,000,000.';
  if (!(Number.isInteger(out.anclaLn) && out.anclaLn >= 1000)) errors.anclaLn = 'Escribe la lista nominal de referencia (mínimo 1,000).';
  if (!(out.anclaPrecio > 0)) errors.anclaPrecio = 'Escribe el precio de referencia.';
  if (!(out.exponente >= 0.3 && out.exponente <= 1.2)) errors.exponente = 'Usa un valor entre 0.3 y 1.2 (1 = proporcional directo).';
  if (!(Number.isInteger(out.mesesRef) && out.mesesRef >= 1 && out.mesesRef <= 36)) errors.mesesRef = 'Escribe un número entero de meses entre 1 y 36.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.fechaFin) || Number.isNaN(Date.parse(`${out.fechaFin}T12:00:00Z`))) errors.fechaFin = 'Elige la fecha de cierre.';
  if (!(Number.isInteger(out.minMeses) && out.minMeses >= 1 && out.minMeses <= 36)) errors.minMeses = 'Escribe un número entero de meses entre 1 y 36.';
  if (!(out.iva >= 0 && out.iva <= 50)) errors.iva = 'Escribe un porcentaje entre 0 y 50.';
  if (![1, 10, 100, 1000].includes(out.redondeo)) errors.redondeo = 'Elige un redondeo.';
  for (const k of Object.keys(TIPOS)) {
    const f = num(body.factores?.[k]);
    if (!(f > 0 && f <= 5)) errors[`factor_${k}`] = 'Entre 0.1 y 5.';
    out.factores[k] = f;
  }
  return { errors, config: out };
}

// ---------- Fechas ----------
const hoyMx = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
};
const fmt = ({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
// Suma meses conservando el día (31 → último día del mes si no existe)
function sumarMeses(f, n) {
  const t = f.m - 1 + n;
  const y = f.y + Math.floor(t / 12);
  const m = (((t % 12) + 12) % 12) + 1;
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: Math.min(f.d, ultimo) };
}

// Periodos mensuales que inician entre la contratación y el cierre (incluido)
function periodos(inicio, fin) {
  const a = parse(inicio);
  const lista = [];
  for (let i = 0; i < 60; i++) {
    const p = fmt(sumarMeses(a, i));
    if (p > fin) break;
    lista.push(p);
  }
  return lista;
}

// ---------- Territorios cargados (padrón + cartografía) ----------
function territorios() {
  const out = [];
  for (const meta of padron.summary().states) {
    const secs = padron.sectionsOf(meta.clave);
    if (!secs) continue;
    const nombresMun = padron.municipiosOf(meta.clave) || {};
    const fed = new Map();
    const mun = new Map();
    for (const s of secs.values()) {
      if (s.distritoFederal) fed.set(s.distritoFederal, (fed.get(s.distritoFederal) || 0) + s.ln);
      if (s.municipio) mun.set(s.municipio, (mun.get(s.municipio) || 0) + s.ln);
    }
    // Distritos locales: vienen de la cartografía (sección → distrito local)
    const loc = new Map();
    const cat = geo.getState(meta.clave)?.catalog;
    if (cat) {
      for (const s of cat.secciones) {
        const p = secs.get(s.clave);
        if (p && s.distritoLocal) loc.set(s.distritoLocal, (loc.get(s.distritoLocal) || 0) + p.ln);
      }
    }
    const lista = (m, nombre) => [...m].sort((x, y) => x[0] - y[0]).map(([clave, ln]) => ({ clave, nombre: nombre(clave), ln }));
    out.push({
      clave: meta.clave,
      nombre: meta.nombre,
      ln: meta.ln,
      corte: meta.corte || null,
      federal: lista(fed, (c) => `Distrito federal ${String(c).padStart(2, '0')}`),
      local: lista(loc, (c) => `Distrito local ${String(c).padStart(2, '0')}`),
      municipal: lista(mun, (c) => nombresMun[c] || `Municipio ${String(c).padStart(3, '0')}`),
    });
  }
  return out;
}

// ---------- Cotización ----------
function cotizar({ tipo, entidad, clave, ln: lnManual, nombre, fecha }) {
  const c = config();
  if (!TIPOS[tipo]) throw new CostosError('Elige el tipo de elección.', 422, { tipo: 'Elige el tipo de elección.' });
  let ln;
  let territorio;
  if (lnManual !== undefined && lnManual !== null && lnManual !== '') {
    ln = Number(String(lnManual).replace(/[,\s]/g, ''));
    if (!(Number.isInteger(ln) && ln >= 100 && ln <= 15000000)) throw new CostosError('Escribe la lista nominal (entre 100 y 15,000,000).', 422, { ln: 'Escribe la lista nominal (entre 100 y 15,000,000).' });
    territorio = String(nombre || '').trim().slice(0, 120) || 'Territorio capturado';
  } else {
    const ent = territorios().find((t) => t.clave === Number(entidad));
    if (!ent) throw new CostosError('Elige la entidad.', 422, { entidad: 'Elige la entidad.' });
    if (tipo === 'estatal') {
      ln = ent.ln;
      territorio = ent.nombre;
    } else {
      const item = ent[tipo].find((x) => x.clave === Number(clave));
      if (!item) throw new CostosError('Elige el territorio.', 422, { clave: 'Elige el territorio.' });
      ln = item.ln;
      territorio = `${item.nombre}, ${ent.nombre}`;
    }
  }

  const hoy = hoyMx();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? String(fecha) : hoy;
  if (inicio < hoy) throw new CostosError('La fecha de contratación no puede ser anterior a hoy.', 422, { fecha: 'La fecha de contratación no puede ser anterior a hoy.' });
  if (inicio > c.fechaFin) throw new CostosError('La fecha de contratación es posterior al cierre del servicio.', 422, { fecha: 'La fecha es posterior al cierre del servicio.' });

  const r = c.redondeo;
  const operacion = c.anclaPrecio * (ln / c.anclaLn) ** c.exponente * c.factores[tipo];
  const mensual = Math.ceil(operacion / c.mesesRef / r) * r;
  let fechas = periodos(inicio, c.fechaFin);
  const minimo = fechas.length < c.minMeses;
  if (minimo) fechas = Array.from({ length: c.minMeses }, (_, i) => fmt(sumarMeses(parse(inicio), i)));
  const meses = fechas.length;
  const instalacion = Math.round(c.instalacion);
  const subtotal = instalacion + mensual * meses;
  const iva = Math.round((subtotal * c.iva) / 100);
  const pagos = fechas.map((f, i) => {
    const monto = i === 0 ? instalacion + mensual : mensual;
    return { fecha: f, concepto: i === 0 ? 'Instalación + mes 1' : `Mes ${i + 1}`, monto, iva: Math.round((monto * c.iva) / 100) };
  });
  return {
    tipo,
    tipoNombre: TIPOS[tipo],
    territorio,
    ln,
    inicio,
    fin: c.fechaFin,
    meses,
    minimoAplicado: minimo,
    minMeses: c.minMeses,
    instalacion,
    mensual,
    operacion: mensual * meses,
    subtotal,
    ivaPct: c.iva,
    iva,
    total: subtotal + iva,
    porElector: Math.round(((mensual * meses) / ln) * 100) / 100,
    pagos,
  };
}

// Datos que ve la página pública (sin la fórmula ni sus parámetros)
function publico() {
  const c = config();
  return { tipos: TIPOS, territorios: territorios(), fin: c.fechaFin, minMeses: c.minMeses, iva: c.iva, instalacion: c.instalacion, hoy: hoyMx() };
}

module.exports = { KEY, TIPOS, DEFAULTS, CostosError, config, tokenValido, nuevoToken, validar, cotizar, publico, territorios };
