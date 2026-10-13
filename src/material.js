// Material electoral (propaganda): inventario del CPV y órdenes de entrega en cascada.
// Reglas:
//  - El CPV da de alta los artículos (nombre y unidad) y registra entradas a su inventario.
//  - Cada nivel entrega a sus subordinados directos con órdenes de entrega (varios artículos):
//    CPV → Coordinador de Zona → Responsable de Sección. El Promotor Territorial no participa.
//  - Nadie entrega más de lo que tiene disponible; no hay devoluciones (se reparte hasta agotarlo).
//  - Lo entregado llega «Por recibir»; el subordinado confirma «Recibido» y solo entonces cuenta en su saldo.
//  - El Responsable de Sección, último nivel, comprueba cada orden recibida con mínimo 5 fotos.
const crypto = require('crypto');
const { query, tx } = require('./db');
const { users } = require('./store');
const { chainOf } = require('./access');
const { notificar } = require('./notificaciones');
const fotosLib = require('./fotos');

const MIN_FOTOS = 5;
const MAX_FOTOS_LOTE = 15;
const NIVELES = ['coord_promocion', 'coord_zona', 'resp_seccion'];
// A quién le entrega cada nivel
const SIGUIENTE = { coord_promocion: 'coord_zona', coord_zona: 'resp_seccion' };

class MaterialError extends Error {
  constructor(message, status = 422, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const participa = (u) => Boolean(u) && NIVELES.includes(u.role);
const folio = (n) => `OE-${String(n).padStart(5, '0')}`;

// CPV al que pertenece la cuenta (ella misma si es CPV)
function cpvDe(u) {
  const c = chainOf(u, users.all()).find((x) => x.role === 'coord_promocion');
  return c || null;
}

// La cuenta puede ver la orden: quien entrega, quien recibe y la rama hacia arriba de quien entrega
function puedeVerOrden(viewer, row) {
  if (!viewer) return false;
  if (viewer.id === row.de_id || viewer.id === row.para_id) return true;
  const de = users.get(row.de_id);
  return Boolean(de) && chainOf(de, users.all()).some((u) => u.id === viewer.id);
}

const nombreDe = (id) => users.get(id)?.name || 'Cuenta eliminada';
const rolDe = (id) => users.get(id)?.role || null;

// Saldo por artículo de una cuenta
async function saldos(user, client = { query }) {
  const cpv = cpvDe(user);
  if (!cpv) return [];
  const { rows } = await client.query(
    `SELECT a.id, a.nombre, a.unidad,
       COALESCE((SELECT sum(e.cantidad) FROM material_entradas e WHERE e.articulo_id = a.id AND e.cpv_id = $2), 0)::int AS entradas,
       COALESCE((SELECT sum(i.cantidad) FROM material_orden_items i JOIN material_ordenes o ON o.id = i.orden_id
                 WHERE i.articulo_id = a.id AND o.para_id = $2 AND o.estado <> 'pendiente'), 0)::int AS recibido,
       COALESCE((SELECT sum(i.cantidad) FROM material_orden_items i JOIN material_ordenes o ON o.id = i.orden_id
                 WHERE i.articulo_id = a.id AND o.para_id = $2 AND o.estado = 'pendiente'), 0)::int AS por_recibir,
       COALESCE((SELECT sum(i.cantidad) FROM material_orden_items i JOIN material_ordenes o ON o.id = i.orden_id
                 WHERE i.articulo_id = a.id AND o.de_id = $2), 0)::int AS repartido
     FROM material_articulos a WHERE a.cpv_id = $1 ORDER BY lower(a.nombre)`,
    [cpv.id, user.id]
  );
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    unidad: r.unidad,
    entradas: r.entradas,
    recibido: r.recibido,
    porRecibir: r.por_recibir,
    repartido: r.repartido,
    disponible: r.entradas + r.recibido - r.repartido,
  }));
}

// Órdenes con sus artículos y número de fotos
async function ordenes(where, params) {
  const { rows } = await query(
    `SELECT o.*, (SELECT count(*)::int FROM material_evidencias ev WHERE ev.orden_id = o.id) AS fotos,
            COALESCE((SELECT json_agg(json_build_object('articuloId', a.id, 'nombre', a.nombre, 'unidad', a.unidad, 'cantidad', i.cantidad) ORDER BY lower(a.nombre))
                      FROM material_orden_items i JOIN material_articulos a ON a.id = i.articulo_id WHERE i.orden_id = o.id), '[]') AS items
     FROM material_ordenes o WHERE ${where} ORDER BY o.created_at DESC`,
    params
  );
  return rows.map(formato);
}

