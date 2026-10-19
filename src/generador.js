// Generador de estructura (servidor de demostración): arma la estructura completa de un CPV
// —zonas con su coordinador, responsables de sección, promotores y promovidos con historial,
// revisiones y observaciones— hasta un porcentaje de avance de su meta.
// Los registros son datos normales (no «de ejemplo»): solo llevan data.lote para poder
// eliminar la carga completa si hace falta, sin tocar lo capturado por personas.
const crypto = require('crypto');
const { query, tx } = require('./db');
const store = require('./store');
const settings = require('./settings');
const metas = require('./metas');
const zonas = require('./zonas');

const KEY = 'generador.lotes';

class GeneradorError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

// ---------- Aleatoriedad ----------
const rnd = Math.random;
const entre = (a, b) => a + rnd() * (b - a);
const entero = (a, b) => Math.floor(entre(a, b + 1));
const uno = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n, w) => String(n).padStart(w, '0');

// ---------- Nombres y domicilios ----------
const HOMBRES = ['JOSÉ', 'JUAN', 'LUIS', 'CARLOS', 'JORGE', 'MIGUEL', 'FRANCISCO', 'ANTONIO', 'PEDRO', 'MANUEL', 'JESÚS', 'ALEJANDRO', 'RICARDO', 'FERNANDO', 'ROBERTO', 'DANIEL', 'EDUARDO', 'RAÚL', 'JAVIER', 'SERGIO', 'ARTURO', 'ÁNGEL', 'MARIO', 'HÉCTOR', 'OSCAR', 'RAFAEL', 'ENRIQUE', 'GERARDO', 'ALBERTO', 'VÍCTOR', 'DIEGO', 'ERNESTO', 'ADRIÁN', 'RUBÉN', 'CÉSAR', 'HUGO', 'ISMAEL', 'GUSTAVO', 'ARMANDO', 'SAMUEL', 'ISIDRO', 'FELIPE', 'GILBERTO', 'NOÉ', 'LORENZO'];
const MUJERES = ['MARÍA', 'GUADALUPE', 'JUANA', 'MARGARITA', 'VERÓNICA', 'ROSA', 'LETICIA', 'ELIZABETH', 'PATRICIA', 'ALEJANDRA', 'GABRIELA', 'ANA', 'LAURA', 'MARTHA', 'CLAUDIA', 'ADRIANA', 'SILVIA', 'YOLANDA', 'SANDRA', 'NORMA', 'ARACELI', 'MÓNICA', 'FERNANDA', 'DANIELA', 'KARLA', 'ANDREA', 'DIANA', 'LUCÍA', 'BEATRIZ', 'ISABEL', 'CAROLINA', 'TERESA', 'ROCÍO', 'LORENA', 'MIRIAM', 'PAOLA', 'VALERIA', 'XÓCHITL', 'ESMERALDA', 'CONCEPCIÓN', 'EUSEBIA', 'ROSALBA', 'OFELIA'];
const APELLIDOS = ['HERNÁNDEZ', 'GARCÍA', 'MARTÍNEZ', 'LÓPEZ', 'GONZÁLEZ', 'PÉREZ', 'RODRÍGUEZ', 'SÁNCHEZ', 'RAMÍREZ', 'CRUZ', 'FLORES', 'GÓMEZ', 'MORALES', 'VÁZQUEZ', 'JIMÉNEZ', 'REYES', 'DÍAZ', 'TORRES', 'GUTIÉRREZ', 'RUIZ', 'MENDOZA', 'AGUILAR', 'ORTIZ', 'CASTILLO', 'MORENO', 'ROMERO', 'ÁLVAREZ', 'CHÁVEZ', 'RIVERA', 'JUÁREZ', 'DE LA CRUZ', 'MÉNDEZ', 'DOMÍNGUEZ', 'NAVA', 'SALGADO', 'BARRERA', 'CABAÑAS', 'ABARCA', 'ASTUDILLO', 'BAUTISTA', 'CAMPOS', 'NÁJERA', 'OCAMPO', 'ROJAS', 'SERRANO', 'VALDOVINOS', 'GALEANA', 'MOLINA', 'PINEDA', 'ROSALES', 'SOTELO', 'TAPIA', 'VEGA', 'ZAMORA'];
const CALLES = ['CALLE HIDALGO', 'CALLE MORELOS', 'CALLE JUÁREZ', 'CALLE ZARAGOZA', 'CALLE ALLENDE', 'CALLE ALDAMA', 'CALLE REFORMA', 'CALLE GUERRERO', 'CALLE BRAVO', 'CALLE GALEANA', 'CALLE INDEPENDENCIA', 'CALLE 5 DE MAYO', 'CALLE 16 DE SEPTIEMBRE', 'CALLE MADERO', 'CALLE CARRANZA', 'CALLE OBREGÓN', 'CALLE LÁZARO CÁRDENAS', 'CALLE NIÑOS HÉROES', 'CALLE DEL ROSARIO', 'CALLE LAS FLORES', 'AV. PRINCIPAL', 'AV. JUAN ÁLVAREZ', 'PRIVADA DEL SOL', 'CALLE CAFETALES'];
const OBS_RS = [
  'La foto del frente salió borrosa, ¿la puedes tomar de nuevo?',
  'Revisa el número exterior, no coincide con el comprobante.',
  'Falta el apellido materno, en la INE sí aparece.',
  'El teléfono no responde, confirma el número por favor.',
  'La CURP tiene un dígito distinto al de la credencial.',
  'Verifica la calle, parece que es otra colonia.',
];
const OBS_PROMOTOR = ['Listo, ya lo corregí.', 'Mañana paso a tomar la foto otra vez.', 'Le marqué y ya me confirmó el número.', 'Ok, lo reviso con la persona.'];
// Clave de entidad de la CURP (orden de las claves INEGI 1–32)
const CURP_EDO = ['AS', 'BC', 'BS', 'CC', 'CL', 'CM', 'CS', 'CH', 'DF', 'DG', 'GT', 'GR', 'HG', 'JC', 'MC', 'MN', 'MS', 'NT', 'NL', 'OC', 'PL', 'QT', 'QR', 'SP', 'SL', 'SR', 'TC', 'TS', 'TL', 'VZ', 'YN', 'ZS'];
// Lada principal por entidad (teléfonos de 10 dígitos)
const LADA = { 9: '55', 12: '742', 15: '722', 14: '33', 19: '81', 21: '222', 27: '993', 30: '228', 31: '999' };

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z ]/g, '');
const VOCALES = 'AEIOU';
const consonanteInterna = (s) => {
  const x = sinAcentos(s).replace(/ /g, '');
  for (let i = 1; i < x.length; i++) if (!VOCALES.includes(x[i])) return x[i];
  return 'X';
};
const primeraVocalInterna = (s) => {
  const x = sinAcentos(s).replace(/ /g, '');
  for (let i = 1; i < x.length; i++) if (VOCALES.includes(x[i])) return x[i];
  return 'X';
};
const capital = (s) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function persona() {
  const sexo = rnd() < 0.53 ? 'M' : 'H';
  const nombres = sexo === 'M' ? (rnd() < 0.25 ? `${uno(MUJERES)} ${uno(MUJERES)}` : uno(MUJERES)) : rnd() < 0.2 ? `${uno(HOMBRES)} ${uno(HOMBRES)}` : uno(HOMBRES);
  return { sexo, nombres, paterno: uno(APELLIDOS), materno: rnd() < 0.97 ? uno(APELLIDOS) : '', nac: new Date(entero(1950, 2006), entero(0, 11), entero(1, 28)) };
}

