// Pruebas de integración contra una base de prueba aislada (esquema temporal; ver apoyo/base.js):
// envíos sin internet, existencias de material, plazos de asistencia y permisos.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { src, prepararBase, cerrarBase, sembrarEstructura, fotoJpeg } = require('./apoyo/base');

let hayBase = false;
let s; // estructura sembrada
let foto;
test.before(async () => {
  hayBase = await prepararBase();
  if (!hayBase) return;
  s = await sembrarEstructura();
  foto = await fotoJpeg();
});
test.after(async () => {
  if (hayBase) await cerrarBase();
});
const conBase = (nombre, fn) => test(nombre, async (t) => (hayBase ? fn(t) : t.skip('sin PostgreSQL disponible')));

const query = (...a) => require(src('db')).query(...a);
const ayer = () => new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

// --- Captura de promovidos ---------------------------------------------------------
let consecutivo = 0;
const promovido = (extra = {}) => {
  consecutivo += 1;
  const n = String(consecutivo).padStart(3, '0');
  return {
    ineFrente: foto,
    ineReverso: foto,
    vigencia: '2033',
    seccion: '0421',
    paterno: 'GARCIA',
    materno: 'LOPEZ',
    nombres: 'MARIA',
    claveElector: `GRLPMR90051527M${n}`,
    curp: `GALM900515MTCRPR${String(consecutivo % 10)}${consecutivo % 10}`.slice(0, 16) + `0${consecutivo % 10}`,
    telefono: '5512345678',
    cp: '86000',
    localidad: 'CENTRO',
    calle: 'JUAREZ',
    numExt: '123',
    consentimiento: true,
    ...extra,
  };
};

conBase('sin internet: un envío repetido (mismo identificador del teléfono) no duplica el promovido', async () => {
  const promovidos = require(src('promovidos'));
  const clientId = crypto.randomUUID();
  const body = { ...promovido(), clientId, capturadoAt: new Date(Date.now() - 3600000).toISOString() };
  const a = await promovidos.crear(s.promotor, body);
  const b = await promovidos.crear(s.promotor, body);
  assert.equal(b.id, a.id);
  assert.equal(b.repetido, true);
  const { rows } = await query("SELECT count(*)::int AS n FROM promovidos WHERE data->>'clientId' = $1", [clientId]);
  assert.equal(rows[0].n, 1);
});

conBase('la misma persona (CURP o clave) no se registra dos veces en la estructura del CPV', async () => {
  const promovidos = require(src('promovidos'));
  const body = promovido();
  await promovidos.crear(s.promotor, { ...body, clientId: crypto.randomUUID() });
  await assert.rejects(
    promovidos.crear(s.promotor2, { ...body, claveElector: 'XXXXXX90051527M999', clientId: crypto.randomUUID() }),
    (e) => e.status === 409 && /CURP/.test(e.fields?.curp || '')
  );
});

conBase('el servidor rechaza una CURP inválida y dice qué carácter revisar', async () => {
  const promovidos = require(src('promovidos'));
  await assert.rejects(
    promovidos.crear(s.promotor, { ...promovido(), curp: 'GALM900515MTXRPR09', clientId: crypto.randomUUID() }),
    (e) => e.status === 422 && /estado de nacimiento/.test(e.fields?.curp || '')
  );
});

conBase('solo se capturan promovidos de la sección del Responsable', async () => {
  const promovidos = require(src('promovidos'));
  await assert.rejects(promovidos.crear(s.promotor, { ...promovido(), seccion: '0999', clientId: crypto.randomUUID() }), (e) => e.status === 422 && /sección/.test(e.fields?.seccion || ''));
});

