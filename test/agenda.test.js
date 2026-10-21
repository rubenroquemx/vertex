// Agenda: plazos de la asistencia con selfie y lo que ve la estructura (sin base de datos)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { sinBase, src } = require('./apoyo/base');

sinBase();
const { _pruebas: E } = require(src('eventos'));

const H = 3600000;
const hace = (h) => new Date(Date.now() - h * H);
const evento = (extra = {}) => ({
  id: crypto.randomUUID(),
  folio: 7,
  tipo: 'asamblea',
  estado: 'programado',
  lugar: 'Centro comunitario',
  inicio: hace(-24),
  fin: null,
  asistentes: 300,
  alcance: 'red',
  zonas: [],
  cpv_id: 'cpv',
  reporta_id: 'quien-reporta',
  reporte_tardio: true,
  updated_at: new Date(),
  ...extra,
});

test('fin del evento: su hora de fin o 3 horas después de iniciar', () => {
  const ini = new Date('2026-11-11T19:00:00-06:00');
  assert.equal(E.finDe({ inicio: ini, fin: null }).getTime(), ini.getTime() + E.HORAS_EVENTO * H);
  const fin = new Date('2026-11-11T21:00:00-06:00');
  assert.equal(E.finDe({ inicio: ini, fin }).getTime(), fin.getTime());
  assert.equal(E.limiteSelfie({ inicio: ini, fin }).getTime(), fin.getTime() + E.HORAS_SELFIE * H);
});

test('selfie: solo con asistencia confirmada, desde que inicia el evento y hasta 72 horas después de terminar', () => {
  const confirmada = { estado: 'confirmada' };
  assert.equal(E.puedeSelfie(evento({ inicio: hace(-2) }), confirmada), false, 'antes de iniciar');
  assert.equal(E.puedeSelfie(evento({ inicio: hace(1) }), confirmada), true, 'durante el evento');
  assert.equal(E.puedeSelfie(evento({ inicio: hace(40) }), confirmada), true, 'dentro del plazo');
  assert.equal(E.puedeSelfie(evento({ inicio: hace(3 + 72 + 1) }), confirmada), false, 'plazo vencido');
  assert.equal(E.puedeSelfie(evento({ inicio: hace(1) }), { estado: 'acreditada' }), false, 'ya acreditada');
  assert.equal(E.puedeSelfie(evento({ inicio: hace(1) }), null), false, 'sin confirmar');
});

test('la estructura (salvo quien reporta) tiene la vista restringida; el CPV y el super administrador no', () => {
  const e = evento();
  for (const role of ['coord_zona', 'resp_seccion', 'promotor']) assert.equal(E.restringido({ id: 'x', role }, e), true, role);
  assert.equal(E.restringido({ id: 'quien-reporta', role: 'resp_seccion' }, e), false, 'quien reporta');
  for (const role of ['coord_promocion', 'superadmin']) assert.equal(E.restringido({ id: 'x', role }, e), false, role);
});

test('resumen para la estructura: sin hora de fin, asistentes, quién reporta ni reporte tardío; los pasados no se abren', () => {
  const promotor = { id: 'p1', role: 'promotor' };
  const futuro = E.resumenFila(promotor, evento({ fin: hace(-26) }));
  assert.equal(futuro.fin, null);
  assert.equal(futuro.asistentes, null);
  assert.equal(futuro.reporta, null);
  assert.equal(futuro.reporteTardio, false);
  assert.equal(futuro.sinDetalle, false);
  const pasado = E.resumenFila(promotor, evento({ inicio: hace(72), estado: 'realizado' }));
  assert.equal(pasado.sinDetalle, true);
  // Con asistencia confirmada y plazo abierto, el evento pasado se abre para enviar la selfie
  const conSelfie = E.resumenFila(promotor, evento({ inicio: hace(30) }), {}, { estado: 'confirmada', confirmada_at: hace(40), selfie_at: null });
  assert.equal(conSelfie.sinDetalle, false);
  assert.equal(conSelfie.miAsistencia.estadoTexto, 'Falta tu selfie');
});

test('resumen para el CPV: ve todo', () => {
  const r = E.resumenFila({ id: 'cpv', role: 'coord_promocion' }, evento({ fin: hace(-26) }));
  assert.equal(r.asistentes, 300);
  assert.notEqual(r.fin, null);
  assert.equal(r.sinDetalle, undefined);
});