// Fotos de la credencial: un frente y un reverso genéricos compartidos por toda la carga
async function fotosIne() {
  const sharp = require('sharp');
  const svg = (lado) => `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="441">
    <rect width="700" height="441" rx="24" fill="${lado === 'frente' ? '#e7ecef' : '#eceae4'}"/>
    <rect x="28" y="28" width="644" height="56" rx="10" fill="#9aa5ad"/>
    ${lado === 'frente' ? '<rect x="40" y="110" width="170" height="210" rx="10" fill="#c3cbd1"/><circle cx="125" cy="180" r="44" fill="#a9b3ba"/>' : '<rect x="40" y="110" width="620" height="90" rx="8" fill="#d2d0c8"/>'}
    <rect x="240" y="120" width="380" height="18" rx="6" fill="#c3cbd1"/>
    <rect x="240" y="160" width="300" height="18" rx="6" fill="#c3cbd1"/>
    <rect x="240" y="200" width="340" height="18" rx="6" fill="#c3cbd1"/>
  </svg>`;
  const img = (lado) => sharp(Buffer.from(svg(lado))).webp({ quality: 60 }).toBuffer();
  return { frente: await img('frente'), reverso: await img('reverso') };
}

// Domicilios reales del municipio (catálogo de códigos postales)
const cpCache = new Map();
async function domicilios(cvegeo) {
  if (cpCache.has(cvegeo)) return cpCache.get(cvegeo);
  const out = [];
  try {
    const lib = await import('@webrek/mx-cp');
    for (const cp of (await lib.cpsDeMunicipio(cvegeo)).slice(0, 40)) {
      const r = await lib.buscaCP(cp);
      const asent = (r?.asentamientos || []).filter((a) => !/gran usuario/i.test(a.tipo));
      if (asent.length) out.push({ cp: r.cp, municipio: r.municipio, estado: r.estado, asent });
    }
  } catch {
    /* sin catálogo: domicilio sin código postal */
  }
  cpCache.set(cvegeo, out);
  return out;
}

