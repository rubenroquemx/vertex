// Datos de ejemplo de la agenda y de las estructuras paralelas (externas).
// Se cargan solos UNA vez al arrancar, solo si no hay eventos ni estructuras externas, sobre la estructura
// del CPV con más promovidos: tres estructuras paralelas (con personas en común con la nuestra y entre ellas),
// asambleas y recorridos en borrador, publicados, realizados (con reporte, fotos y lista de asistencia) y
// cancelados. Quedan registrados en settings («ejemplo.agenda») para poder borrarlos con los demás datos de ejemplo.
const crypto = require('crypto');
const sharp = require('sharp');
const { query, tx } = require('./db');
const { users } = require('./store');
const settings = require('./settings');

const CLAVE = 'ejemplo.agenda';
const TZ_OFFSET = '-06:00';

// ---------- Aleatorio con semilla (los mismos datos en cada carga) ----------
let semilla = 20261016;
const rnd = () => {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
};
const entero = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const uno = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n, w) => String(n).padStart(w, '0');
function muestra(arr, n) {
  const copia = [...arr];
  const out = [];
  while (out.length < n && copia.length) out.push(copia.splice(Math.floor(rnd() * copia.length), 1)[0]);
  return out;
}

// ---------- Personas ficticias ----------
const HOMBRES = ['JOSÉ', 'JUAN', 'LUIS', 'CARLOS', 'JORGE', 'MIGUEL', 'FRANCISCO', 'ANTONIO', 'PEDRO', 'MANUEL', 'JESÚS', 'ALEJANDRO', 'RICARDO', 'FERNANDO', 'ROBERTO', 'DANIEL', 'EDUARDO', 'RAÚL', 'JAVIER', 'SERGIO', 'ARTURO', 'ÁNGEL', 'MARIO', 'HÉCTOR', 'OSCAR', 'RAFAEL'];
const MUJERES = ['MARÍA', 'GUADALUPE', 'JUANA', 'MARGARITA', 'VERÓNICA', 'ROSA', 'LETICIA', 'ELIZABETH', 'PATRICIA', 'ALEJANDRA', 'GABRIELA', 'ANA', 'LAURA', 'MARTHA', 'CLAUDIA', 'ADRIANA', 'SILVIA', 'YOLANDA', 'SANDRA', 'NORMA', 'ARACELI', 'MÓNICA'];
const APELLIDOS = ['HERNÁNDEZ', 'GARCÍA', 'MARTÍNEZ', 'LÓPEZ', 'GONZÁLEZ', 'PÉREZ', 'RODRÍGUEZ', 'SÁNCHEZ', 'RAMÍREZ', 'CRUZ', 'FLORES', 'GÓMEZ', 'MORALES', 'VÁZQUEZ', 'JIMÉNEZ', 'REYES', 'DÍAZ', 'TORRES', 'RUIZ', 'MENDOZA', 'AGUILAR', 'ORTIZ', 'CASTILLO', 'MORENO', 'ÁLVAREZ', 'CHÁVEZ', 'DE LA CRUZ', 'MÉNDEZ', 'DOMÍNGUEZ', 'OSORIO', 'ZAPATA', 'MAGAÑA', 'OVANDO', 'CÓRDOVA', 'PRIEGO', 'ARIAS', 'GUZMÁN', 'LEÓN', 'CAMPOS', 'VIDAL', 'MAY', 'GERÓNIMO', 'PALMA', 'BURELO'];
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z]/g, '');
const consonante = (s) => {
  const x = sinAcentos(s);
  for (let i = 1; i < x.length; i++) if (!'AEIOU'.includes(x[i])) return x[i];
  return 'X';
};
const usadas = new Set();
function ficticia(secciones) {
  const sexo = rnd() < 0.53 ? 'M' : 'H';
  const nombres = uno(sexo === 'M' ? MUJERES : HOMBRES);
  const paterno = uno(APELLIDOS);
  const materno = uno(APELLIDOS);
  const p = sinAcentos(paterno);
  const m = sinAcentos(materno);
  const n = sinAcentos(nombres);
  const fecha = `${pad(entero(50, 99), 2)}${pad(entero(1, 12), 2)}${pad(entero(1, 28), 2)}`;
  let clave;
  do clave = `${p[0]}${consonante(paterno)}${m[0]}${consonante(materno)}${n[0]}${consonante(nombres)}${fecha}27${sexo}${pad(entero(0, 999), 3)}`;
  while (usadas.has(clave));
  usadas.add(clave);
  return { c: clave, u: null, paterno, materno, nombres, tel: `993${pad(entero(0, 9999999), 7)}`, seccion: secciones.length ? uno(secciones) : null };
}