function formato(r) {
  return {
    id: r.id,
    folio: folio(r.numero),
    de: { id: r.de_id, name: nombreDe(r.de_id), role: rolDe(r.de_id) },
    para: { id: r.para_id, name: nombreDe(r.para_id), role: rolDe(r.para_id) },
    estado: r.estado,
    // El Responsable de Sección es el último nivel: su orden se cierra con evidencia
    requiereEvidencia: rolDe(r.para_id) === 'resp_seccion',
    nota: r.nota,
    items: r.items,
    total: r.items.reduce((t, i) => t + i.cantidad, 0),
    fotos: r.fotos,
    createdAt: r.created_at.toISOString(),
    recibidaAt: r.recibida_at ? r.recibida_at.toISOString() : null,
    comprobadaAt: r.comprobada_at ? r.comprobada_at.toISOString() : null,
  };
}

// Avance de la rama: por subordinado directo, lo entregado y cómo va su recepción/comprobación
async function avanceRama(user) {
  const hijos = users.all().filter((u) => u.parentId === user.id && u.role === SIGUIENTE[user.role]);
  if (!hijos.length) return [];
  const ids = hijos.map((h) => h.id);
  // Órdenes que recibió cada subordinado
  const recib = await query(
    `SELECT o.para_id AS id, o.estado, count(*)::int AS n, COALESCE(sum((SELECT sum(cantidad) FROM material_orden_items i WHERE i.orden_id = o.id)), 0)::int AS piezas
     FROM material_ordenes o WHERE o.para_id = ANY($1::uuid[]) GROUP BY o.para_id, o.estado`,
    [ids]
  );
  // Para el CPV: las órdenes que cada zona entregó a sus responsables
  const abajo =
    user.role === 'coord_promocion'
      ? await query(
          `SELECT o.de_id AS id, o.estado, count(*)::int AS n FROM material_ordenes o WHERE o.de_id = ANY($1::uuid[]) GROUP BY o.de_id, o.estado`,
          [ids]
        )
      : { rows: [] };
  const vacio = () => ({ pendiente: 0, recibida: 0, comprobada: 0 });
  return hijos
    .map((h) => {
      const r = { ordenes: vacio(), piezas: 0, piezasRecibidas: 0, abajo: vacio() };
      for (const x of recib.rows.filter((x) => x.id === h.id)) {
        r.ordenes[x.estado] = x.n;
        r.piezas += x.piezas;
        if (x.estado !== 'pendiente') r.piezasRecibidas += x.piezas;
      }
      for (const x of abajo.rows.filter((x) => x.id === h.id)) r.abajo[x.estado] = x.n;
      return { id: h.id, name: h.name, role: h.role, zona: h.zona?.nombre || null, secciones: h.territorio?.secciones || [], ...r };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function resumen(user) {
  if (!participa(user)) throw new MaterialError('Tu nivel no maneja material electoral.', 403);
  const [inventario, recibidas, emitidas, rama] = await Promise.all([
    saldos(user),
    ordenes('o.para_id = $1', [user.id]),
    SIGUIENTE[user.role] ? ordenes('o.de_id = $1', [user.id]) : Promise.resolve([]),
    SIGUIENTE[user.role] ? avanceRama(user) : Promise.resolve([]),
  ]);
  return {
    rol: user.role,
    esCPV: user.role === 'coord_promocion',
    puedeEntregar: Boolean(SIGUIENTE[user.role]),
    requiereEvidencia: user.role === 'resp_seccion',
    minFotos: MIN_FOTOS,
    inventario,
    recibidas,
    emitidas,
    rama,
  };
}

// --- Inventario del CPV -----------------------------------------------------------
const limpio = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const entero = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isInteger(n) ? n : NaN;
};

async function crearArticulo(cpv, body) {
  if (cpv.role !== 'coord_promocion') throw new MaterialError('Solo el CPV da de alta artículos.', 403);
  const nombre = limpio(body.nombre, 80);
  const unidad = limpio(body.unidad, 30);
  const cantidad = body.cantidad === '' || body.cantidad === undefined ? 0 : entero(body.cantidad);
  const errors = {};
  if (nombre.length < 2) errors.nombre = 'Escribe el nombre del artículo.';
  if (unidad.length < 2) errors.unidad = 'Escribe la unidad (piezas, cajas, paquetes…).';
  if (!(cantidad >= 0 && cantidad <= 10000000)) errors.cantidad = 'Escribe una cantidad entera.';
  if (Object.keys(errors).length) throw new MaterialError('Revisa los datos marcados', 422, errors);
  const id = crypto.randomUUID();
  try {
    await tx(async (c) => {
      await c.query('INSERT INTO material_articulos (id, cpv_id, nombre, unidad) VALUES ($1, $2, $3, $4)', [id, cpv.id, nombre, unidad]);
      if (cantidad > 0) await c.query('INSERT INTO material_entradas (cpv_id, articulo_id, cantidad, user_id) VALUES ($1, $2, $3, $1)', [cpv.id, id, cantidad]);
    });
  } catch (err) {
    if (err.code === '23505') throw new MaterialError('Ya existe un artículo con ese nombre.', 409, { nombre: 'Ya existe un artículo con ese nombre.' });
    throw err;
  }
  return { id };
}

async function registrarEntrada(cpv, body) {
  if (cpv.role !== 'coord_promocion') throw new MaterialError('Solo el CPV registra entradas.', 403);
  const cantidad = entero(body.cantidad);
  const errors = {};
  if (!(cantidad > 0 && cantidad <= 10000000)) errors.cantidad = 'Escribe una cantidad mayor a cero.';
  const art = await query('SELECT id FROM material_articulos WHERE id = $1 AND cpv_id = $2', [String(body.articuloId || ''), cpv.id]).catch(() => ({ rows: [] }));
  if (!art.rows.length) errors.articuloId = 'Elige el artículo.';
  if (Object.keys(errors).length) throw new MaterialError('Revisa los datos marcados', 422, errors);
  await query('INSERT INTO material_entradas (cpv_id, articulo_id, cantidad, user_id) VALUES ($1, $2, $3, $1)', [cpv.id, art.rows[0].id, cantidad]);
  return { ok: true };
}

// --- Órdenes de entrega ---------------------------------------------------------
async function crearOrden(user, body) {
  const rolPara = SIGUIENTE[user.role];
  if (!rolPara) throw new MaterialError('Tu nivel no entrega material.', 403);
  const para = users.get(String(body.paraId || ''));
  const errors = {};
  if (!para || para.parentId !== user.id || para.role !== rolPara) errors.paraId = 'Elige a quién se entrega.';
  const pedidos = new Map();
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const n = entero(it?.cantidad);
    if (!it?.articuloId || !n) continue;
    if (n < 0) errors.items = 'Las cantidades deben ser positivas.';
    else pedidos.set(String(it.articuloId), (pedidos.get(String(it.articuloId)) || 0) + n);
  }
  if (!pedidos.size && !errors.items) errors.items = 'Escribe la cantidad de al menos un artículo.';
  if (Object.keys(errors).length) throw new MaterialError('Revisa los datos marcados', 422, errors);

  const id = crypto.randomUUID();
  const cpv = cpvDe(user);
  let numero;
  await tx(async (c) => {
    // Una orden a la vez por cuenta: el saldo no puede quedar negativo
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
    const saldo = new Map((await saldos(user, c)).map((s) => [s.id, s]));
    const faltan = {};
    for (const [artId, n] of pedidos) {
      const s = saldo.get(artId);
      if (!s) faltan[artId] = 'Artículo no válido.';
      else if (n > s.disponible) faltan[artId] = `Solo tienes ${s.disponible.toLocaleString('es-MX')} ${s.unidad} disponibles.`;
    }
    if (Object.keys(faltan).length) throw new MaterialError('No tienes suficiente material disponible.', 422, { porArticulo: faltan });
    const r = await c.query(
      'INSERT INTO material_ordenes (id, cpv_id, de_id, para_id, nota) VALUES ($1, $2, $3, $4, $5) RETURNING numero',
      [id, cpv.id, user.id, para.id, limpio(body.nota, 300)]
    );
    numero = r.rows[0].numero;
    for (const [artId, n] of pedidos) await c.query('INSERT INTO material_orden_items (orden_id, articulo_id, cantidad) VALUES ($1, $2, $3)', [id, artId, n]);
  });
  await notificar([para.id], {
    tipo: 'material.orden',
    titulo: `${user.name} te envió material electoral (${folio(numero)})`,
    cuerpo: 'Confirma que lo recibiste.',
    url: `/material/ordenes/${id}`,
    autorId: user.id,
  });
  return { id, folio: folio(numero) };
}

async function filaOrden(id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const { rows } = await query('SELECT * FROM material_ordenes WHERE id = $1', [id]);
  return rows[0] || null;
}

async function detalle(viewer, id) {
  const row = await filaOrden(id);
  if (!row || !puedeVerOrden(viewer, row)) return null;
  const [o] = await ordenes('o.id = $1', [id]);
  const ev = await query('SELECT id, at FROM material_evidencias WHERE orden_id = $1 ORDER BY id', [id]);
  return {
    ...o,
    evidencias: ev.rows.map((e) => ({ id: String(e.id), at: e.at.toISOString() })),
    puedeRecibir: viewer.id === row.para_id && row.estado === 'pendiente',
    puedeCancelar: viewer.id === row.de_id && row.estado === 'pendiente',
    puedeSubirEvidencia: viewer.id === row.para_id && o.requiereEvidencia && row.estado !== 'pendiente',
    minFotos: MIN_FOTOS,
  };
}

async function recibir(viewer, id) {
  const row = await filaOrden(id);
  if (!row || viewer.id !== row.para_id) throw new MaterialError('Orden no encontrada', 404);
  if (row.estado !== 'pendiente') throw new MaterialError('Esta orden ya fue recibida.', 409);
  await query("UPDATE material_ordenes SET estado = 'recibida', recibida_at = now() WHERE id = $1 AND estado = 'pendiente'", [id]);
  await notificar([row.de_id], {
    tipo: 'material.recibida',
    titulo: `${viewer.name} recibió el material (${folio(row.numero)})`,
    cuerpo: rolDe(row.para_id) === 'resp_seccion' ? `Falta que suba las fotos de evidencia (mínimo ${MIN_FOTOS}).` : '',
    url: `/material/ordenes/${id}`,
    autorId: viewer.id,
  });
  return { ok: true };
}

async function cancelar(viewer, id) {
  const row = await filaOrden(id);
  if (!row || viewer.id !== row.de_id) throw new MaterialError('Orden no encontrada', 404);
  if (row.estado !== 'pendiente') throw new MaterialError('Solo se puede cancelar una orden que aún no se recibe.', 409);
  await query("DELETE FROM material_ordenes WHERE id = $1 AND estado = 'pendiente'", [id]);
  return { ok: true };
}

function fotoValida(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  if (buf.length > 3 * 1024 * 1024) return null;
  return buf;
}

async function subirEvidencia(viewer, id, fotos) {
  const row = await filaOrden(id);
  if (!row || viewer.id !== row.para_id) throw new MaterialError('Orden no encontrada', 404);
  if (rolDe(row.para_id) !== 'resp_seccion') throw new MaterialError('Esta orden no requiere evidencia.', 409);
  if (row.estado === 'pendiente') throw new MaterialError('Primero confirma que recibiste el material.', 409);
  const lista = Array.isArray(fotos) ? fotos : [];
  if (lista.length > MAX_FOTOS_LOTE) throw new MaterialError(`Sube como máximo ${MAX_FOTOS_LOTE} fotos a la vez.`, 422, { fotos: `Máximo ${MAX_FOTOS_LOTE} fotos a la vez.` });
  const bufs = lista.map(fotoValida);
  if (!bufs.length || bufs.some((b) => !b)) throw new MaterialError('Alguna foto no es válida.', 422, { fotos: 'Alguna foto no es válida; vuelve a elegirla.' });
  const ya = (await query('SELECT count(*)::int n FROM material_evidencias WHERE orden_id = $1', [id])).rows[0].n;
  if (ya + bufs.length < MIN_FOTOS) {
    const msg = `Sube mínimo ${MIN_FOTOS} fotos del material entregado o en uso (llevas ${ya + bufs.length}).`;
    throw new MaterialError(msg, 422, { fotos: msg });
  }
  let comprobada = false;
  const comprimidas = await Promise.all(bufs.map((b) => fotosLib.comprimir(b, fotosLib.EVIDENCIA)));
  await tx(async (c) => {
    for (const b of comprimidas) await c.query('INSERT INTO material_evidencias (orden_id, user_id, image) VALUES ($1, $2, $3)', [id, viewer.id, b]);
    const r = await c.query("UPDATE material_ordenes SET estado = 'comprobada', comprobada_at = now() WHERE id = $1 AND estado = 'recibida' RETURNING id", [id]);
    comprobada = r.rows.length > 0;
  });
  if (comprobada) {
    await notificar([row.de_id], {
      tipo: 'material.comprobada',
      titulo: `${viewer.name} subió la evidencia de ${folio(row.numero)}`,
      cuerpo: `${ya + bufs.length} fotos del material entregado o en uso.`,
      url: `/material/ordenes/${id}`,
      autorId: viewer.id,
    });
  }
  return { ok: true, fotos: ya + bufs.length };
}

async function evidencia(viewer, fotoId) {
  if (!/^\d+$/.test(String(fotoId))) return null;
  const { rows } = await query(
    'SELECT ev.image, o.de_id, o.para_id FROM material_evidencias ev JOIN material_ordenes o ON o.id = ev.orden_id WHERE ev.id = $1',
    [fotoId]
  );
  if (!rows[0] || !puedeVerOrden(viewer, rows[0])) return null;
  return rows[0].image;
}

module.exports = {
  MaterialError,
  participa,
  resumen,
  crearArticulo,
  registrarEntrada,
  crearOrden,
  detalle,
  recibir,
  cancelar,
  subirEvidencia,
  evidencia,
};
