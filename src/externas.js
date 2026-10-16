// Estructuras externas (otras estructuras que corren en paralelo).
// El CPV carga un Excel por estructura y el sistema le dice, solo con conteos, cuántas de esas personas ya
// están en su árbol de promovidos y cuántas se repiten entre las estructuras externas que ha cargado.
// Cada CPV ve solo las suyas; el super administrador ve las de todos. No son promovidos ni tocan métricas.
// La persona se identifica por su clave de elector o por su CURP (basta con que coincida una de las dos).
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { query, tx } = require('./db');
const { users } = require('./store');
const { CLAVE_ELECTOR_RE, CURP_RE } = require('./promovidos');

const MAX_FILAS = 200000;
const VIGENCIA_REVISION = 30 * 60 * 1000;
const COLUMNAS = ['CLAVE_ELECTOR', 'CURP', 'APELLIDO_PATERNO', 'APELLIDO_MATERNO', 'NOMBRES', 'TELEFONO'];

class ExternaError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

// Encabezados aceptados (sin acentos, espacios ni guiones)
const llave = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
const SINONIMOS = {
  clave: ['CLAVEELECTOR', 'CLAVEDEELECTOR', 'CLAVE', 'CVEELECTOR', 'CLAVEINE'],
  curp: ['CURP'],
  paterno: ['APELLIDOPATERNO', 'PATERNO', 'APPATERNO', 'APATERNO'],
  materno: ['APELLIDOMATERNO', 'MATERNO', 'APMATERNO', 'AMATERNO'],
  nombres: ['NOMBRES', 'NOMBRE', 'NOMBRESS'],
  telefono: ['TELEFONO', 'NOTELEFONICO', 'NUMEROTELEFONICO', 'TEL', 'CELULAR', 'NOTELEFONO', 'NUMTELEFONO'],
};
const texto = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return String(v.result ?? '');
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return String(v);
};
const limpio = (v) => texto(v).trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 120);
const sinEspacios = (v) => texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// Lectura del Excel (la primera hoja; los encabezados pueden estar en cualquier fila antes de los datos)
// ---------------------------------------------------------------------------
async function leer(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ExternaError('No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) con la plantilla.');
  }
  const hoja = wb.worksheets[0];
  if (!hoja) throw new ExternaError('El archivo no tiene hojas.');
  let col = null;
  const filas = [];
  const errores = [];
  let leidas = 0;
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values;
    if (!col) {
      // Primera fila con encabezados reconocibles
      const mapa = {};
      vals.forEach((v, i) => {
        const k = llave(texto(v));
        for (const [campo, sin] of Object.entries(SINONIMOS)) if (sin.includes(k) && !(campo in mapa)) mapa[campo] = i;
      });
      if ('clave' in mapa || 'curp' in mapa) col = mapa;
      return;
    }
    const val = (c) => (col[c] === undefined ? '' : vals[col[c]]);
    const clave = sinEspacios(val('clave'));
    const curp = sinEspacios(val('curp'));
    const paterno = limpio(val('paterno'));
    const materno = limpio(val('materno'));
    const nombres = limpio(val('nombres'));
    if (!clave && !curp && !paterno && !materno && !nombres) return; // fila vacía
    leidas += 1;
    if (leidas > MAX_FILAS) return;
    const c = CLAVE_ELECTOR_RE.test(clave) ? clave : null;
    const u = CURP_RE.test(curp) ? curp : null;
    if (!c && !u) {
      errores.push(row.number);
      return;
    }
    filas.push({ c, u, paterno, materno, nombres, tel: texto(val('telefono')).replace(/\D/g, '').slice(-10) });
  });
  if (!col) throw new ExternaError('No se encontraron los encabezados. Usa la plantilla: debe tener al menos la columna CLAVE_ELECTOR o CURP.');
  if (leidas > MAX_FILAS) throw new ExternaError(`El archivo tiene más de ${MAX_FILAS.toLocaleString('es-MX')} filas; divídelo en varias cargas.`);
  return { leidas, filas, errores };
}

// ---------------------------------------------------------------------------
// Revisión previa y carga (dos pasos: el CPV ve el resumen antes de confirmar)
// ---------------------------------------------------------------------------
const revisiones = new Map();
setInterval(() => {
  const ahora = Date.now();
  for (const [k, r] of revisiones) if (ahora - r.at > VIGENCIA_REVISION) revisiones.delete(k);
}, 5 * 60 * 1000).unref();

