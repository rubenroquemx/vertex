// Centro de avisos del CPV: quién recibe según niveles y alcance, envío, historial y límites
const test = require('node:test');
const assert = require('node:assert/strict');
const { src, prepararBase, cerrarBase, sembrarEstructura } = require('./apoyo/base');

let hayBase = false;
let s;
let otra; // segunda zona: CZ2 → RS2 (sección 0500) → promotor
test.before(async () => {
  hayBase = await prepararBase();
  if (!hayBase) return;
  s = await sembrarEstructura();
  const { users } = require(src('store'));
  const cz2 = await users.create({ role: 'coord_zona', parentId: s.cpv.id, name: 'Zona Dos', zona: { codigo: 'Z2', nombre: 'Zona 2', color: '#16a34a' } });
  const rs2 = await users.create({ role: 'resp_seccion', parentId: cz2.id, name: 'Responsable Dos', territorio: { entidad: 27, tipo: 'secciones', metodo: 'manual', secciones: [500] } });
  const pr3 = await users.create({ role: 'promotor', parentId: rs2.id, name: 'Promotor Tres' });
  otra = { cz2, rs2, pr3 };
  // Otro CPV: nunca debe recibir avisos del primero
  const cpvB = await users.create({ role: 'coord_promocion', name: 'Otro CPV' });
  const czB = await users.create({ role: 'coord_zona', parentId: cpvB.id, name: 'Zona ajena', zona: { codigo: 'ZX', nombre: 'Ajena' } });
  otra.ajenos = [cpvB.id, czB.id];
});
test.after(async () => {
  if (hayBase) await cerrarBase();
});
const conBase = (nombre, fn) => test(nombre, async (t) => (hayBase ? fn(t) : t.skip('sin PostgreSQL disponible')));
const TODOS = ['coord_zona', 'resp_seccion', 'promotor'];
const ids = (lista) => new Set(lista);

conBase('global: toda la estructura del CPV y nadie de otro CPV', () => {
  const a = require(src('avisos'));
  const r = ids(a.destinatarios(s.cpv, { niveles: TODOS, alcance: 'global', zonas: [], secciones: [] }));
  for (const u of [s.zona, s.rs, s.promotor, s.promotor2, otra.cz2, otra.rs2, otra.pr3]) assert.ok(r.has(u.id), u.name);
  for (const id of [...otra.ajenos, s.cpv.id]) assert.ok(!r.has(id));
  assert.equal(r.size, 7);
});

conBase('por nivel: solo promotores', () => {
  const a = require(src('avisos'));
  const r = ids(a.destinatarios(s.cpv, { niveles: ['promotor'], alcance: 'global', zonas: [], secciones: [] }));
  assert.deepEqual(r, ids([s.promotor.id, s.promotor2.id, otra.pr3.id]));
});

conBase('por zona: solo la estructura de las zonas elegidas', () => {
  const a = require(src('avisos'));
  const r = ids(a.destinatarios(s.cpv, { niveles: TODOS, alcance: 'zonas', zonas: [otra.cz2.id], secciones: [] }));
  assert.deepEqual(r, ids([otra.cz2.id, otra.rs2.id, otra.pr3.id]));
});

conBase('por sección: responsable y promotores de la sección, y el coordinador de su zona', () => {
  const a = require(src('avisos'));
  const r = ids(a.destinatarios(s.cpv, { niveles: TODOS, alcance: 'secciones', zonas: [], secciones: [421] }));
  assert.deepEqual(r, ids([s.zona.id, s.rs.id, s.promotor.id, s.promotor2.id]));
  const soloRs = ids(a.destinatarios(s.cpv, { niveles: ['resp_seccion'], alcance: 'secciones', zonas: [], secciones: [421, 500] }));
  assert.deepEqual(soloRs, ids([s.rs.id, otra.rs2.id]));
});

conBase('opciones: zonas del CPV y solo secciones con Responsable', () => {
  const a = require(src('avisos'));
  const o = a.opciones(s.cpv);
  assert.deepEqual(o.zonas.map((z) => z.codigo), ['Z1', 'Z2']);
  assert.deepEqual(o.secciones.map((x) => x.clave), [421, 500]);
});

conBase('enviar: crea la notificación a cada destinatario y queda en el historial', async () => {
  const a = require(src('avisos'));
  const { query } = require(src('db'));
  const r = await a.enviar(s.cpv, s.cpv, { niveles: ['promotor'], alcance: 'zonas', zonas: [s.zona.id], titulo: 'Reunión el sábado', cuerpo: 'Nos vemos a las 10 en la casa de campaña.' });
  assert.equal(r.destinatarios, 2);
  const { rows } = await query("SELECT user_id FROM notificaciones WHERE tipo = 'cpv.aviso' AND titulo = 'Reunión el sábado'");
  assert.deepEqual(ids(rows.map((x) => x.user_id)), ids([s.promotor.id, s.promotor2.id]));
  const h = await a.historial(s.cpv);
  assert.equal(h[0].titulo, 'Reunión el sábado');
  assert.equal(h[0].destinatarios, 2);
  assert.deepEqual(h[0].zonas, ['Z1 · Zona 1']);
});

conBase('enviar: valida título, mensaje y que alguien coincida', async () => {
  const a = require(src('avisos'));
  await assert.rejects(a.enviar(s.cpv, s.cpv, { niveles: TODOS, alcance: 'global', titulo: '', cuerpo: 'x' }), (e) => e.status === 422 && Boolean(e.fields?.titulo && e.fields?.cuerpo));
  await assert.rejects(a.enviar(s.cpv, s.cpv, { niveles: [], alcance: 'global', titulo: 'Hola', cuerpo: 'Mensaje' }), (e) => Boolean(e.fields?.niveles));
  await assert.rejects(a.enviar(s.cpv, s.cpv, { niveles: TODOS, alcance: 'secciones', secciones: [9999], titulo: 'Hola', cuerpo: 'Mensaje' }), (e) => /Nadie/.test(e.message));
});