async function insertarLote(c, tabla, cols, filas) {
  for (let i = 0; i < filas.length; i += 400) {
    const parte = filas.slice(i, i + 400);
    const vals = [];
    const marcas = parte.map((f, j) => `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(', ')})`);
    for (const f of parte) vals.push(...f);
    await c.query(`INSERT INTO ${tabla} (${cols.join(', ')}) VALUES ${marcas.join(', ')}`, vals);
  }
}

const DIA = 86400000;
const hace = (dias) => new Date(Date.now() - dias * DIA - entero(0, 12 * 3600) * 1000);

// Reparte las secciones (ordenadas) en `n` zonas contiguas de tamaño parecido
function partir(lista, n) {
  const out = [];
  const tam = Math.ceil(lista.length / n);
  for (let i = 0; i < lista.length; i += tam) out.push(lista.slice(i, i + tam));
  return out;
}

async function generar({ cpvId, porcentaje, porId }) {
  const cpv = store.users.get(cpvId);
  if (!cpv || cpv.role !== 'coord_promocion') throw new GeneradorError('Elige un Coordinador de Promoción del Voto.');
  const pct = Number(porcentaje);
  if (!(pct > 0 && pct <= 100)) throw new GeneradorError('El porcentaje debe estar entre 1 y 100.');
  const ctx = zonas.contexto(cpv);
  if (!ctx) throw new GeneradorError('El CPV no tiene territorio asignado (o falta la cartografía de su entidad).');
  if (!ctx.hasPadron) throw new GeneradorError('Falta el padrón de la entidad del CPV: sin lista nominal no hay metas.');
  const todos = store.users.all();
  if (todos.some((u) => u.role === 'coord_zona' && u.parentId === cpv.id)) {
    throw new GeneradorError('Este CPV ya tiene zonas. El generador solo arma la estructura de un CPV sin zonas.', 409);
  }

  const ent = ctx.entidad.clave;
  const lote = crypto.randomUUID();
  const passwordPlano = `Vertex-${crypto.randomBytes(3).toString('hex')}${entero(10, 99)}`;
  const passwordHash = store.passwords.hash(passwordPlano);
  const fotos = await fotosIne();
  const cfg = metas.configDe(cpv);
  const lada = LADA[ent] || '55';
  const telefono = () => `${lada}${pad(entero(0, 10 ** (10 - lada.length) - 1), 10 - lada.length)}`;
  const curpEdo = CURP_EDO[ent - 1] || 'NE';

  // Usuarios de acceso únicos en todo el sistema; claves y CURP únicas solo dentro de este CPV
  const usernames = new Set(todos.filter((u) => u.username).map((u) => u.username));
  const claves = new Set();
  const curps = new Set();
  const username = (nombre) => {
    const partes = sinAcentos(nombre.toUpperCase()).toLowerCase().split(' ').filter(Boolean);
    const base = `${partes[0][0]}${partes[1] || partes[0]}`.slice(0, 20);
    let u = base;
    let i = 2;
    while (usernames.has(u)) u = `${base}${i++}`;
    usernames.add(u);
    return u;
  };
  const identidad = ({ paterno, materno, nombres, sexo, nac }) => {
    const p = sinAcentos(paterno).replace(/ /g, '');
    const m = sinAcentos(materno).replace(/ /g, '') || 'X';
    const n = sinAcentos(nombres).replace(/ /g, '');
    const fecha = `${pad(nac.getFullYear() % 100, 2)}${pad(nac.getMonth() + 1, 2)}${pad(nac.getDate(), 2)}`;
    let clave;
    do clave = `${p[0]}${consonanteInterna(p)}${m[0]}${consonanteInterna(m)}${n[0]}${consonanteInterna(n)}${fecha}${pad(ent, 2)}${sexo}${pad(entero(0, 999), 3)}`;
    while (claves.has(clave));
    claves.add(clave);
    let curp;
    do {
      const homo = nac.getFullYear() < 2000 ? String(entero(0, 9)) : uno('ABCDEFGHJ'.split(''));
      curp = `${p[0]}${primeraVocalInterna(p)}${m[0]}${n[0]}${fecha}${sexo}${curpEdo}${consonanteInterna(p)}${consonanteInterna(m)}${consonanteInterna(n)}${homo}${entero(0, 9)}`;
    } while (curps.has(curp));
    curps.add(curp);
    return { clave, curp };
  };

  const nuevosUsers = [];
  const nuevoUsuario = (role, parentId, extra = {}, antiguedad = 90) => {
    const p = persona();
    const name = capital(`${p.nombres} ${p.paterno} ${p.materno}`.trim());
    const u = { id: crypto.randomUUID(), role, parentId, username: username(name), name, data: { phone: telefono(), email: '', passwordHash, lote, ...extra }, createdAt: hace(entero(antiguedad - 10, antiguedad)) };
    nuevosUsers.push(u);
    return u;
  };

  // 1) Zonas: el territorio del CPV en 2 a 6 zonas contiguas, cada una con su coordinador
  const conLn = ctx.secciones.map((s) => ({ ...s, ln: ctx.ln(s.clave) })).filter((s) => s.ln > 0).sort((a, b) => a.clave - b.clave);
  if (!conLn.length) throw new GeneradorError('El territorio del CPV no tiene secciones con lista nominal.');
  const nZonas = Math.min(6, Math.max(2, Math.round(conLn.length / 15)), conLn.length);
  const grupos = partir(conLn, nZonas);
  const zonasNuevas = grupos.map((g, i) =>
    nuevoUsuario('coord_zona', cpv.id, {
      zona: { nombre: `Zona ${i + 1}`, codigo: `ZONA-${pad(i + 1, 2)}`, color: zonas.PALETA[i % zonas.PALETA.length] },
      territorio: { entidad: ent, tipo: 'secciones', metodo: 'manual', unidades: [], secciones: g.map((s) => s.clave) },
    }, 100)
  );

  // 2) Avance desigual entre secciones; ~85 % con responsable; la suma llega al porcentaje pedido
  const secciones = [];
  grupos.forEach((g, zi) => {
    for (const s of g) {
      const m = metas.metaSeccion(s.ln, cfg);
      secciones.push({ zona: zonasNuevas[zi], clave: s.clave, municipio: s.municipio, meta: m.meta, necesarios: m.promotores, peso: rnd() < 0.85 ? Math.pow(rnd(), 0.8) + 0.05 : 0 });
    }
  });
  const metaTotal = secciones.reduce((t, s) => t + s.meta, 0);
  const objetivo = Math.round((metaTotal * pct) / 100);
  let k = 1;
  for (let it = 0; it < 30; it++) {
    const suma = secciones.reduce((t, s) => t + Math.min(1.05, s.peso * k) * s.meta, 0) || 1;
    k *= objetivo / suma;
  }
  for (const s of secciones) s.avance = Math.min(1.05, s.peso * k);

  const filasProm = [];
  const filasIne = [];
  const filasHist = [];
  const filasObs = [];
  const conteo = { zonas: zonasNuevas.length, responsables: 0, promotores: 0, promovidos: 0, validado: 0, en_revision: 0, observaciones: 0, rechazado: 0 };

  const crearPromovido = (promotor, rs, seccion, doms) => {
    const p = persona();
    const { clave, curp } = identidad(p);
    const d = doms.length ? uno(doms) : null;
    const a = d ? uno(d.asent) : null;
    const creado = hace(Math.floor(Math.pow(rnd(), 1.6) * 70));
    const data = {
      vigencia: entero(2027, 2034),
      paterno: p.paterno,
      materno: p.materno,
      nombres: p.nombres,
      telefono: telefono(),
      lote,
      domicilio: {
        cp: d?.cp || '',
        calle: uno(CALLES),
        numExt: rnd() < 0.1 ? 'S/N' : String(entero(1, 980)),
        numInt: rnd() < 0.1 ? String(entero(1, 12)) : '',
        fracc: a && /fraccionamiento/i.test(a.tipo) ? a.nombre.toUpperCase() : '',
        localidad: a ? a.nombre.toUpperCase() : '',
        municipio: d?.municipio || '',
        estado: d?.estado || ctx.entidad.nombre,
      },
    };
    const x = rnd();
    const tipo = x < 0.52 ? 'validado' : x < 0.82 ? 'en_revision' : x < 0.95 ? 'observaciones' : 'rechazado';
    const estatus = tipo === 'observaciones' ? 'en_revision' : tipo;
    const revisado = estatus === 'en_revision' ? null : new Date(Math.min(Date.now() - 3600000, creado.getTime() + entero(2, 96) * 3600000));
    const id = crypto.randomUUID();
    filasProm.push([id, promotor.id, rs.id, seccion, data, clave, curp, estatus, revisado ? rs.id : null, revisado, creado, cpv.id]);
    filasIne.push([id, 'frente', fotos.frente], [id, 'reverso', fotos.reverso]);
    filasHist.push([id, promotor.id, promotor.name, 'creado', '[]', creado]);
    if (revisado) filasHist.push([id, rs.id, rs.name, 'editado', JSON.stringify([{ campo: 'Estatus', antes: 'En revisión', despues: estatus === 'validado' ? 'Validado' : 'Rechazado' }]), revisado]);
    if (tipo === 'observaciones' || tipo === 'rechazado') {
      const t1 = new Date(Math.min(Date.now() - 1800000, creado.getTime() + entero(1, 48) * 3600000));
      filasObs.push([id, rs.id, rs.name, uno(OBS_RS), t1]);
      if (rnd() < 0.5) filasObs.push([id, promotor.id, promotor.name, uno(OBS_PROMOTOR), new Date(Math.min(Date.now() - 600000, t1.getTime() + entero(1, 20) * 3600000))]);
    }
    conteo.promovidos += 1;
    conteo[tipo] += 1;
  };

  // 3) Responsables, promotores y promovidos por sección
  for (const s of secciones) {
    if (!s.peso) continue;
    const rs = nuevoUsuario('resp_seccion', s.zona.id, { territorio: { tipo: 'secciones', metodo: 'manual', entidad: ent, secciones: [s.clave] } }, 95);
    conteo.responsables += 1;
    const totalProm = Math.round(s.meta * s.avance);
    const nPromotores = Math.max(1, Math.min(s.necesarios, Math.round(s.necesarios * Math.min(1, s.avance * entre(0.85, 1.2)))));
    const promotores = [];
    for (let i = 0; i < nPromotores; i++) {
      promotores.push({ u: nuevoUsuario('promotor', rs.id, {}, 80), peso: Math.pow(rnd(), 1.4) });
      conteo.promotores += 1;
    }
    const sumaPesos = promotores.reduce((t, p) => t + p.peso, 0) || 1;
    const doms = await domicilios(`${pad(ent, 2)}${pad(s.municipio || 1, 3)}`);
    let restantes = totalProm;
    promotores.forEach((p, i) => {
      const n = i === promotores.length - 1 ? restantes : Math.min(restantes, Math.round((totalProm * p.peso) / sumaPesos));
      restantes -= n;
      for (let j = 0; j < n; j++) crearPromovido(p.u, rs, s.clave, doms);
    });
  }

  // 4) Todo en una sola transacción: si algo falla, no queda nada a medias
  const orden = { coord_zona: 0, resp_seccion: 1, promotor: 2 };
  await tx(async (c) => {
    await insertarLote(
      c,
      'users',
      ['id', 'role', 'parent_id', 'username', 'name', 'data', 'created_at'],
      [...nuevosUsers].sort((a, b) => orden[a.role] - orden[b.role]).map((u) => [u.id, u.role, u.parentId, u.username, u.name, u.data, u.createdAt])
    );
    await insertarLote(c, 'promovidos', ['id', 'promotor_id', 'responsable_id', 'seccion', 'data', 'clave_elector', 'curp', 'estatus', 'revisado_por', 'revisado_at', 'created_at', 'cpv_id'], filasProm);
    await insertarLote(c, 'promovido_ine', ['promovido_id', 'lado', 'image'], filasIne);
    await insertarLote(c, 'promovido_historial', ['promovido_id', 'user_id', 'user_name', 'accion', 'cambios', 'at'], filasHist);
    await insertarLote(c, 'promovido_observaciones', ['promovido_id', 'user_id', 'user_name', 'texto', 'at'], filasObs);
  });
  // Recarga la copia en memoria (cuentas y avance) para que los paneles lo vean de inmediato
  await store.init({ seedIfEmpty: false });

  const registro = { id: lote, cpvId: cpv.id, cpv: cpv.name, porcentaje: pct, meta: metaTotal, at: new Date().toISOString(), por: porId, conteo };
  // Se guarda como objeto: un arreglo suelto lo convertiría el driver en arreglo de PostgreSQL
  await settings.set(KEY, { lotes: [...lotes(), registro] }, porId);
  return { ...registro, password: passwordPlano };
}

function lotes() {
  return settings.get(KEY)?.lotes || [];
}

// Elimina todo lo creado por un lote (promovidos y cuentas); lo capturado por personas no se toca
async function eliminar(loteId, porId) {
  const lista = lotes();
  const l = lista.find((x) => x.id === loteId);
  if (!l) throw new GeneradorError('No encontré esa carga.', 404);
  await tx(async (c) => {
    await c.query("DELETE FROM promovidos WHERE data->>'lote' = $1", [loteId]);
    // De abajo hacia arriba: promotores, responsables y zonas
    for (const role of ['promotor', 'resp_seccion', 'coord_zona']) await c.query("DELETE FROM users WHERE data->>'lote' = $1 AND role = $2", [loteId, role]);
  });
  await store.init({ seedIfEmpty: false });
  await settings.set(KEY, { lotes: lista.filter((x) => x.id !== loteId) }, porId);
}

module.exports = { generar, lotes, eliminar, GeneradorError };
