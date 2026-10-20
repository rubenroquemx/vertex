// Datos de ejemplo para desarrollo: completa la estructura de un CPV (Responsables de Sección,
// Promotores Territoriales y promovidos con varios estatus, historial y observaciones) hasta un
// porcentaje de avance general. Todo lo creado queda marcado con data.ejemplo = true.
//
//   npm run datos-ejemplo -- generar "José Campos Chávez" 30
//   npm run datos-ejemplo -- borrar
//
// Solo corre contra una base de datos local (localhost); nunca en producción.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL || '';
let host = '';
try {
  host = new URL(url).hostname;
} catch {}
if (!['localhost', '127.0.0.1', '::1'].includes(host) || process.env.NODE_ENV === 'production') {
  console.error('Este script solo corre contra una base de datos local (DATABASE_URL en localhost).');
  process.exit(1);
}

const db = require('../src/db');
const store = require('../src/store');
const geo = require('../src/geo');
const padron = require('../src/padron');
const metas = require('../src/metas');
const zonas = require('../src/zonas');

// ---------- Aleatoriedad reproducible ----------
let semilla = 20270606;
const rnd = () => {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
};
const entre = (a, b) => a + rnd() * (b - a);
const entero = (a, b) => Math.floor(entre(a, b + 1));
const uno = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n, w) => String(n).padStart(w, '0');

// ---------- Nombres ----------
const HOMBRES = ['JOSÉ', 'JUAN', 'LUIS', 'CARLOS', 'JORGE', 'MIGUEL', 'FRANCISCO', 'ANTONIO', 'PEDRO', 'MANUEL', 'JESÚS', 'ALEJANDRO', 'RICARDO', 'FERNANDO', 'ROBERTO', 'DANIEL', 'EDUARDO', 'RAÚL', 'JAVIER', 'SERGIO', 'ARTURO', 'ÁNGEL', 'MARIO', 'HÉCTOR', 'OSCAR', 'RAFAEL', 'ENRIQUE', 'GERARDO', 'ALBERTO', 'VÍCTOR', 'DIEGO', 'ERNESTO', 'ADRIÁN', 'RUBÉN', 'CÉSAR', 'HUGO', 'ISMAEL', 'GUSTAVO', 'ARMANDO', 'SAMUEL'];
const MUJERES = ['MARÍA', 'GUADALUPE', 'JUANA', 'MARGARITA', 'VERÓNICA', 'ROSA', 'LETICIA', 'ELIZABETH', 'PATRICIA', 'ALEJANDRA', 'GABRIELA', 'ANA', 'LAURA', 'MARTHA', 'CLAUDIA', 'ADRIANA', 'SILVIA', 'YOLANDA', 'SANDRA', 'NORMA', 'ARACELI', 'MÓNICA', 'FERNANDA', 'DANIELA', 'KARLA', 'ANDREA', 'DIANA', 'LUCÍA', 'BEATRIZ', 'ISABEL', 'CAROLINA', 'TERESA', 'ROCÍO', 'LORENA', 'MIRIAM', 'PAOLA', 'VALERIA', 'XÓCHITL', 'ESMERALDA', 'CONCEPCIÓN'];
const APELLIDOS = ['HERNÁNDEZ', 'GARCÍA', 'MARTÍNEZ', 'LÓPEZ', 'GONZÁLEZ', 'PÉREZ', 'RODRÍGUEZ', 'SÁNCHEZ', 'RAMÍREZ', 'CRUZ', 'FLORES', 'GÓMEZ', 'MORALES', 'VÁZQUEZ', 'JIMÉNEZ', 'REYES', 'DÍAZ', 'TORRES', 'GUTIÉRREZ', 'RUIZ', 'MENDOZA', 'AGUILAR', 'ORTIZ', 'CASTILLO', 'MORENO', 'ROMERO', 'ÁLVAREZ', 'CHÁVEZ', 'RIVERA', 'JUÁREZ', 'DE LA CRUZ', 'MÉNDEZ', 'DOMÍNGUEZ', 'OSORIO', 'ZAPATA', 'MAGAÑA', 'OVANDO', 'ALEJANDRO', 'CÓRDOVA', 'PRIEGO', 'ARIAS', 'GUZMÁN', 'LEÓN', 'SALVADOR', 'CAMPOS', 'VIDAL', 'ARIAS', 'MAY', 'GERÓNIMO', 'IZQUIERDO', 'PALMA', 'BURELO', 'SASTRÉ', 'TORRES', 'CARRILLO', 'MONTEJO', 'BAEZA', 'GALLEGOS', 'LANDERO', 'HIDALGO'];
const CALLES = ['AV. GREGORIO MÉNDEZ', 'AV. 27 DE FEBRERO', 'CALLE HIDALGO', 'CALLE MORELOS', 'AV. UNIVERSIDAD', 'CALLE JUÁREZ', 'AV. MÉNDEZ MAGAÑA', 'CALLE ZARAGOZA', 'CALLE ALLENDE', 'AV. PASEO TABASCO', 'CALLE ALDAMA', 'CALLE REFORMA', 'AV. RUIZ CORTINES', 'CALLE PINO SUÁREZ', 'CALLE CARRANZA', 'AV. CARLOS PELLICER', 'CALLE LOS RÍOS', 'CALLE CEDRO', 'CALLE CAOBA', 'CALLE LAS FLORES', 'PRIVADA DEL SOL', 'CALLE GUAYACÁN', 'AV. FORJADORES', 'CALLE NARDOS'];
const OBS_RS = [
  'La foto del frente salió borrosa, ¿la puedes tomar de nuevo?',
  'Revisa el número exterior, no coincide con el comprobante.',
  'Falta el apellido materno, en la INE sí aparece.',
  'El teléfono no responde, confirma el número por favor.',
  'La CURP tiene un dígito distinto al de la credencial.',
  'Verifica la calle, parece que es otra colonia.',
];
const OBS_PROMOTOR = ['Listo, ya lo corregí.', 'Mañana paso a tomar la foto otra vez.', 'Le marqué y ya me confirmó el número.', 'Ok, lo reviso con la persona.'];