// ---------- Lugares (Villahermosa) ----------
const ASAMBLEAS = ['Cancha de la colonia Atasta', 'Explanada de Tamulté de las Barrancas', 'Domo de la colonia Gaviotas', 'Parque de la colonia Indeco', 'Salón ejidal de Anacleto Canabal', 'Cancha techada de Casa Blanca', 'Parque Tomás Garrido', 'Explanada del mercado José María Pino Suárez', 'Domo de la colonia Primero de Mayo', 'Centro comunitario de La Manga'];
const RECORRIDOS = ['Colonia Gil y Sáenz', 'Colonia Atasta', 'Colonia Tamulté', 'Fraccionamiento Carrizal', 'Colonia Centro', 'Colonia Miguel Hidalgo', 'Colonia Casa Blanca', 'Colonia La Manga', 'Colonia Gaviotas Norte', 'Colonia Primero de Mayo', 'Colonia Indeco', 'Ciudad Industrial'];
const NECESIDADES = ['Planta de luz', 'Iluminación', 'Sonido', 'Templete', 'Sillas', 'Mesas', 'Carpa o toldo', 'Pantalla', 'Transporte'];
const NOTAS = ['Coordinar con el comisariado ejidal el permiso del espacio.', 'Llegar una hora antes para montar sonido y sillas.', 'Invitar a los comités de colonia.', 'Hay estacionamiento limitado; promover que lleguen caminando.', 'Llevar volantes y gorras para el cierre.', ''];
const OBS_REPORTE = [
  'Buena participación; las principales peticiones fueron alumbrado público y bacheo.',
  'La gente pidió más seguridad en las noches y patrullaje.',
  'Se registraron compromisos para regresar con el candidato en un mes.',
  'Llovió al inicio, pero la asistencia se mantuvo.',
  'Se recogieron peticiones sobre el servicio de agua potable.',
  'Muy buena recepción; varios vecinos se ofrecieron como promotores.',
];
const MOTIVOS_CANCELACION = ['Lluvia intensa en la zona.', 'Cambio en la agenda del candidato.', 'No se consiguió el permiso del espacio.'];

// Coordenadas dentro de Villahermosa y una ruta «por calles» (tramos en ángulo recto)
const punto = () => [17.965 + rnd() * 0.06, -92.97 + rnd() * 0.075];
function ruta() {
  let [la, lo] = punto();
  const puntos = [[la, lo]];
  const trazo = [[la, lo]];
  for (let i = 0, n = entero(3, 5); i < n; i++) {
    const dLa = (rnd() < 0.5 ? -1 : 1) * (0.002 + rnd() * 0.004);
    const dLo = (rnd() < 0.5 ? -1 : 1) * (0.002 + rnd() * 0.004);
    trazo.push([la + dLa, lo]);
    la += dLa;
    lo += dLo;
    trazo.push([la, lo]);
    puntos.push([la, lo]);
  }
  const r6 = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
  let km = 0;
  const rad = (x) => (x * Math.PI) / 180;
  for (let i = 1; i < trazo.length; i++) {
    const [a1, o1] = trazo[i - 1];
    const [a2, o2] = trazo[i];
    const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
    km += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  return { puntos: puntos.map(r6), trazo: trazo.map(r6), km: Math.round(km * 100) / 100, calles: false };
}

// Fotos de ejemplo (rótulo sobre un color), compartidas entre eventos
async function foto(texto, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="100%" height="100%" fill="${color}"/>
    <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="48" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${texto}</text></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 70 }).toBuffer();
}

async function insertarPersonas(c, tabla, campoId, id, personas) {
  for (let i = 0; i < personas.length; i += 5000) {
    const l = personas.slice(i, i + 5000);
    await c.query(
      `INSERT INTO ${tabla} (${campoId}, clave_elector, curp, paterno, materno, nombres, telefono, seccion)
       SELECT $1, f.c, f.u, f.p, f.m, f.n, f.t, f.s FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[]) AS f(c, u, p, m, n, t, s)
       ON CONFLICT DO NOTHING`,
      [id, l.map((x) => x.c), l.map((x) => x.u), l.map((x) => x.paterno), l.map((x) => x.materno), l.map((x) => x.nombres), l.map((x) => x.tel), l.map((x) => x.seccion)]
    );
  }
}