// --- Existencias de material -----------------------------------------------------
conBase('material: la existencia nunca queda negativa (órdenes, recepciones y activaciones)', async () => {
  const m = require(src('material'));
  const { id: art } = await m.crearArticulo(s.cpv, { nombre: `Gorra ${crypto.randomBytes(2).toString('hex')}`, unidad: 'piezas', cantidad: 100 });
  const o1 = await m.crearOrden(s.cpv, { paraId: s.zona.id, items: [{ articuloId: art, cantidad: 60 }] });
  // No se puede entregar más de lo disponible
  await assert.rejects(m.crearOrden(s.cpv, { paraId: s.zona.id, items: [{ articuloId: art, cantidad: 41 }] }), (e) => e.status === 422 && Boolean(e.fields?.porArticulo?.[art]));
  await m.recibir(s.zona, o1.id);
  const o2 = await m.crearOrden(s.zona, { paraId: s.rs.id, items: [{ articuloId: art, cantidad: 40 }] });
  // Lo que está por recibir todavía no se puede repartir
  await assert.rejects(m.crearActivacion(s.rs, { fecha: ayer(), hora: '10:00', lugar: 'Parque', items: [{ articuloId: art, cantidad: 1 }], fotos: Array(5).fill(foto) }), (e) => Boolean(e.fields?.porArticulo?.[art]));
  await m.recibir(s.rs, o2.id);

  await m.crearActivacion(s.rs, { fecha: ayer(), hora: '10:00', lugar: 'Parque central', items: [{ articuloId: art, cantidad: 15 }], fotos: Array(5).fill(foto) });
  let inv = (await m.resumen(s.rs)).inventario.find((a) => a.id === art);
  assert.equal(inv.disponible, 25);
  assert.equal(inv.entregado, 15);

  // Más de lo que hay en existencia
  await assert.rejects(m.crearActivacion(s.rs, { fecha: ayer(), hora: '11:00', lugar: 'Mercado', items: [{ articuloId: art, cantidad: 26 }], fotos: Array(5).fill(foto) }), (e) => Boolean(e.fields?.porArticulo?.[art]));

  // Dos activaciones al mismo tiempo que juntas exceden la existencia: solo una pasa
  const r = await Promise.allSettled([20, 20].map((n) => m.crearActivacion(s.rs, { fecha: ayer(), hora: '12:00', lugar: 'Escuela', items: [{ articuloId: art, cantidad: n }], fotos: Array(5).fill(foto) })));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  inv = (await m.resumen(s.rs)).inventario.find((a) => a.id === art);
  assert.equal(inv.disponible, 5);
  assert.ok(inv.disponible >= 0);
});

conBase('activaciones: mínimo 5 fotos, sin fechas futuras ni eventos futuros', async () => {
  const m = require(src('material'));
  const base = { fecha: ayer(), hora: '10:00', lugar: 'Parque', items: [{ articuloId: crypto.randomUUID(), cantidad: 1 }] };
  await assert.rejects(m.crearActivacion(s.rs, { ...base, fotos: Array(4).fill(foto) }), (e) => /5 fotos/.test(e.fields?.fotos || ''));
  await assert.rejects(m.crearActivacion(s.rs, { ...base, fecha: '2099-01-01', fotos: Array(5).fill(foto) }), (e) => /futuro/.test(e.fields?.fecha || ''));
  await assert.rejects(m.crearActivacion(s.rs, { ...base, eventoId: crypto.randomUUID(), fotos: Array(5).fill(foto) }), (e) => /ya haya ocurrido/.test(e.fields?.eventoId || ''));
  await assert.rejects(m.crearActivacion(s.promotor, { ...base, fotos: Array(5).fill(foto) }), (e) => e.status === 403);
});