const sinAcentos = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z ]/g, '');
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

// Clave de elector (6 letras + fecha + 27 + sexo + 3 dígitos) y CURP únicas
const claves = new Set();
const curps = new Set();
function identidad(persona) {
  const { paterno, materno, nombres, sexo, nac } = persona;
  const p = sinAcentos(paterno).replace(/ /g, '');
  const m = sinAcentos(materno).replace(/ /g, '') || 'X';
  const n = sinAcentos(nombres).replace(/ /g, '');
  const fecha = `${pad(nac.getFullYear() % 100, 2)}${pad(nac.getMonth() + 1, 2)}${pad(nac.getDate(), 2)}`;
  let clave;
  do {
    clave = `${p[0]}${consonanteInterna(p)}${m[0]}${consonanteInterna(m)}${n[0]}${consonanteInterna(n)}${fecha}27${sexo}${pad(entero(0, 999), 3)}`;
  } while (claves.has(clave));
  claves.add(clave);
  let curp;
  do {
    const homo = nac.getFullYear() < 2000 ? String(entero(0, 9)) : uno('ABCDEFGHJ'.split(''));
    curp = `${p[0]}${primeraVocalInterna(p)}${m[0]}${n[0]}${fecha}${sexo}TC${consonanteInterna(p)}${consonanteInterna(m)}${consonanteInterna(n)}${homo}${entero(0, 9)}`;
  } while (curps.has(curp));
  curps.add(curp);
  return { clave, curp };
}

function persona() {
  const sexo = rnd() < 0.53 ? 'M' : 'H';
  const nombres = sexo === 'M' ? (rnd() < 0.25 ? `${uno(MUJERES)} ${uno(MUJERES)}` : uno(MUJERES)) : rnd() < 0.2 ? `${uno(HOMBRES)} ${uno(HOMBRES)}` : uno(HOMBRES);
  return {
    sexo,
    nombres,
    paterno: uno(APELLIDOS),
    materno: rnd() < 0.97 ? uno(APELLIDOS) : '',
    nac: new Date(entero(1950, 2006), entero(0, 11), entero(1, 28)),
  };
}

