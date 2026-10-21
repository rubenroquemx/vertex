// Material electoral (propaganda): inventario del CPV y órdenes de entrega en cascada.
// Reglas:
//  - El CPV da de alta los artículos (nombre y unidad) y registra entradas a su inventario.
//  - Cada nivel entrega a sus subordinados directos con órdenes de entrega (varios artículos):
//    CPV → Coordinador de Zona → Responsable de Sección. El Promotor Territorial no participa.
//  - Nadie entrega más de lo que tiene disponible; no hay devoluciones (se reparte hasta agotarlo).
//  - Lo entregado llega «Por recibir»; el subordinado confirma «Recibido» y solo entonces cuenta en su saldo.
//  - El Responsable de Sección, último nivel, reparte su material a la gente en activaciones: en cada una
//    reporta qué y cuánto repartió, la fecha, la hora y el lugar (ligada a un evento ya ocurrido de la
//    agenda o fuera de agenda) con mínimo 5 fotos. Lo repartido sale de su existencia.
const crypto = require('crypto');
const { query, tx } = require('./db');
const { users } = require('./store');
const { chainOf } = require('./access');
const { notificar } = require('./notificaciones');
const fotosLib = require('./fotos');

const MIN_FOTOS = 5;
const MAX_FOTOS_LOTE = 15;
const folioAct = (n) => `AC-${String(n).padStart(5, '0')}`;
// "YYYY-MM-DDTHH:MM" en hora del centro (sin horario de verano desde 2022)
function fechaHora(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(`${s}:00-06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
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
  const c = chainOf(u).find((x) => x.role === 'coord_promocion');
  return c || null;
}

// La cuenta puede ver la orden: quien entrega, quien recibe y la rama hacia arriba de quien entrega
function puedeVerOrden(viewer, row) {
  if (!viewer) return false;
  if (viewer.id === row.de_id || viewer.id === row.para_id) return true;
  const de = users.get(row.de_id);
  return Boolean(de) && chainOf(de).some((u) => u.id === viewer.id);
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
                 WHERE i.articulo_id = a.id AND o.de_id = $2), 0)::int AS repartido,
       COALESCE((SELECT sum(i.cantidad) FROM material_activacion_items i JOIN material_activaciones ac ON ac.id = i.activacion_id
                 WHERE i.articulo_id = a.id AND ac.user_id = $2), 0)::int AS activado
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
    // Repartido a la gente en activaciones (Responsable de Sección)
    entregado: r.activado,
    disponible: r.entradas + r.recibido - r.repartido - r.activado,
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
    // Recibir la orden la cierra; la evidencia está en las activaciones (fotos de lo repartido)
    requiereEvidencia: false,
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
  const hijos = users.hijos(user.id, SIGUIENTE[user.role]);
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
  // Para el Coordinador de Zona: lo que cada responsable repartió a la gente en activaciones
  const acts =
    user.role === 'coord_zona'
      ? await query(
          `SELECT ac.user_id AS id, count(DISTINCT ac.id)::int AS n, COALESCE(sum(i.cantidad), 0)::int AS piezas
           FROM material_activaciones ac LEFT JOIN material_activacion_items i ON i.activacion_id = ac.id
           WHERE ac.user_id = ANY($1::uuid[]) GROUP BY ac.user_id`,
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
      const a = acts.rows.find((x) => x.id === h.id);
      r.activaciones = a ? a.n : 0;
      r.repartidoGente = a ? a.piezas : 0;
      return { id: h.id, name: h.name, role: h.role, zona: h.zona?.nombre || null, secciones: h.territorio?.secciones || [], ...r };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function resumen(user) {
  if (!participa(user)) throw new MaterialError('Tu nivel no maneja material electoral.', 403);
  const [inventario, recibidas, emitidas, rama, acts] = await Promise.all([
    saldos(user),
    ordenes('o.para_id = $1', [user.id]),
    SIGUIENTE[user.role] ? ordenes('o.de_id = $1', [user.id]) : Promise.resolve([]),
    SIGUIENTE[user.role] ? avanceRama(user) : Promise.resolve([]),
    user.role === 'resp_seccion' ? activaciones('ac.user_id = $1', [user.id]) : Promise.resolve([]),
  ]);
  return {
    rol: user.role,
    esCPV: user.role === 'coord_promocion',
    puedeEntregar: Boolean(SIGUIENTE[user.role]),
    activa: user.role === 'resp_seccion',
    minFotos: MIN_FOTOS,
    inventario,
    recibidas,
    emitidas,
    rama,
    activaciones: acts,
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
    cuerpo: '',
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

// --- Activaciones: lo que el Responsable de Sección reparte a la gente -------------------
async function activaciones(where, params) {
  const { rows } = await query(
    `SELECT ac.*, e.tipo AS evento_tipo, e.lugar AS evento_lugar, e.inicio AS evento_inicio,
            (SELECT count(*)::int FROM material_activacion_fotos f WHERE f.activacion_id = ac.id) AS fotos,
            COALESCE((SELECT json_agg(json_build_object('articuloId', a.id, 'nombre', a.nombre, 'unidad', a.unidad, 'cantidad', i.cantidad) ORDER BY lower(a.nombre))
                      FROM material_activacion_items i JOIN material_articulos a ON a.id = i.articulo_id WHERE i.activacion_id = ac.id), '[]') AS items
     FROM material_activaciones ac LEFT JOIN eventos e ON e.id = ac.evento_id
     WHERE ${where} ORDER BY ac.fecha DESC, ac.numero DESC LIMIT 300`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    folio: folioAct(r.numero),
    por: { id: r.user_id, name: nombreDe(r.user_id) },
    lugar: r.lugar,
    fecha: r.fecha.toISOString(),
    nota: r.nota,
    evento:
      r.evento_id && r.evento_inicio
        ? { id: r.evento_id, tipo: r.evento_tipo, lugar: r.evento_lugar, inicio: r.evento_inicio.toISOString() }
        : null,
    items: r.items,
    total: r.items.reduce((t, i) => t + i.cantidad, 0),
    fotos: r.fotos,
    createdAt: r.created_at.toISOString(),
  }));
}

// Puede verla quien la reportó y su rama hacia arriba (Coordinador de Zona, CPV, super administrador)
function puedeVerActivacion(viewer, userId) {
  if (!viewer) return false;
  if (viewer.id === userId) return true;
  const u = users.get(userId);
  return Boolean(u) && chainOf(u).some((x) => x.id === viewer.id);
}

// Datos del formulario: existencia por artículo y eventos ya ocurridos que se pueden ligar
async function opcionesActivacion(viewer) {
  if (viewer.role !== 'resp_seccion') throw new MaterialError('Solo el Responsable de Sección reporta activaciones.', 403);
  const eventos = require('./eventos');
  const [inventario, pasados] = await Promise.all([saldos(viewer), eventos.pasadosDe(viewer)]);
  return { inventario: inventario.filter((a) => a.disponible > 0), eventos: pasados, minFotos: MIN_FOTOS, maxFotos: MAX_FOTOS_LOTE };
}

async function crearActivacion(viewer, body) {
  if (viewer.role !== 'resp_seccion') throw new MaterialError('Solo el Responsable de Sección reporta activaciones.', 403);
  const errors = {};
  const lugar = limpio(body.lugar, 160);
  if (lugar.length < 3) errors.lugar = 'Escribe el lugar donde se repartió.';
  const fecha = fechaHora(`${body.fecha || ''}T${body.hora || ''}`);
  if (!fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || ''))) errors.fecha = 'Elige la fecha.';
    else errors.hora = 'Escribe la hora.';
  } else if (fecha.getTime() > Date.now() + 5 * 60000) errors.fecha = 'La activación no puede ser en el futuro.';
  else if (fecha.getTime() < Date.now() - 366 * 86400000) errors.fecha = 'La fecha es de hace más de un año.';

  // Evento de la agenda ya ocurrido (o «fuera de agenda»)
  let eventoId = null;
  if (body.eventoId) {
    const pasados = await require('./eventos').pasadosDe(viewer, 366);
    const ev = pasados.find((e) => e.id === String(body.eventoId));
    if (!ev) errors.eventoId = 'Elige un evento que ya haya ocurrido.';
    else eventoId = ev.id;
  }

  const pedidos = new Map();
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const n = entero(it?.cantidad);
    if (!it?.articuloId || !n) continue;
    if (n < 0) errors.items = 'Las cantidades deben ser positivas.';
    else pedidos.set(String(it.articuloId), (pedidos.get(String(it.articuloId)) || 0) + n);
  }
  if (!pedidos.size && !errors.items) errors.items = 'Escribe cuánto repartiste de al menos un artículo.';

  const lista = Array.isArray(body.fotos) ? body.fotos : [];
  if (lista.length < MIN_FOTOS) errors.fotos = `Sube mínimo ${MIN_FOTOS} fotos de la activación (llevas ${lista.length}).`;
  else if (lista.length > MAX_FOTOS_LOTE) errors.fotos = `Sube como máximo ${MAX_FOTOS_LOTE} fotos.`;
  const bufs = lista.map(fotoValida);
  if (!errors.fotos && bufs.some((b) => !b)) errors.fotos = 'Alguna foto no es válida; vuelve a elegirla.';
  if (Object.keys(errors).length) throw new MaterialError('Revisa los datos marcados', 422, errors);

  const comprimidas = await Promise.all(bufs.map((b) => fotosLib.comprimir(b, fotosLib.EVIDENCIA)));
  const id = crypto.randomUUID();
  const cpv = cpvDe(viewer);
  let numero;
  await tx(async (c) => {
    // Una salida a la vez por cuenta: la existencia no puede quedar negativa
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [viewer.id]);
    const saldo = new Map((await saldos(viewer, c)).map((s) => [s.id, s]));
    const faltan = {};
    for (const [artId, n] of pedidos) {
      const s = saldo.get(artId);
      if (!s) faltan[artId] = 'Artículo no válido.';
      else if (n > s.disponible) faltan[artId] = `Solo tienes ${s.disponible.toLocaleString('es-MX')} ${s.unidad} en existencia.`;
    }
    if (Object.keys(faltan).length) throw new MaterialError('No tienes suficiente material en existencia.', 422, { porArticulo: faltan });
    const r = await c.query(
      'INSERT INTO material_activaciones (id, cpv_id, user_id, evento_id, lugar, fecha, nota) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING numero',
      [id, cpv.id, viewer.id, eventoId, lugar, fecha, limpio(body.nota, 300)]
    );
    numero = r.rows[0].numero;
    for (const [artId, n] of pedidos) await c.query('INSERT INTO material_activacion_items (activacion_id, articulo_id, cantidad) VALUES ($1, $2, $3)', [id, artId, n]);
    for (const b of comprimidas) await c.query('INSERT INTO material_activacion_fotos (activacion_id, image) VALUES ($1, $2)', [id, b]);
  });
  if (viewer.parentId) {
    await notificar([viewer.parentId], {
      tipo: 'material.activacion',
      titulo: `${viewer.name} reportó una activación (${folioAct(numero)})`,
      cuerpo: `${lugar} · ${comprimidas.length} fotos.`,
      url: `/material/activaciones/${id}`,
      autorId: viewer.id,
    });
  }
  return { id, folio: folioAct(numero) };
}

async function activacionDetalle(viewer, id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const [a] = await activaciones('ac.id = $1', [id]);
  if (!a || !puedeVerActivacion(viewer, a.por.id)) return null;
  const f = await query('SELECT id FROM material_activacion_fotos WHERE activacion_id = $1 ORDER BY id', [id]);
  return { ...a, fotosIds: f.rows.map((x) => String(x.id)) };
}

async function activacionFoto(viewer, fotoId) {
  if (!/^\d+$/.test(String(fotoId))) return null;
  const { rows } = await query(
    'SELECT f.image, ac.user_id FROM material_activacion_fotos f JOIN material_activaciones ac ON ac.id = f.activacion_id WHERE f.id = $1',
    [fotoId]
  );
  if (!rows[0] || !puedeVerActivacion(viewer, rows[0].user_id)) return null;
  return rows[0].image;
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
  evidencia,
  opcionesActivacion,
  crearActivacion,
  activacionDetalle,
  activacionFoto,
};