// --- Asistencia con selfie --------------------------------------------------------
async function crearEvento(inicioEnHoras, extra = {}) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO eventos (id, tipo, estado, cpv_id, lugar, asistentes, inicio, alcance, publicado_at, reporta_id)
     VALUES ($1, 'asamblea', $2, $3, 'Centro comunitario', 100, now() + ($4::float * interval '1 hour'), 'red', now(), $5)`,
    [id, extra.estado || 'programado', s.cpv.id, inicioEnHoras, extra.reportaId || null]
  );
  return id;
}
const moverEvento = (id, horas) => query("UPDATE eventos SET inicio = now() + ($2::float * interval '1 hour') WHERE id = $1", [id, horas]);
const asistencia = async (ev, userId) => (await query('SELECT estado, aviso_at FROM evento_asistencias WHERE evento_id = $1 AND user_id = $2', [ev, userId])).rows[0];

conBase('asistencia: se confirma antes; al terminar se pide la selfie y con ella se acredita', async () => {
  const eventos = require(src('eventos'));
  const ev = await crearEvento(2);
  await eventos.confirmarAsistencia(s.promotor, ev);
  // Antes de iniciar no se puede enviar la selfie
  await assert.rejects(eventos.enviarSelfie(s.promotor, ev, foto), (e) => e.status === 409);
  // El evento ya terminó (sin hora de fin: 3 horas después de iniciar)
  await moverEvento(ev, -4);
  await eventos.recordatorios();
  assert.ok((await asistencia(ev, s.promotor.id)).aviso_at, 'se envió el aviso');
  const { rows } = await query("SELECT count(*)::int AS n FROM notificaciones WHERE user_id = $1 AND tipo = 'evento.selfie'", [s.promotor.id]);
  assert.equal(rows[0].n, 1);
  await eventos.enviarSelfie(s.promotor, ev, foto);
  assert.equal((await asistencia(ev, s.promotor.id)).estado, 'acreditada');
  // Ya no se puede confirmar un evento que empezó
  await assert.rejects(eventos.confirmarAsistencia(s.promotor2, ev), (e) => e.status === 409);
});

conBase('asistencia: sin selfie 72 horas después de terminar, se retira y se avisa', async () => {
  const eventos = require(src('eventos'));
  const ev = await crearEvento(2);
  await eventos.confirmarAsistencia(s.promotor2, ev);
  await moverEvento(ev, -(3 + 72 + 1));
  await eventos.recordatorios();
  assert.equal((await asistencia(ev, s.promotor2.id)).estado, 'retirada');
  const { rows } = await query("SELECT count(*)::int AS n FROM notificaciones WHERE user_id = $1 AND tipo = 'evento.asistencia_retirada'", [s.promotor2.id]);
  assert.equal(rows[0].n, 1);
  await assert.rejects(eventos.enviarSelfie(s.promotor2, ev, foto), (e) => e.status === 409);
});

// --- Permisos ------------------------------------------------------------------------
conBase('permisos: la estructura no abre eventos pasados ni ve reportes; quien reporta y el CPV sí', async () => {
  const eventos = require(src('eventos'));
  const ev = await crearEvento(-48, { estado: 'realizado', reportaId: s.rs.id });
  await assert.rejects(eventos.detalle(s.promotor, ev), (e) => e.status === 404);
  await assert.rejects(eventos.detalle(s.zona, ev), (e) => e.status === 404);
  const rs = await eventos.detalle(s.rs, ev); // lo reporta
  assert.equal(rs.soloInicio, undefined);
  const cpv = await eventos.detalle(s.cpv, ev);
  assert.ok(Array.isArray(cpv.asistentesEstructura));

  const futuro = await crearEvento(24);
  const d = await eventos.detalle(s.promotor, futuro);
  assert.equal(d.soloInicio, true);
  assert.equal(d.reporte, null);
  assert.equal(d.asistencia, null);
  assert.equal(d.asistentes, null);
  assert.equal(d.cpv, null);
  assert.equal(d.reporta, null);
});

conBase('permisos: la selfie solo la ven quien la tomó, el CPV y el super administrador', async () => {
  const eventos = require(src('eventos'));
  const ev = await crearEvento(2);
  await eventos.confirmarAsistencia(s.promotor, ev);
  await moverEvento(ev, -1);
  await eventos.enviarSelfie(s.promotor, ev, foto);
  assert.ok(await eventos.selfieDe(s.promotor, ev, s.promotor.id));
  assert.ok(await eventos.selfieDe(s.cpv, ev, s.promotor.id));
  await assert.rejects(eventos.selfieDe(s.promotor2, ev, s.promotor.id), (e) => e.status === 404);
  await assert.rejects(eventos.selfieDe(s.rs, ev, s.promotor.id), (e) => e.status === 404);
});

conBase('permisos: puntos de la sección (casillas solo el Responsable; cada quien borra lo suyo)', async () => {
  const puntos = require(src('puntos'));
  const p = await puntos.crear(s.promotor, { tipo: 'interes', nombre: 'Tienda', lat: 17.99, lng: -92.93 });
  await assert.rejects(puntos.crear(s.promotor, { tipo: 'casilla', lat: 17.99, lng: -92.93 }), (e) => e.status === 403);
  await assert.rejects(puntos.borrar(s.promotor2, p.id), (e) => e.status === 403);
  const casilla = await puntos.crear(s.rs, { tipo: 'casilla', lat: 17.98, lng: -92.92 });
  assert.equal(casilla.nombre, 'Casilla');
  // El otro promotor ve los dos puntos del equipo
  assert.equal((await puntos.lista(s.promotor2)).length, 2);
  await puntos.borrar(s.rs, p.id); // el Responsable puede borrar cualquiera
  await assert.rejects(puntos.crear(s.promotor, { tipo: 'interes', nombre: 'Lejos', lat: 40.4, lng: -3.7 }), (e) => e.status === 422);
});