function soloCPV(viewer) {
  if (viewer.role !== 'coord_promocion') throw new ExternaError('Solo el CPV carga estructuras externas.', 403);
}

async function estructuraDe(viewer, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const { rows } = await query('SELECT * FROM estructuras_externas WHERE id = $1', [id]);
  const e = rows[0];
  if (!e) return null;
  if (viewer.role === 'superadmin' || e.cpv_id === viewer.id) return e;
  return null;
}

async function revisar(viewer, buffer, { archivo, estructuraId, nombre }) {
  soloCPV(viewer);
  const f = {};
  let destino = null;
  if (estructuraId) {
    destino = await estructuraDe(viewer, estructuraId);
    if (!destino) f.estructura = 'Elige una estructura.';
  } else {
    nombre = String(nombre || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (nombre.length < 2) f.nombre = 'Escribe el nombre de la estructura (por ejemplo «Partido X»).';
    else {
      const { rows } = await query('SELECT id FROM estructuras_externas WHERE cpv_id = $1 AND lower(nombre) = lower($2)', [viewer.id, nombre]);
      if (rows.length) f.nombre = 'Ya tienes una estructura con ese nombre; elígela en la lista para agregarle personas.';
    }
  }
  if (Object.keys(f).length) throw new ExternaError(Object.values(f)[0], 422, f);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ExternaError('Elige el archivo de Excel.', 422, { archivo: 'Elige el archivo de Excel.' });

  const { leidas, filas, errores } = await leer(buffer);
  // Repetidas dentro del mismo archivo (por clave o por CURP)
  const vistasC = new Set();
  const vistasU = new Set();
  const unicas = [];
  let repetidasArchivo = 0;
  for (const r of filas) {
    if ((r.c && vistasC.has(r.c)) || (r.u && vistasU.has(r.u))) {
      repetidasArchivo += 1;
      continue;
    }
    if (r.c) vistasC.add(r.c);
    if (r.u) vistasU.add(r.u);
    unicas.push(r);
  }
  // Ya existentes en la estructura elegida
  let existentes = 0;
  if (destino && unicas.length) {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM unnest($2::text[], $3::text[]) AS f(c, u)
       WHERE EXISTS (SELECT 1 FROM estructura_externa_personas p WHERE p.estructura_id = $1 AND ((f.c IS NOT NULL AND p.clave_elector = f.c) OR (f.u IS NOT NULL AND p.curp = f.u)))`,
      [destino.id, unicas.map((r) => r.c), unicas.map((r) => r.u)]
    );
    existentes = rows[0].n;
  }
  const token = crypto.randomUUID();
  revisiones.set(token, { at: Date.now(), userId: viewer.id, destinoId: destino?.id || null, nombre: destino ? destino.nombre : nombre, archivo, leidas, unicas, errores, repetidasArchivo });
  return {
    token,
    estructura: destino ? destino.nombre : nombre,
    nueva: !destino,
    archivo,
    filas: leidas,
    validas: filas.length,
    repetidasArchivo,
    existentes,
    nuevas: unicas.length - existentes,
    errores: errores.length,
    filasConError: errores.slice(0, 30),
  };
}

async function confirmar(viewer, token) {
  soloCPV(viewer);
  const r = revisiones.get(String(token || ''));
  if (!r || r.userId !== viewer.id) throw new ExternaError('La revisión venció; vuelve a subir el archivo.', 409);
  revisiones.delete(token);
  let estructuraId = r.destinoId;
  let nuevas = 0;
  await tx(async (c) => {
    if (!estructuraId) {
      estructuraId = crypto.randomUUID();
      try {
        await c.query('INSERT INTO estructuras_externas (id, cpv_id, nombre, created_by) VALUES ($1, $2, $3, $4)', [estructuraId, viewer.id, r.nombre, viewer.id]);
      } catch (err) {
        if (err.code === '23505') throw new ExternaError('Ya tienes una estructura con ese nombre.', 409);
        throw err;
      }
    }
    // Por lotes; las que ya estaban en la estructura (misma clave o misma CURP) las omiten los índices únicos
    for (let i = 0; i < r.unicas.length; i += 5000) {
      const lote = r.unicas.slice(i, i + 5000);
      const res = await c.query(
        `INSERT INTO estructura_externa_personas (estructura_id, clave_elector, curp, paterno, materno, nombres, telefono)
         SELECT $1, f.c, f.u, f.p, f.m, f.n, f.t FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS f(c, u, p, m, n, t)
         ON CONFLICT DO NOTHING`,
        [estructuraId, lote.map((x) => x.c), lote.map((x) => x.u), lote.map((x) => x.paterno), lote.map((x) => x.materno), lote.map((x) => x.nombres), lote.map((x) => x.tel)]
      );
      nuevas += res.rowCount;
    }
    await c.query('UPDATE estructuras_externas SET updated_at = now() WHERE id = $1', [estructuraId]);
    await c.query(
      'INSERT INTO estructura_externa_cargas (id, estructura_id, archivo, filas, nuevas, repetidas, errores, user_id, user_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [crypto.randomUUID(), estructuraId, r.archivo, r.leidas, nuevas, r.leidas - r.errores.length - nuevas, r.errores.length, viewer.id, viewer.name]
    );
  });
  return { estructuraId, nombre: r.nombre, nuevas };
}

async function eliminar(viewer, id) {
  const e = await estructuraDe(viewer, id);
  if (!e) throw new ExternaError('Estructura no encontrada', 404);
  if (viewer.role !== 'coord_promocion' && viewer.role !== 'superadmin') throw new ExternaError('No tienes permiso.', 403);
  const { rows } = await query('SELECT count(*)::int AS n FROM estructura_externa_personas WHERE estructura_id = $1', [id]);
  await query('DELETE FROM estructuras_externas WHERE id = $1', [id]);
  return { nombre: e.nombre, personas: rows[0].n, cpvId: e.cpv_id };
}

// ---------------------------------------------------------------------------
// Cotejo (se calcula al consultar, así refleja los promovidos de hoy)
// ---------------------------------------------------------------------------
async function cotejo(cpvId) {
  const { rows: estructuras } = await query(
    `SELECT e.id, e.nombre, e.created_at, e.updated_at,
            (SELECT count(*)::int FROM estructura_externa_personas p WHERE p.estructura_id = e.id) AS personas
     FROM estructuras_externas e WHERE e.cpv_id = $1 ORDER BY e.nombre`,
    [cpvId]
  );
  if (!estructuras.length) return { estructuras: [], pares: [], total: { personas: 0, distintas: 0, enNuestra: 0, enDosOMasExternas: 0 } };

  // Por cada persona externa: si está en el árbol del CPV y en qué otras estructuras externas aparece
  const { rows: m } = await query(
    // Las búsquedas van directo a las tablas para usar los índices de clave y CURP
    `SELECT x.estructura_id, COALESCE(x.clave_elector, x.curp) AS persona,
            EXISTS (SELECT 1 FROM promovidos pr
                    JOIN users rs ON rs.id = pr.responsable_id JOIN users z ON z.id = rs.parent_id
                    WHERE z.parent_id = $1 AND (pr.clave_elector = x.clave_elector OR pr.curp = x.curp)) AS en_nuestra,
            ARRAY(SELECT DISTINCT y.estructura_id FROM estructura_externa_personas y
                  JOIN estructuras_externas ey ON ey.id = y.estructura_id
                  WHERE ey.cpv_id = $1 AND y.estructura_id <> x.estructura_id
                    AND (y.clave_elector = x.clave_elector OR y.curp = x.curp)) AS otras
     FROM estructura_externa_personas x JOIN estructuras_externas e ON e.id = x.estructura_id
     WHERE e.cpv_id = $1`,
    [cpvId]
  );

  const porEst = new Map(estructuras.map((e) => [e.id, { enNuestra: 0, enOtras: 0, enTresOMas: 0, porOtra: new Map() }]));
  const pares = new Map(); // "a|b" → personas de a que también están en b
  const distintas = new Map(); // persona → { nuestra, externas:Set }
  for (const r of m) {
    const s = porEst.get(r.estructura_id);
    if (r.en_nuestra) s.enNuestra += 1;
    if (r.otras.length) s.enOtras += 1;
    if (Number(r.en_nuestra) + r.otras.length >= 2) s.enTresOMas += 1;
    for (const o of r.otras) s.porOtra.set(o, (s.porOtra.get(o) || 0) + 1);
    const d = distintas.get(r.persona) || { nuestra: false, externas: new Set() };
    d.nuestra ||= r.en_nuestra;
    d.externas.add(r.estructura_id);
    distintas.set(r.persona, d);
  }
  for (const [id, s] of porEst) for (const [o, n] of s.porOtra) pares.set(`${id}|${o}`, n);

  const nombre = new Map(estructuras.map((e) => [e.id, e.nombre]));
  const valores = [...distintas.values()];
  const cargas = await query(
    `SELECT DISTINCT ON (estructura_id) estructura_id, at, user_name, archivo FROM estructura_externa_cargas
     WHERE estructura_id = ANY($1::uuid[]) ORDER BY estructura_id, at DESC`,
    [estructuras.map((e) => e.id)]
  );
  const ultima = new Map(cargas.rows.map((c) => [c.estructura_id, { at: c.at.toISOString(), por: c.user_name, archivo: c.archivo }]));
  return {
    estructuras: estructuras.map((e) => {
      const s = porEst.get(e.id);
      return {
        id: e.id,
        nombre: e.nombre,
        personas: e.personas,
        enNuestra: s.enNuestra,
        enOtras: s.enOtras,
        enTresOMas: s.enTresOMas,
        porOtra: [...s.porOtra].map(([o, n]) => ({ nombre: nombre.get(o), n })).sort((a, b) => b.n - a.n),
        creada: e.created_at.toISOString(),
        ultimaCarga: ultima.get(e.id) || null,
      };
    }),
    pares: [...pares].map(([k, n]) => {
      const [a, b] = k.split('|');
      return { a, b, n };
    }),
    total: {
      personas: m.length,
      distintas: valores.length,
      enNuestra: valores.filter((d) => d.nuestra).length,
      enDosOMasExternas: valores.filter((d) => d.externas.size >= 2).length,
      enTresOMas: valores.filter((d) => Number(d.nuestra) + d.externas.size >= 3).length,
    },
  };
}

async function resumen(viewer) {
  if (viewer.role === 'coord_promocion') return { rol: 'cpv', cpvs: [{ id: viewer.id, nombre: viewer.name, ...(await cotejo(viewer.id)) }] };
  if (viewer.role === 'superadmin') {
    const { rows } = await query('SELECT DISTINCT cpv_id FROM estructuras_externas');
    const conDatos = new Set(rows.map((r) => r.cpv_id));
    const cpvs = users.all().filter((u) => u.role === 'coord_promocion' && conDatos.has(u.id));
    return { rol: 'sa', cpvs: await Promise.all(cpvs.map(async (c) => ({ id: c.id, nombre: c.name, ...(await cotejo(c.id)) }))) };
  }
  throw new ExternaError('No disponible para tu nivel.', 403);
}

async function cargasDe(viewer, id) {
  const e = await estructuraDe(viewer, id);
  if (!e) throw new ExternaError('Estructura no encontrada', 404);
  const { rows } = await query('SELECT archivo, filas, nuevas, repetidas, errores, user_name, at FROM estructura_externa_cargas WHERE estructura_id = $1 ORDER BY at DESC', [id]);
  return rows.map((r) => ({ archivo: r.archivo, filas: r.filas, nuevas: r.nuevas, repetidas: r.repetidas, errores: r.errores, por: r.user_name, at: r.at.toISOString() }));
}

// Plantilla vacía con los encabezados y una fila de ejemplo explicativa
async function plantilla() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Estructura');
  ws.columns = COLUMNAS.map((h) => ({ header: h, key: h, width: h === 'CURP' || h === 'CLAVE_ELECTOR' ? 24 : 20 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const ins = wb.addWorksheet('Instrucciones');
  [
    'Llena la hoja «Estructura» con una persona por fila, a partir de la fila 2.',
    'Cada persona debe tener al menos su CLAVE_ELECTOR (18 caracteres) o su CURP (18 caracteres).',
    'Las filas sin clave de elector ni CURP válidas no se pueden cotejar y se reportan como error.',
    'Si una persona aparece dos veces, se guarda una sola vez en la estructura.',
    'El cotejo solo da conteos: no convierte a estas personas en promovidos ni cambia tus metas.',
  ].forEach((t, i) => (ins.getCell(`A${i + 1}`).value = t));
  ins.getColumn(1).width = 110;
  return wb.xlsx.writeBuffer();
}

module.exports = { ExternaError, revisar, confirmar, eliminar, resumen, cargasDe, plantilla };