const telefono = () => `993${pad(entero(0, 9999999), 7)}`;

// Usuario de acceso a partir del nombre (único)
const usernames = new Set();
function username(nombre) {
  const partes = sinAcentos(nombre.toUpperCase()).toLowerCase().split(' ').filter(Boolean);
  const base = `${partes[0][0]}${partes[1] || partes[0]}`.slice(0, 20);
  let u = base;
  let i = 2;
  while (usernames.has(u)) u = `${base}${i++}`;
  usernames.add(u);
  return u;
}

// ---------- Fotos de ejemplo de la INE (una por lado, compartida) ----------
async function fotosEjemplo() {
  const sharp = require('sharp');
  const svg = (lado) => `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="441">
    <rect width="700" height="441" rx="24" fill="${lado === 'frente' ? '#e7ecef' : '#eceae4'}"/>
    <rect x="28" y="28" width="644" height="56" rx="10" fill="#9aa5ad"/>
    ${lado === 'frente' ? '<rect x="40" y="110" width="170" height="210" rx="10" fill="#c3cbd1"/><circle cx="125" cy="180" r="44" fill="#a9b3ba"/>' : '<rect x="40" y="110" width="620" height="90" rx="8" fill="#d2d0c8"/>'}
    <rect x="240" y="120" width="380" height="18" rx="6" fill="#c3cbd1"/>
    <rect x="240" y="160" width="300" height="18" rx="6" fill="#c3cbd1"/>
    <rect x="240" y="200" width="340" height="18" rx="6" fill="#c3cbd1"/>
    <text x="350" y="395" font-family="Arial, sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#7d8890">INE DE EJEMPLO · ${lado.toUpperCase()}</text>
  </svg>`;
  const jpg = (lado) => sharp(Buffer.from(svg(lado))).jpeg({ quality: 55 }).toBuffer();
  return { frente: await jpg('frente'), reverso: await jpg('reverso') };
}

// ---------- Domicilios por municipio (catálogo SEPOMEX) ----------
const cpCache = new Map();
async function domicilios(cvegeo) {
  if (cpCache.has(cvegeo)) return cpCache.get(cvegeo);
  const lib = await import('@webrek/mx-cp');
  const out = [];
  for (const cp of (await lib.cpsDeMunicipio(cvegeo)).slice(0, 60)) {
    const r = await lib.buscaCP(cp);
    const asent = (r?.asentamientos || []).filter((a) => !/gran usuario/i.test(a.tipo));
    if (asent.length) out.push({ cp: r.cp, municipio: r.municipio, estado: r.estado, asent });
  }
  cpCache.set(cvegeo, out);
  return out;
}

// ---------- Inserción por lotes ----------
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

