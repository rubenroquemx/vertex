// Prueba de carga de VERTEX (sin dependencias). Mide, por tipo de operación, cuántas peticiones
// por segundo aguanta el servidor y con qué tiempos de respuesta, subiendo la concurrencia por escalones.
//
//   Local (usa /api/dev/session, solo existe fuera de producción):
//     node --env-file=.env scripts/prueba-carga.js
//   Otro servidor (inicia sesión con cuentas de prueba; contraseña en variable de entorno):
//     CARGA_URL=https://... CARGA_PROMOTOR=usuario CARGA_RS=usuario CARGA_CPV=usuario CARGA_SA=usuario \
//     CARGA_PASSWORD=... CARGA_PASSWORD_SA=... node scripts/prueba-carga.js
//
// Opciones: CARGA_NIVELES=10,50,100  CARGA_SEGUNDOS=15  CARGA_ESCENARIOS=notificaciones,captura,...
//           CARGA_ESCRITURA=0 para no crear promovidos (solo lectura)
// Los promovidos de prueba llevan apellido paterno PRUEBACARGA (para borrarlos después).
const sharp = require('sharp');

const BASE = (process.env.CARGA_URL || 'http://localhost:3000').replace(/\/$/, '');
const NIVELES = (process.env.CARGA_NIVELES || '10,50,100').split(',').map(Number);
const SEGUNDOS = Number(process.env.CARGA_SEGUNDOS || 15);
const ESCRITURA = process.env.CARGA_ESCRITURA !== '0';
const LOCAL = !process.env.CARGA_URL;

