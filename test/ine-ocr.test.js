// Lector de la INE: análisis del texto leído (zona de lectura mecánica del reverso y frente)
const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./apoyo/base');

const { parsearZona, parsearFrente, verificador } = require(src('ine-ocr'));

test('dígito verificador ICAO 9303 (ejemplos oficiales)', () => {
  assert.equal(verificador('740812'), '2');
  assert.equal(verificador('120415'), '9');
  assert.equal(verificador('L898902C3'), '6');
});

const zona = (nac, vig, nombre = 'GARCIA<LOPEZ<<MARIA<JOSE<<<<<<') =>
  ['IDMEX2123456789<<0420123456789', `${nac}${verificador(nac)}M${vig}${verificador(vig)}MEX<01<<12345<6`, nombre].join('\n');

test('reverso: vigencia, nacimiento, nombres, CIC y número OCR', () => {
  const r = parsearZona(zona('900515', '331231'));
  assert.equal(r.campos.vigencia, '2033');
  assert.equal(r.verificado.vigencia, true);
  assert.equal(r.campos.nacimiento, '1990-05-15');
  assert.equal(r.verificado.nacimiento, true);
  assert.equal(r.campos.paterno, 'GARCIA');
  assert.equal(r.campos.materno, 'LOPEZ');
  assert.equal(r.campos.nombres, 'MARIA JOSE');
  assert.equal(r.campos.cic, '212345678');
  assert.equal(r.campos.ocr, '0420123456789');
});

test('reverso: corrige O→0 y marca como no verificada una fecha cuyo dígito no cuadra', () => {
  const r = parsearZona(zona('900515', '331231').replace('900515', '9OO515'));
  assert.equal(r.campos.nacimiento, '1990-05-15');
  assert.equal(r.verificado.nacimiento, true);
  // Línea 2 con el dígito verificador de la vigencia alterado
  const otro = String((Number(verificador('331231')) + 1) % 10);
  const lineas = zona('900515', '331231').split('\n');
  lineas[1] = `${lineas[1].slice(0, 14)}${otro}${lineas[1].slice(15)}`;
  const malo = parsearZona(lineas.join('\n'));
  assert.equal(malo.campos.vigencia, '2033');
  assert.equal(malo.verificado.vigencia, false);
});

test('reverso: el relleno «<<<» leído como letras no se pega a los nombres', () => {
  const r = parsearZona(zona('900515', '331231', 'GARCIA<LOPEZ<<MARIA<JOSE<<K<K<LKLKL'));
  assert.equal(r.campos.nombres, 'MARIA JOSE');
});

test('reverso: texto sin zona de lectura mecánica no inventa datos', () => {
  const r = parsearZona('INSTITUTO NACIONAL ELECTORAL\nfirma\n');
  assert.deepEqual(r.campos, {});
});

const FRENTE = [
  'INSTITUTO NACIONAL ELECTORAL',
  'CREDENCIAL PARA VOTAR',
  'NOMBRE',
  'GARCÍA',
  'LÓPEZ',
  'MARÍA JOSÉ',
  'DOMICILIO',
  'C JUAREZ 123 INT 4',
  'COL CENTRO 86000',
  'CENTRO, TAB.',
  'CLAVE DE ELECTOR GRLPMR90O51527M8OO',
  'CURP GALM900515MTCRPRO9',
  'SECCIÓN 0420 VIGENCIA 2023 - 2033',
].join('\n');

test('frente: clave, CURP, sección, vigencia, nombres y domicilio', () => {
  const { campos: c } = parsearFrente(FRENTE);
  assert.equal(c.claveElector, 'GRLPMR90051527M800');
  assert.equal(c.curp, 'GALM900515MTCRPR09'); // el penúltimo «O» se corrige a «0» (nacida en el siglo XX)
  assert.equal(c.seccion, '0420');
  assert.equal(c.vigencia, '2033');
  assert.equal(c.paterno, 'GARCIA');
  assert.equal(c.materno, 'LOPEZ');
  assert.equal(c.nombres, 'MARIA JOSE');
  assert.equal(c.calle, 'JUAREZ');
  assert.equal(c.numExt, '123');
  assert.equal(c.numInt, '4');
  assert.equal(c.cp, '86000');
});

test('frente: CURP de quien nació desde el 2000 conserva letra en el penúltimo carácter', () => {
  const { campos: c } = parsearFrente(FRENTE.replace('CURP GALM900515MTCRPRO9', 'CURP GALM050515MTCRPRA9'));
  assert.equal(c.curp, 'GALM050515MTCRPRA9');
});

test('frente: texto ilegible no inventa clave ni CURP', () => {
  const { campos: c } = parsearFrente('INSTITUTO\nNACIONAL\n### ###\n');
  assert.equal(c.claveElector, undefined);
  assert.equal(c.curp, undefined);
});
