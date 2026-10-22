// Versión: el número de package.json coincide con el registro de cambios y cada versión tiene su nombre
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { src, raiz } = require('./apoyo/base');

const version = require(src('version'));
const paquete = require(path.join(raiz, 'package.json'));

test('package.json y el registro de cambios tienen el mismo número de versión', () => {
  assert.equal(version.actual().version, paquete.version);
});

test('nombres: la 1.x es «White» y la 2.x será «Goodman»', () => {
  assert.equal(version.nombreDe('1.2.0'), 'White');
  assert.equal(version.nombreDe('1.0.0'), 'White');
  assert.equal(version.nombreDe('2.0.0'), 'Goodman');
  for (const v of version.recientes()) assert.ok(v.nombre, `la ${v.version} no tiene nombre`);
});

test('en Configuración solo se muestran la versión actual y la anterior, de la más nueva a la más vieja', () => {
  const r = version.recientes();
  assert.equal(r.length, 2);
  const n = (v) => v.split('.').map(Number).reduce((t, x) => t * 1000 + x, 0);
  assert.ok(n(r[0].version) > n(r[1].version));
  assert.ok(r[0].fecha >= r[1].fecha);
});