async function sembrar() {
  if (settings.get(CLAVE)) return null;
  const vacio = (await query('SELECT (SELECT count(*) FROM eventos)::int AS e, (SELECT count(*) FROM estructuras_externas)::int AS x')).rows[0];
  if (vacio.e || vacio.x) {
    await settings.set(CLAVE, { omitido: true, motivo: 'Ya había eventos o estructuras externas', at: new Date().toISOString() });
    return null;
  }
  // CPV con más promovidos
  const { rows: top } = await query(
    `SELECT z.parent_id AS cpv, count(*)::int AS n FROM promovidos p
     JOIN users rs ON rs.id = p.responsable_id JOIN users z ON z.id = rs.parent_id
     GROUP BY 1 ORDER BY 2 DESC LIMIT 1`
  );
  const cpv = top[0] && users.get(top[0].cpv);
  if (!cpv || cpv.role !== 'coord_promocion') return null;
  const zonas = users.hijos(cpv.id, 'coord_zona');
  if (!zonas.length) return null;
  const rsDe = new Map(zonas.map((z) => [z.id, users.hijos(z.id, 'resp_seccion')]));
  const zonaDeRs = new Map();
  for (const [z, l] of rsDe) for (const r of l) zonaDeRs.set(r.id, z);
  const secciones = [...new Set([...rsDe.values()].flat().flatMap((r) => r.territorio?.secciones || []))];

  // Promovidos del árbol (por zona) para mezclarlos en las listas
  const { rows: prom } = await query(
    `SELECT p.clave_elector AS c, p.curp AS u, p.data->>'paterno' AS paterno, p.data->>'materno' AS materno, p.data->>'nombres' AS nombres,
            p.data->>'telefono' AS tel, p.seccion, p.responsable_id AS rs
     FROM promovidos p JOIN users rs ON rs.id = p.responsable_id JOIN users z ON z.id = rs.parent_id WHERE z.parent_id = $1`,
    [cpv.id]
  );
  const promovidos = prom.map((p) => ({ ...p, paterno: p.paterno || '', materno: p.materno || '', nombres: p.nombres || '', tel: p.tel || '' }));
  const porZona = new Map(zonas.map((z) => [z.id, []]));
  for (const p of promovidos) porZona.get(zonaDeRs.get(p.rs))?.push(p);

  // ---------- Estructuras paralelas ----------
  const fakeA = Array.from({ length: 1500 }, () => ficticia(secciones));
  const fakeB = Array.from({ length: 600 }, () => ficticia(secciones));
  const fakeC = Array.from({ length: 300 }, () => ficticia(secciones));
  const nuestrosA = muestra(promovidos, 900);
  const estructuras = [
    { nombre: 'Red Ciudadana Aliada', personas: [...nuestrosA, ...fakeA] },
    { nombre: 'Estructura Vecinal Sur', personas: [...muestra(nuestrosA, 150), ...muestra(promovidos, 150), ...muestra(fakeA, 300), ...fakeB] },
    { nombre: 'Organización Juvenil Tabasqueña', personas: [...muestra(nuestrosA, 60), ...muestra(promovidos, 60), ...muestra(fakeA, 100), ...muestra(fakeB, 80), ...fakeC] },
  ];
  const huerfanos = Array.from({ length: 250 }, () => ficticia(secciones));
  const externasPool = [...fakeA, ...fakeB, ...fakeC];

  // ---------- Fotos ----------
  const fotosLugar = await Promise.all([foto('Lugar del evento (ejemplo)', '#2a78d6'), foto('Lugar del evento (ejemplo)', '#0d9488')]);
  const fotosTestimonio = await Promise.all([foto('Foto de testimonio (ejemplo)', '#4a3aa7'), foto('Foto de testimonio (ejemplo)', '#b45309')]);

  const idsExternas = [];
  const idsEventos = [];
  const ahora = Date.now();
  const DIA = 86400000;
  const hoy = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()) + `T00:00:00${TZ_OFFSET}`);

  await tx(async (c) => {
    for (const est of estructuras) {
      const id = crypto.randomUUID();
      idsExternas.push(id);
      await c.query('INSERT INTO estructuras_externas (id, cpv_id, nombre, created_by, created_at, updated_at) VALUES ($1, $2, $3, $2, $4, $4)', [
        id,
        cpv.id,
        est.nombre,
        new Date(ahora - entero(20, 40) * DIA),
      ]);
      await insertarPersonas(c, 'estructura_externa_personas', 'estructura_id', id, est.personas);
      await c.query(
        'INSERT INTO estructura_externa_cargas (id, estructura_id, archivo, filas, nuevas, repetidas, errores, user_id, user_name, at) VALUES ($1, $2, $3, $4, $4, 0, 0, $5, $6, $7)',
        [crypto.randomUUID(), id, `${est.nombre.toLowerCase().replace(/\s+/g, '-')}.xlsx`, est.personas.length, cpv.id, cpv.name, new Date(ahora - entero(10, 20) * DIA)]
      );
    }

    // ---------- Asambleas y recorridos ----------
    // Días respecto a hoy: pasados (realizados, alguno cancelado o sin reporte) y próximos (publicados y borradores)
    const plan = [
      ...[-58, -52, -47, -43, -38, -34, -30, -26, -22, -19, -15, -12, -9, -6, -4, -2].map((d) => ({ d, estado: 'realizado' })),
      { d: -27, estado: 'cancelado' },
      { d: -1, estado: 'programado' }, // sin reporte: aparece «Por reportar»
      ...[1, 3, 5, 8, 12, 16, 21, 26].map((d) => ({ d, estado: 'programado' })),
      { d: 10, estado: 'cancelado' },
      { d: 18, estado: 'borrador' },
      { d: 24, estado: 'borrador' },
    ];
    let folioTipo = 0;
    for (const p of plan) {
      const tipo = folioTipo++ % 5 < 2 ? 'asamblea' : 'recorrido';
      const id = crypto.randomUUID();
      idsEventos.push(id);
      const inicio = new Date(hoy.getTime() + p.d * DIA + (tipo === 'asamblea' ? entero(16, 19) : entero(9, 11)) * 3600000);
      const fin = new Date(inicio.getTime() + (tipo === 'asamblea' ? 2 : 3) * 3600000);
      const alcanceRed = rnd() < 0.4;
      const zonasEv = alcanceRed ? [] : muestra(zonas, entero(1, 2)).map((z) => z.id);
      const zonasRef = alcanceRed ? zonas.map((z) => z.id) : zonasEv;
      // Quién reporta: responsable de una zona destinataria (la mitad), su coordinador o el propio CPV
      const zRep = uno(zonasRef);
      const x = rnd();
      const reporta = x < 0.5 && rsDe.get(zRep)?.length ? uno(rsDe.get(zRep)).id : x < 0.8 ? zRep : cpv.id;
      const lugar = uno(tipo === 'asamblea' ? ASAMBLEAS : RECORRIDOS);
      const [lat, lng] = punto();
      const r = tipo === 'recorrido' ? ruta() : null;
      const esperados = tipo === 'asamblea' ? entero(15, 60) * 10 : entero(8, 25);
      const publicado = p.estado !== 'borrador';
      const creado = new Date(Math.min(inicio.getTime() - entero(6, 15) * DIA, ahora - DIA));
      const publicadoAt = publicado ? new Date(creado.getTime() + entero(1, 3) * DIA) : null;
      let reporte = null;
      let reportadoAt = null;
      let tardio = false;
      if (p.estado === 'realizado') {
        tardio = rnd() < 0.15;
        reportadoAt = new Date(inicio.getTime() + (tardio ? entero(26, 50) : entero(3, 6)) * 3600000);
        if (tipo === 'asamblea') reporte = { asistentes: Math.round(esperados * (0.7 + rnd() * 0.5)), duracionMin: entero(6, 15) * 10 };
        else {
          const casas = entero(40, 140);
          const tiempoMin = entero(9, 24) * 10;
          reporte = { asistentes: entero(6, 25), casas, km: Math.round((r.km * (0.9 + rnd() * 0.4)) * 100) / 100, tiempoMin, casasHora: Math.round((casas / (tiempoMin / 60)) * 10) / 10 };
        }
        reporte.observaciones = uno(OBS_REPORTE);
      }
      await c.query(
        `INSERT INTO eventos (id, tipo, estado, cpv_id, lugar, lat, lng, ruta, asistentes, necesidades, notas, inicio, fin, alcance, zonas, reporta_id,
                              creado_por, programado_por, publicado_at, reporte, reportado_at, reporte_tardio, recordatorio_at, aviso_sin_reporte_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $4, $17, $18, $19, $20, $21, $22, $22, $23, $24)`,
        [
          id,
          tipo,
          p.estado,
          cpv.id,
          lugar,
          tipo === 'asamblea' ? lat : null,
          tipo === 'asamblea' ? lng : null,
          r ? JSON.stringify(r) : null,
          esperados,
          JSON.stringify(muestra(NECESIDADES, tipo === 'asamblea' ? entero(3, 6) : entero(0, 2))),
          uno(NOTAS),
          inicio,
          fin,
          alcanceRed ? 'red' : 'zonas',
          zonasEv,
          reporta,
          publicado ? cpv.id : null,
          publicadoAt,
          reporte ? JSON.stringify(reporte) : null,
          reportadoAt,
          tardio,
          // Eventos pasados: los recordatorios ya «se enviaron» (no se vuelven a disparar al cargar el ejemplo)
          p.d < 0 ? inicio : null,
          creado,
          reportadoAt || publicadoAt || creado,
        ]
      );
      if (publicado) await c.query('INSERT INTO evento_fotos (evento_id, clase, image, created_at) VALUES ($1, $2, $3, $4)', [id, 'lugar', fotosLugar[tipo === 'asamblea' ? 0 : 1], creado]);
      const autorRep = users.get(reporta);
      const zonasTxt = alcanceRed ? 'toda la red' : zonasEv.map((z) => users.get(z)?.zona?.codigo || users.get(z)?.name).join(', ');
      if (publicado)
        await c.query('INSERT INTO evento_historial (evento_id, user_id, user_name, accion, detalle, at) VALUES ($1, $2, $3, $4, $5, $6)', [
          id,
          cpv.id,
          cpv.name,
          'publicado',
          `Publicó para ${zonasTxt}.`,
          publicadoAt,
        ]);
      else await c.query('INSERT INTO evento_historial (evento_id, user_id, user_name, accion, detalle, at) VALUES ($1, $2, $3, $4, $5, $6)', [id, cpv.id, cpv.name, 'creado', 'Guardó el borrador.', creado]);
      if (p.estado === 'cancelado')
        await c.query('INSERT INTO evento_historial (evento_id, user_id, user_name, accion, detalle, at) VALUES ($1, $2, $3, $4, $5, $6)', [
          id,
          cpv.id,
          cpv.name,
          'cancelado',
          `Canceló: ${uno(MOTIVOS_CANCELACION)}`,
          new Date(inicio.getTime() - DIA),
        ]);
      if (p.estado === 'realizado') {
        if (tipo === 'asamblea')
          for (const b of fotosTestimonio) await c.query('INSERT INTO evento_fotos (evento_id, clase, image, created_at) VALUES ($1, $2, $3, $4)', [id, 'testimonio', b, reportadoAt]);
        // Lista de asistencia: mayoría de la estructura de las zonas destinatarias, más paralelas y ciudadanos sin promover
        const total = tipo === 'asamblea' ? entero(40, 150) : entero(15, 50);
        const nuestros = zonasRef.flatMap((z) => porZona.get(z) || []);
        const lista = [
          ...muestra(nuestros.length ? nuestros : promovidos, Math.round(total * 0.6)),
          ...muestra(nuestrosA, Math.round(total * 0.08)),
          ...muestra(externasPool, Math.round(total * 0.18)),
          ...muestra(huerfanos, Math.round(total * 0.14)),
        ];
        await insertarPersonas(c, 'evento_asistentes', 'evento_id', id, lista);
        const n = (await c.query('SELECT count(*)::int AS n FROM evento_asistentes WHERE evento_id = $1', [id])).rows[0].n;
        await c.query('UPDATE eventos SET asistencia = $2 WHERE id = $1', [
          id,
          JSON.stringify({ archivo: 'asistencia-ejemplo.xlsx', filas: n, asistentes: n, repetidas: 0, errores: 0, filasConError: [], at: reportadoAt.toISOString(), por: autorRep?.name || cpv.name }),
        ]);
        await c.query('INSERT INTO evento_historial (evento_id, user_id, user_name, accion, detalle, at) VALUES ($1, $2, $3, $4, $5, $6)', [
          id,
          reporta,
          autorRep?.name || cpv.name,
          'reportado',
          `${tardio ? 'Reportó el evento (reporte tardío)' : 'Reportó el evento'} con una lista de ${n} asistentes.`,
          reportadoAt,
        ]);
      }
    }
  });
  const resumen = { cpv: cpv.id, eventos: idsEventos, externas: idsExternas, at: new Date().toISOString() };
  await settings.set(CLAVE, resumen);
  console.log(`Datos de ejemplo de agenda: ${idsEventos.length} eventos y ${idsExternas.length} estructuras paralelas (${cpv.name}).`);
  return resumen;
}

// Para «Borrar datos de ejemplo» del super administrador
function ids() {
  const v = settings.get(CLAVE);
  return { eventos: v?.eventos || [], externas: v?.externas || [] };
}

module.exports = { sembrar, ids };