async function generar(nombreCpv, porcentaje) {
  const cpv = store.users.all().find((u) => u.role === 'coord_promocion' && u.name === nombreCpv);
  if (!cpv) throw new Error(`No encontré al CPV «${nombreCpv}».`);
  const ya = await db.query("SELECT count(*)::int n FROM users WHERE data->>'ejemplo' = 'true'");
  if (ya.rows[0].n) throw new Error('Ya hay datos de ejemplo. Bórralos primero con: npm run datos-ejemplo -- borrar');

  const cfg = metas.configDe(cpv);
  const ctx = zonas.contexto(cpv);
  if (!ctx?.hasPadron) throw new Error('El CPV no tiene padrón cargado.');
  const munDe = new Map(ctx.secciones.map((s) => [s.clave, s.municipio]));
  for (const u of store.users.all()) if (u.username) usernames.add(u.username);
  const existentes = await db.query('SELECT clave_elector, curp FROM promovidos');
  for (const r of existentes.rows) {
    claves.add(r.clave_elector);
    curps.add(r.curp);
  }

  const passwordPlano = `Ejemplo-${crypto.randomBytes(3).toString('hex')}7`;
  const passwordHash = store.passwords.hash(passwordPlano);
  const fotos = await fotosEjemplo();

  // Secciones de las zonas del CPV con su meta; las que ya tienen responsable lo conservan
  const zonasCpv = store.users.all().filter((u) => u.role === 'coord_zona' && u.parentId === cpv.id);
  const rsExistentes = new Map();
  for (const z of zonasCpv)
    for (const u of store.users.all())
      if (u.role === 'resp_seccion' && u.parentId === z.id) for (const s of u.territorio?.secciones || []) rsExistentes.set(s, u);

  const secciones = [];
  for (const z of zonasCpv)
    for (const clave of z.territorio?.secciones || []) {
      const ln = ctx.ln(clave);
      if (!ln) continue;
      const m = metas.metaSeccion(ln, cfg);
      // ~80% de las secciones con responsable; avance desigual entre secciones
      const conRS = rsExistentes.has(clave) || rnd() < 0.8;
      secciones.push({ zona: z, clave, meta: m.meta, necesarios: m.promotores, peso: conRS ? Math.pow(rnd(), 0.8) + 0.05 : 0 });
    }
  const metaTotal = secciones.reduce((t, s) => t + s.meta, 0);
  const objetivo = Math.round((metaTotal * porcentaje) / 100);
  // Ajusta el avance de cada sección para que la suma sea el objetivo (máximo 105% por sección)
  let k = 1;
  for (let it = 0; it < 30; it++) {
    const suma = secciones.reduce((t, s) => t + Math.min(1.05, s.peso * k) * s.meta, 0);
    k *= objetivo / suma;
  }
  for (const s of secciones) s.avance = Math.min(1.05, s.peso * k);

  const nuevosUsers = [];
  const filasProm = [];
  const filasIne = [];
  const filasHist = [];
  const filasObs = [];
  const conteo = { rs: 0, promotores: 0, promovidos: 0, validado: 0, en_revision: 0, observaciones: 0, rechazado: 0 };

  const nuevoUsuario = (role, parent, extra = {}, antiguedad = 90) => {
    const p = persona();
    const name = capital(`${p.nombres} ${p.paterno} ${p.materno}`.trim());
    const u = {
      id: crypto.randomUUID(),
      role,
      parent_id: parent.id,
      username: username(name),
      name,
      data: { phone: telefono(), email: '', passwordHash, ejemplo: true, ...extra },
      created_at: hace(entero(antiguedad - 15, antiguedad)),
    };
    nuevosUsers.push(u);
    return u;
  };

  for (const s of secciones) {
    if (!s.peso) continue;
    let rs = rsExistentes.get(s.clave);
    if (!rs) {
      rs = nuevoUsuario('resp_seccion', s.zona, { territorio: { tipo: 'secciones', metodo: 'manual', entidad: 27, secciones: [s.clave] } }, 95);
      conteo.rs += 1;
    }
    const totalProm = Math.round(s.meta * s.avance);
    const nPromotores = Math.max(1, Math.min(s.necesarios, Math.round(s.necesarios * Math.min(1, s.avance * entre(0.85, 1.2)))));
    const promotores = [];
    for (let i = 0; i < nPromotores; i++) {
      promotores.push({ u: nuevoUsuario('promotor', rs, {}, 80), peso: Math.pow(rnd(), 1.4) });
      conteo.promotores += 1;
    }
    const sumaPesos = promotores.reduce((t, p) => t + p.peso, 0) || 1;
    const doms = await domicilios(`27${pad(munDe.get(s.clave) || 4, 3)}`);
    let restantes = totalProm;
    promotores.forEach((p, i) => {
      const n = i === promotores.length - 1 ? restantes : Math.min(restantes, Math.round((totalProm * p.peso) / sumaPesos));
      restantes -= n;
      for (let j = 0; j < n; j++) crearPromovido(p.u, rs, s.clave, doms);
    });
  }

  function crearPromovido(promotor, rs, seccion, doms) {
    const p = persona();
    const { clave, curp } = identidad(p);
    const d = uno(doms);
    const a = uno(d.asent);
    const creado = hace(Math.floor(Math.pow(rnd(), 1.6) * 70));
    const data = {
      vigencia: entero(2027, 2034),
      paterno: p.paterno,
      materno: p.materno,
      nombres: p.nombres,
      telefono: telefono(),
      ejemplo: true,
      domicilio: {
        cp: d.cp,
        calle: uno(CALLES),
        numExt: rnd() < 0.08 ? 'S/N' : String(entero(1, 980)),
        numInt: rnd() < 0.12 ? String(entero(1, 12)) : '',
        fracc: /fraccionamiento/i.test(a.tipo) ? a.nombre.toUpperCase() : '',
        localidad: a.nombre.toUpperCase(),
        municipio: d.municipio,
        estado: d.estado,
      },
    };
    // Estatus: aprobados, en revisión, con observaciones del responsable y algunos rechazados
    const x = rnd();
    const tipo = x < 0.52 ? 'validado' : x < 0.82 ? 'en_revision' : x < 0.95 ? 'observaciones' : 'rechazado';
    const estatus = tipo === 'observaciones' ? 'en_revision' : tipo;
    const revisado = estatus === 'en_revision' ? null : new Date(Math.min(Date.now() - 3600000, creado.getTime() + entero(2, 96) * 3600000));
    const id = crypto.randomUUID();
    filasProm.push([id, promotor.id, rs.id, seccion, data, clave, curp, estatus, revisado ? rs.id : null, revisado, creado, cpv.id]);
    filasIne.push([id, 'frente', fotos.frente], [id, 'reverso', fotos.reverso]);
    filasHist.push([id, promotor.id, promotor.name, 'creado', '[]', creado]);
    if (rnd() < 0.12) {
      const t = new Date(creado.getTime() + entero(1, 30) * 3600000);
      if (t < Date.now()) filasHist.push([id, promotor.id, promotor.name, 'editado', JSON.stringify([{ campo: 'Teléfono (WhatsApp)', antes: telefono(), despues: data.telefono }]), t]);
    }
    if (revisado) {
      filasHist.push([id, rs.id, rs.name, 'editado', JSON.stringify([{ campo: 'Estatus', antes: 'En revisión', despues: estatus === 'validado' ? 'Validado' : 'Rechazado' }]), revisado]);
    }
    if (tipo === 'observaciones' || tipo === 'rechazado') {
      const t1 = new Date(Math.min(Date.now() - 1800000, creado.getTime() + entero(1, 48) * 3600000));
      filasObs.push([id, rs.id, rs.name, uno(OBS_RS), t1]);
      if (rnd() < 0.5) filasObs.push([id, promotor.id, promotor.name, uno(OBS_PROMOTOR), new Date(Math.min(Date.now() - 600000, t1.getTime() + entero(1, 20) * 3600000))]);
    }
    conteo.promovidos += 1;
    conteo[tipo] += 1;
  }

  // Unos promovidos más para las cuentas de prueba que ya existían (p. ej. Ernesto)
  for (const promotor of store.users.all().filter((u) => u.role === 'promotor')) {
    const rs = store.users.get(promotor.parentId);
    const z = rs && store.users.get(rs.parentId);
    if (!z || z.parentId !== cpv.id) continue;
    const seccion = rs.territorio?.secciones?.[0];
    if (!seccion) continue;
    const doms = await domicilios(`27${pad(munDe.get(seccion) || 4, 3)}`);
    for (let j = 0; j < 24; j++) crearPromovido(promotor, rs, seccion, doms);
  }

  console.log(`Insertando ${nuevosUsers.length} cuentas y ${filasProm.length} promovidos…`);
  await db.tx(async (c) => {
    await insertarLote(
      c,
      'users',
      ['id', 'role', 'parent_id', 'username', 'name', 'data', 'created_at'],
      // Primero los responsables (los promotores dependen de ellos)
      [...nuevosUsers].sort((a, b) => (a.role === 'resp_seccion' ? -1 : 1) - (b.role === 'resp_seccion' ? -1 : 1)).map((u) => [u.id, u.role, u.parent_id, u.username, u.name, u.data, u.created_at])
    );
    await insertarLote(c, 'promovidos', ['id', 'promotor_id', 'responsable_id', 'seccion', 'data', 'clave_elector', 'curp', 'estatus', 'revisado_por', 'revisado_at', 'created_at', 'cpv_id'], filasProm);
    await insertarLote(c, 'promovido_ine', ['promovido_id', 'lado', 'image'], filasIne);
    await insertarLote(c, 'promovido_historial', ['promovido_id', 'user_id', 'user_name', 'accion', 'cambios', 'at'], filasHist);
    await insertarLote(c, 'promovido_observaciones', ['promovido_id', 'user_id', 'user_name', 'texto', 'at'], filasObs);
  });

  const archivo = path.join(__dirname, '..', 'data', 'CUENTAS_EJEMPLO.txt');
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, `Cuentas de ejemplo (solo local). Todas usan la misma contraseña:\n${passwordPlano}\n`);

  console.log(`Meta total del CPV: ${metaTotal.toLocaleString('es-MX')} promovidos · objetivo ${porcentaje}%: ${objetivo.toLocaleString('es-MX')}`);
  console.log(JSON.stringify(conteo));
  console.log(`Contraseña de las cuentas de ejemplo guardada en data/CUENTAS_EJEMPLO.txt`);
  console.log('Reinicia el servidor para que tome los datos nuevos.');
}

