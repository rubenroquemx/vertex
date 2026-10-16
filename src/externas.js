// Estructuras externas (otras estructuras que corren en paralelo).
// El CPV carga un Excel por estructura y el sistema le dice, solo con conteos, cuántas de esas personas ya
// están en su árbol de promovidos y cuántas se repiten entre las estructuras externas que ha cargado.
// Cada CPV ve solo las suyas; el super administrador ve las de todos. No son promovidos ni tocan métricas.
// La persona se identifica por su clave de elector o por su CURP (basta con que coincida una de las dos).
const crypto = require('crypto');
const listas = require('./listas');
const cotejo = require('./cotejo');
const { query, tx } = require('./db');
const { users } = require('./store');

const VIGENCIA_REVISION = 30 * 60 * 1000;

class ExternaError extends Error {
  constructor(message, status = 422, fields = null) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

// Lectura del Excel con el formato compartido (src/listas.js)
async function leer(buffer) {
  try {
    return await listas.leer(buffer);
  } catch (err) {
    if (err instanceof listas.ListaError) throw new ExternaError(err.message);
    throw err;
  }
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

  const { leidas, validas, unicas, repetidas: repetidasArchivo, errores } = await leer(buffer);
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
    validas,
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
        `INSERT INTO estructura_externa_personas (estructura_id, clave_elector, curp, paterno, materno, nombres, telefono, seccion)
         SELECT $1, f.c, f.u, f.p, f.m, f.n, f.t, f.s FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[]) AS f(c, u, p, m, n, t, s)
         ON CONFLICT DO NOTHING`,
        [estructuraId, lote.map((x) => x.c), lote.map((x) => x.u), lote.map((x) => x.paterno), lote.map((x) => x.materno), lote.map((x) => x.nombres), lote.map((x) => x.tel), lote.map((x) => x.seccion)]
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
async function cruce(cpvId) {
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
  if (viewer.role === 'coord_promocion')
    return { rol: 'cpv', cpvs: [{ id: viewer.id, nombre: viewer.name, huerfanos: await contarHuerfanos(viewer.id), ...(await cruce(viewer.id)) }] };
  if (viewer.role === 'superadmin') {
    // CPV con estructuras externas o con asistentes en sus eventos
    const { rows } = await query(
      `SELECT cpv_id FROM estructuras_externas UNION SELECT ev.cpv_id FROM evento_asistentes a JOIN eventos ev ON ev.id = a.evento_id`
    );
    const conDatos = new Set(rows.map((r) => r.cpv_id));
    const cpvs = users.all().filter((u) => u.role === 'coord_promocion' && conDatos.has(u.id));
    return { rol: 'sa', cpvs: await Promise.all(cpvs.map(async (c) => ({ id: c.id, nombre: c.name, huerfanos: await contarHuerfanos(c.id), ...(await cruce(c.id)) }))) };
  }
  throw new ExternaError('No disponible para tu nivel.', 403);
}

async function cargasDe(viewer, id) {
  const e = await estructuraDe(viewer, id);
  if (!e) throw new ExternaError('Estructura no encontrada', 404);
  const { rows } = await query('SELECT archivo, filas, nuevas, repetidas, errores, user_name, at FROM estructura_externa_cargas WHERE estructura_id = $1 ORDER BY at DESC', [id]);
  return rows.map((r) => ({ archivo: r.archivo, filas: r.filas, nuevas: r.nuevas, repetidas: r.repetidas, errores: r.errores, por: r.user_name, at: r.at.toISOString() }));
}

// Plantilla (mismo formato que la lista de asistencia de los eventos)
const plantilla = () => listas.plantilla('Estructura', ['Cada persona se guarda una sola vez por estructura.', 'Estas personas no se convierten en promovidos ni cambian tus metas.']);

// ---------------------------------------------------------------------------
// Listas consultables (CPV y super administrador) con el indicador de asistencias
// ---------------------------------------------------------------------------
const POR_PAGINA = 50;
const persona = (r) => ({
  nombre: [r.nombres, r.paterno, r.materno].filter(Boolean).join(' ') || 'Sin nombre',
  claveElector: r.clave_elector,
  curp: r.curp,
  telefono: r.telefono,
  seccion: r.seccion,
  asambleas: r.asambleas || 0,
  recorridos: r.recorridos || 0,
});
const busqueda = (q, alias = 'p') =>
  `($2 = '' OR (${alias}.nombres || ' ' || ${alias}.paterno || ' ' || ${alias}.materno) ILIKE '%' || $2 || '%'
     OR ${alias}.clave_elector LIKE upper($2) || '%' OR ${alias}.curp LIKE upper($2) || '%' OR ${alias}.seccion::text = $2)`;
const pagina = (n) => Math.max(0, (Number.parseInt(n, 10) || 1) - 1);

async function personasDe(viewer, id, { q = '', p = 1 } = {}) {
  const e = await estructuraDe(viewer, id);
  if (!e) throw new ExternaError('Estructura no encontrada', 404);
  const texto = String(q || '').trim().slice(0, 60);
  const { rows } = await query(
    `SELECT p.*, a.asambleas, a.recorridos, ${cotejo.enArbol('p', '$3')} AS en_nuestra, count(*) OVER () AS total
     FROM estructura_externa_personas p
     LEFT JOIN LATERAL ${cotejo.asistencias('p', '$3')} a ON true
     WHERE p.estructura_id = $1 AND ${busqueda(texto)}
     ORDER BY p.paterno, p.materno, p.nombres, p.id
     LIMIT ${POR_PAGINA} OFFSET $4`,
    [id, texto, e.cpv_id, pagina(p) * POR_PAGINA]
  );
  return {
    estructura: { id: e.id, nombre: e.nombre },
    total: rows[0] ? Number(rows[0].total) : 0,
    porPagina: POR_PAGINA,
    personas: rows.map((r) => ({ ...persona(r), enNuestra: r.en_nuestra })),
  };
}

// Ciudadanos sin promover («huérfanos»): asistieron a eventos del CPV y no están en su árbol ni en sus
// estructuras externas. Se agrupan por clave de elector (o CURP si no tiene).
const HUERFANOS = (cpv) => `
  WITH h AS (
    SELECT a.*, ev.tipo FROM evento_asistentes a JOIN eventos ev ON ev.id = a.evento_id
    WHERE ev.cpv_id = ${cpv} AND NOT ${cotejo.enArbol('a', cpv)} AND NOT ${cotejo.enExternas('a', cpv)}),
  g AS (
    SELECT COALESCE(h.clave_elector, h.curp) AS persona, max(h.clave_elector) AS clave_elector, max(h.curp) AS curp,
           max(h.paterno) AS paterno, max(h.materno) AS materno, max(h.nombres) AS nombres, max(h.telefono) AS telefono, max(h.seccion) AS seccion,
           count(DISTINCT h.evento_id) FILTER (WHERE h.tipo = 'asamblea')::int AS asambleas,
           count(DISTINCT h.evento_id) FILTER (WHERE h.tipo = 'recorrido')::int AS recorridos
    FROM h GROUP BY 1)`;

function cpvDeConsulta(viewer, cpvId) {
  if (viewer.role === 'coord_promocion') return viewer.id;
  if (viewer.role === 'superadmin' && users.get(cpvId)?.role === 'coord_promocion') return cpvId;
  throw new ExternaError('Elige un CPV.', 422);
}

async function huerfanos(viewer, { cpv, q = '', p = 1 } = {}) {
  const cpvId = cpvDeConsulta(viewer, cpv);
  const texto = String(q || '').trim().slice(0, 60);
  const { rows } = await query(
    `${HUERFANOS('$1')}
     SELECT g.*, count(*) OVER () AS total FROM g
     WHERE ${busqueda(texto, 'g')}
     ORDER BY g.paterno, g.materno, g.nombres, g.persona
     LIMIT ${POR_PAGINA} OFFSET $3`,
    [cpvId, texto, pagina(p) * POR_PAGINA]
  );
  return { cpv: { id: cpvId, nombre: users.get(cpvId)?.name || '' }, total: rows[0] ? Number(rows[0].total) : 0, porPagina: POR_PAGINA, personas: rows.map(persona) };
}

async function contarHuerfanos(cpvId) {
  const { rows } = await query(`${HUERFANOS('$1')} SELECT count(*)::int AS n FROM g`, [cpvId]);
  return rows[0].n;
}

// Asistencias de un promovido a los eventos de su CPV (para su ficha; solo la ve el CPV)
async function asistenciasDe(cpvId, claveElector, curp) {
  const { rows } = await query(
    `SELECT r.* FROM (SELECT $2::text AS clave_elector, $3::text AS curp) x, LATERAL ${cotejo.asistencias('x', '$1')} r`,
    [cpvId, claveElector, curp]
  );
  return { asambleas: rows[0]?.asambleas || 0, recorridos: rows[0]?.recorridos || 0 };
}

module.exports = { ExternaError, revisar, confirmar, eliminar, resumen, cargasDe, plantilla, personasDe, huerfanos, asistenciasDe };