// ---------- Sesiones ----------
async function sesion({ userId, usuario, password }) {
  const r = LOCAL
    ? await fetch(`${BASE}/api/dev/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
    : await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: usuario, password }) });
  if (!r.ok) throw new Error(`No se pudo iniciar sesión (${r.status})`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function cuentasLocales() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async (sql) => (await pool.query(sql)).rows[0];
  // Promotor y responsable de ejemplo con sección; un CPV y el super administrador
  const prom = await q(`SELECT p.id, r.id AS rs FROM users p JOIN users r ON r.id = p.parent_id
    WHERE p.role = 'promotor' AND p.data->>'ejemplo' = 'true' AND r.data->'territorio'->'secciones' IS NOT NULL
    AND (SELECT count(*) FROM promovidos x WHERE x.responsable_id = r.id) > 100 LIMIT 1`);
  const cpv = await q(`SELECT id FROM users WHERE role = 'coord_promocion' ORDER BY (SELECT count(*) FROM users z WHERE z.parent_id = users.id) DESC LIMIT 1`);
  const sa = await q(`SELECT id FROM users WHERE role = 'superadmin' LIMIT 1`);
  const foto = await q(`SELECT promovido_id AS id FROM promovido_ine WHERE promovido_id IN (SELECT id FROM promovidos WHERE promotor_id = '${prom.id}') LIMIT 1`);
  await pool.end();
  return { promotor: { userId: prom.id }, rs: { userId: prom.rs }, cpv: { userId: cpv.id }, sa: { userId: sa.id }, fotoId: foto?.id };
}

// Foto con «ruido» para que pese como una real (~200-300 KB)
async function fotoReal() {
  const w = 1400;
  const h = 883;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 251 ^ ((i >> 7) & 0x3f);
  const jpg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(0.6).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

// ---------- Escenarios ----------
// Clave de elector y CURP únicas y con formato válido a partir de un número
const CORRIDA = Math.floor(Math.random() * 100);
let serie = 0;
function identidad(k) {
  const d2 = (n) => String(n).padStart(2, '0');
  const clave = `PRCRCA${String(k).padStart(8, '0')}H001`;
  const yy = k % 100;
  const mm = 1 + (Math.floor(k / 100) % 12);
  const dd = 1 + (Math.floor(k / 1200) % 28);
  const x = Math.floor(k / 33600);
  const homo = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[x % 36];
  const dig = Math.floor(x / 36) % 10;
  return { clave, curp: `PACA${d2(yy)}${d2(mm)}${d2(dd)}HTCRMS${homo}${dig}` };
}
function escenarios(c, extra) {
  const get = (cookie, path) => () => fetch(BASE + path, { headers: { cookie } });
  return {
    notificaciones: { t: 'Contador de notificaciones (cada 30 s por usuario)', fn: get(c.promotor, '/api/notificaciones/conteo') },
    panelPromotor: { t: 'Panel del Promotor', fn: get(c.promotor, '/api/escritorio/promotor') },
    listaPromotor: { t: 'Lista de promovidos del Promotor', fn: get(c.promotor, '/api/promovidos') },
    bandejaRS: { t: 'Bandeja de revisión del Responsable', fn: get(c.rs, '/api/revision') },
    panelRS: { t: 'Panel del Responsable', fn: get(c.rs, '/api/escritorio/seccion') },
    fotoINE: { t: 'Ver foto de INE', fn: extra.fotoId ? get(c.rs, `/api/promovidos/${extra.fotoId}/ine/frente`) : null },
    panelCPV: { t: 'Escritorio del CPV', fn: get(c.cpv, '/api/escritorio/cpv') },
    panelSA: { t: 'Panel del Super administrador', fn: get(c.sa, '/api/panel/sa') },
    captura: {
      t: 'Captura de promovido con 2 fotos',
      fn: ESCRITURA
        ? () => {
            const { clave, curp } = identidad(CORRIDA * 100000 + serie++);
            const body = { ...extra.base, paterno: 'PRUEBACARGA', nombres: `CARGA ${clave.slice(6, 14)}`, claveElector: clave, curp, clientId: crypto.randomUUID() };
            return fetch(`${BASE}/api/promovidos`, { method: 'POST', headers: { cookie: c.promotor, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          }
        : null,
    },
  };
}

// ---------- Medición ----------
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function medir(fn, concurrencia, segundos) {
  const tiempos = [];
  let errores = 0;
  let codigos = {};
  const fin = Date.now() + segundos * 1000;
  const vu = async () => {
    while (Date.now() < fin) {
      const t = performance.now();
      try {
        const r = await fn();
        await r.arrayBuffer();
        if (!r.ok) {
          errores += 1;
          codigos[r.status] = (codigos[r.status] || 0) + 1;
        }
      } catch {
        errores += 1;
        codigos.red = (codigos.red || 0) + 1;
      }
      tiempos.push(performance.now() - t);
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrencia }, vu));
  const dur = (Date.now() - t0) / 1000;
  return {
    rps: tiempos.length / dur,
    p50: pct(tiempos, 50),
    p95: pct(tiempos, 95),
    errores: tiempos.length ? errores / tiempos.length : 0,
    codigos,
  };
}

(async () => {
  console.log(`Servidor: ${BASE} · niveles ${NIVELES.join(', ')} · ${SEGUNDOS} s por nivel · escritura ${ESCRITURA ? 'sí' : 'no'}`);
  const cuentas = LOCAL
    ? await cuentasLocales()
    : {
        promotor: { usuario: process.env.CARGA_PROMOTOR, password: process.env.CARGA_PASSWORD },
        rs: { usuario: process.env.CARGA_RS, password: process.env.CARGA_PASSWORD },
        cpv: { usuario: process.env.CARGA_CPV, password: process.env.CARGA_PASSWORD_CPV || process.env.CARGA_PASSWORD },
        sa: { usuario: process.env.CARGA_SA, password: process.env.CARGA_PASSWORD_SA || process.env.CARGA_PASSWORD },
      };
  const c = {};
  for (const k of ['promotor', 'rs', 'cpv', 'sa']) c[k] = await sesion(cuentas[k]);
  const ctx = await (await fetch(`${BASE}/api/promovidos/contexto`, { headers: { cookie: c.promotor } })).json();
  const foto = ESCRITURA ? await fotoReal() : null;
  if (foto) console.log(`Foto de prueba: ${Math.round((foto.length * 0.75) / 1024)} KB`);
  const base = {
    ineFrente: foto,
    ineReverso: foto,
    consentimiento: true,
    vigencia: '2031',
    seccion: String(ctx.seccion),
    materno: 'PRUEBA',
    telefono: '9930000000',
    cp: '86000',
    localidad: 'CENTRO',
    calle: 'CALLE DE PRUEBA',
    numExt: '1',
    numInt: '',
    fracc: '',
  };
  const todos = escenarios(c, { fotoId: cuentas.fotoId, base });
  const elegidos = (process.env.CARGA_ESCENARIOS || Object.keys(todos).join(',')).split(',').filter((k) => todos[k]?.fn);

  const resultados = [];
  for (const k of elegidos) {
    console.log(`\n${todos[k].t}`);
    for (const n of NIVELES) {
      const r = await medir(todos[k].fn, n, SEGUNDOS);
      resultados.push({ escenario: k, concurrencia: n, ...r });
      console.log(
        `  ${String(n).padStart(4)} simultáneos → ${r.rps.toFixed(1).padStart(7)} pet/s · mediana ${r.p50.toFixed(0).padStart(5)} ms · p95 ${r.p95.toFixed(0).padStart(5)} ms · errores ${(r.errores * 100).toFixed(1)}%${
          Object.keys(r.codigos).length ? ` ${JSON.stringify(r.codigos)}` : ''
        }`
      );
      // Si ya se cayó, no tiene caso subir más
      if (r.errores > 0.2 || r.p95 > 15000) break;
    }
  }
  require('fs').writeFileSync('data/prueba-carga.json', JSON.stringify({ base: BASE, fecha: new Date().toISOString(), resultados }, null, 2));
  console.log('\nResultados guardados en data/prueba-carga.json');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