// ---------- Material electoral de ejemplo ----------
// Lo creado se anota en data/MATERIAL_EJEMPLO.json para poder borrarlo sin tocar lo capturado a mano.
const REGISTRO_MATERIAL = path.join(__dirname, '..', 'data', 'MATERIAL_EJEMPLO.json');
const ARTICULOS_EJEMPLO = [
  ['Gorra', 'piezas', 24000],
  ['Playera', 'piezas', 18000],
  ['Bandera', 'piezas', 9000],
  ['Volante', 'millares', 400],
  ['Calcomanía para auto', 'piezas', 30000],
  ['Lona', 'piezas', 900],
  ['Pulsera', 'piezas', 35000],
  ['Abanico', 'piezas', 12000],
  ['Bolsa ecológica', 'piezas', 8000],
];
const NOTAS = ['', '', '', 'Para el recorrido del fin de semana', 'Reforzar colonias del centro', 'Material para el evento del domingo', 'Primera entrega del mes'];

async function fotosEvidencia() {
  const sharp = require('sharp');
  const colores = ['#c9d6df', '#d8cfc4', '#cfd8c4', '#d6c9df', '#dfd2c9', '#c4d3d8'];
  return Promise.all(
    colores.map((c, i) =>
      sharp(
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
          <rect width="640" height="480" fill="${c}"/>
          <circle cx="${180 + i * 40}" cy="200" r="70" fill="#ffffff" opacity=".45"/>
          <rect x="${300 - i * 20}" y="230" width="220" height="140" rx="16" fill="#ffffff" opacity=".35"/>
          <text x="320" y="440" font-family="Arial, sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="#5b6770">EVIDENCIA DE EJEMPLO ${i + 1}</text>
        </svg>`)
      )
        .jpeg({ quality: 60 })
        .toBuffer()
    )
  );
}

// Reparte `total` en partes enteras proporcionales a `pesos`
function repartir(total, pesos) {
  const suma = pesos.reduce((t, p) => t + p, 0) || 1;
  const partes = pesos.map((p) => Math.floor((total * p) / suma));
  let resto = total - partes.reduce((t, p) => t + p, 0);
  for (let i = 0; resto > 0; i = (i + 1) % partes.length, resto--) partes[i] += 1;
  return partes;
}

async function generarMaterial(nombreCpv) {
  const cpv = store.users.all().find((u) => u.role === 'coord_promocion' && u.name === nombreCpv);
  if (!cpv) throw new Error(`No encontré al CPV «${nombreCpv}».`);
  if (fs.existsSync(REGISTRO_MATERIAL)) throw new Error('Ya hay material de ejemplo. Bórralo primero con: npm run datos-ejemplo -- borrar-material');
  const existentes = await db.query('SELECT lower(nombre) n FROM material_articulos WHERE cpv_id = $1', [cpv.id]);
  const ocupados = new Set(existentes.rows.map((r) => r.n));
  const articulos = ARTICULOS_EJEMPLO.filter(([n]) => !ocupados.has(n.toLowerCase())).map(([nombre, unidad, total]) => ({
    id: crypto.randomUUID(),
    nombre,
    unidad,
    total,
  }));
  const fotos = await fotosEvidencia();
  const todos = store.users.all();
  const zonasCpv = todos.filter((u) => u.role === 'coord_zona' && u.parentId === cpv.id);
  const registro = { articulos: articulos.map((a) => a.id), ordenes: [] };
  const conteo = { articulos: articulos.length, ordenesZona: 0, ordenesResponsable: 0, pendientes: 0, recibidas: 0, comprobadas: 0, fotos: 0 };

  await db.tx(async (c) => {
    const orden = async ({ de, para, items, estado, creada, nota = '' }) => {
      const id = crypto.randomUUID();
      const recibida = estado === 'pendiente' ? null : new Date(Math.min(Date.now() - 3600000, creada.getTime() + entero(2, 48) * 3600000));
      const comprobada = estado === 'comprobada' ? new Date(Math.min(Date.now() - 1800000, recibida.getTime() + entero(4, 120) * 3600000)) : null;
      await c.query(
        'INSERT INTO material_ordenes (id, cpv_id, de_id, para_id, estado, nota, created_at, recibida_at, comprobada_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, cpv.id, de.id, para.id, estado, nota, creada, recibida, comprobada]
      );
      for (const it of items.filter((i) => i.cantidad > 0))
        await c.query('INSERT INTO material_orden_items (orden_id, articulo_id, cantidad) VALUES ($1, $2, $3)', [id, it.articulo.id, it.cantidad]);
      if (comprobada) {
        const n = entero(5, 9);
        for (let k = 0; k < n; k++)
          await c.query('INSERT INTO material_evidencias (orden_id, user_id, image, at) VALUES ($1, $2, $3, $4)', [id, para.id, fotos[(k + entero(0, 5)) % fotos.length], comprobada]);
        conteo.fotos += n;
      }
      registro.ordenes.push(id);
      conteo[estado === 'pendiente' ? 'pendientes' : estado === 'recibida' ? 'recibidas' : 'comprobadas'] += 1;
      return id;
    };

    // Inventario del CPV: artículos con 2 o 3 entradas en los últimos 2 meses
    for (const a of articulos) {
      await c.query('INSERT INTO material_articulos (id, cpv_id, nombre, unidad, created_at) VALUES ($1, $2, $3, $4, $5)', [a.id, cpv.id, a.nombre, a.unidad, hace(65)]);
      const entradas = repartir(a.total, Array.from({ length: entero(2, 3) }, () => entre(0.5, 1.5)));
      for (const [i, n] of entradas.entries())
        await c.query('INSERT INTO material_entradas (cpv_id, articulo_id, cantidad, user_id, at) VALUES ($1, $2, $3, $1, $4)', [cpv.id, a.id, n, hace(60 - i * 18)]);
    }

    // CPV → zonas: ~75% del inventario, según el tamaño de cada zona; 2 o 3 órdenes por zona
    const pesosZona = zonasCpv.map((z) => (z.territorio?.secciones || []).length || 1);
    const recibidoZona = new Map(zonasCpv.map((z) => [z.id, new Map()]));
    for (const a of articulos) a.porZona = repartir(Math.floor(a.total * entre(0.65, 0.85)), pesosZona);
    for (const [zi, z] of zonasCpv.entries()) {
      const nOrdenes = entero(2, 3);
      for (let k = 0; k < nOrdenes; k++) {
        const ultima = k === nOrdenes - 1;
        const items = articulos
          .filter(() => rnd() < 0.75)
          .map((a) => ({ articulo: a, cantidad: Math.floor(a.porZona[zi] / nOrdenes) }));
        if (!items.length) continue;
        // La última orden de algunas zonas sigue por recibir
        const estado = ultima && rnd() < 0.35 ? 'pendiente' : 'recibida';
        await orden({ de: cpv, para: z, items, estado, creada: hace(50 - k * 15), nota: uno(NOTAS) });
        conteo.ordenesZona += 1;
        if (estado !== 'pendiente') for (const it of items) recibidoZona.get(z.id).set(it.articulo.id, (recibidoZona.get(z.id).get(it.articulo.id) || 0) + it.cantidad);
      }
    }

    // Zona → Responsables de Sección: reparten ~70% de lo recibido; 1 o 2 órdenes por responsable
    for (const z of zonasCpv) {
      const responsables = todos.filter((u) => u.role === 'resp_seccion' && u.parentId === z.id);
      if (!responsables.length) continue;
      const pesos = responsables.map(() => entre(0.5, 1.5));
      const cuotas = new Map();
      for (const [artId, n] of recibidoZona.get(z.id)) cuotas.set(artId, repartir(Math.floor(n * entre(0.6, 0.8)), pesos));
      for (const [ri, rs] of responsables.entries()) {
        const nOrdenes = rnd() < 0.4 ? 2 : 1;
        for (let k = 0; k < nOrdenes; k++) {
          const items = articulos
            .filter((a) => cuotas.has(a.id) && rnd() < 0.7)
            .map((a) => ({ articulo: a, cantidad: Math.floor(cuotas.get(a.id)[ri] / nOrdenes) }))
            .filter((i) => i.cantidad > 0);
          if (!items.length) continue;
          const x = rnd();
          const estado = x < 0.55 ? 'comprobada' : x < 0.8 ? 'recibida' : 'pendiente';
          await orden({ de: z, para: rs, items, estado, creada: hace(entero(2, 16) - k), nota: uno(NOTAS) });
          conteo.ordenesResponsable += 1;
        }
      }
    }
  });

  fs.mkdirSync(path.dirname(REGISTRO_MATERIAL), { recursive: true });
  fs.writeFileSync(REGISTRO_MATERIAL, JSON.stringify(registro));
  console.log(JSON.stringify(conteo));
}

async function borrarMaterial() {
  if (!fs.existsSync(REGISTRO_MATERIAL)) return console.log('No hay material de ejemplo registrado.');
  const r = JSON.parse(fs.readFileSync(REGISTRO_MATERIAL, 'utf8'));
  const o = await db.query('DELETE FROM material_ordenes WHERE id = ANY($1::uuid[])', [r.ordenes]);
  const a = await db.query('DELETE FROM material_articulos WHERE id = ANY($1::uuid[])', [r.articulos]);
  fs.unlinkSync(REGISTRO_MATERIAL);
  console.log(`Borrados: ${a.rowCount} artículos y ${o.rowCount} órdenes de entrega de ejemplo.`);
}

async function borrar() {
  await borrarMaterial();
  const c1 = await db.query("DELETE FROM promovidos WHERE data->>'ejemplo' = 'true'");
  // Primero los promotores y después los responsables
  const c2 = await db.query("DELETE FROM users WHERE data->>'ejemplo' = 'true' AND role = 'promotor'");
  const c3 = await db.query("DELETE FROM users WHERE data->>'ejemplo' = 'true'");
  console.log(`Borrados: ${c1.rowCount} promovidos y ${c2.rowCount + c3.rowCount} cuentas de ejemplo. Reinicia el servidor.`);
}

(async () => {
  const [accion, nombre = 'José Campos Chávez', pct = '30'] = process.argv.slice(2);
  await db.migrate();
  await store.init({ seedIfEmpty: false });
  if (accion === 'generar') {
    await geo.init();
    await padron.init();
    await generar(nombre, Number(pct));
  } else if (accion === 'material') {
    await generarMaterial(nombre);
  } else if (accion === 'borrar-material') {
    await borrarMaterial();
  } else if (accion === 'borrar') {
    await borrar();
  } else {
    console.log(
      'Uso: npm run datos-ejemplo -- generar "Nombre del CPV" 30 | material "Nombre del CPV" | borrar-material | borrar'
    );
  }
  await db.pool.end();
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
