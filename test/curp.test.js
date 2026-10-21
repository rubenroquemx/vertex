// Validación de CURP y clave de elector: reglas del servidor y del teléfono (deben ser iguales)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sinBase, src, raiz } = require('./apoyo/base');

sinBase();
const { CURP_RE, CLAVE_ELECTOR_RE, motivoCurp } = require(src('promovidos'));

// La misma función del teléfono, tomada de public/js/promovidos.js
function motivoCurpTelefono() {
  const codigo = fs.readFileSync(path.join(raiz, 'public', 'js', 'promovidos.js'), 'utf8').replace(/\r\n/g, '\n');
  const inicio = codigo.indexOf('// CURP: si no es válida');
  const fin = codigo.indexOf('\n}\n', inicio) + 2;
  assert.ok(inicio >= 0 && fin > inicio, 'no se encontró motivoCurp en el código del teléfono');
  return new Function(`${codigo.slice(inicio, fin)}\nreturn motivoCurp;`)();
}

const VALIDAS = ['GALM900515MTCRPR09', 'PEXA050101HDFRXNA4', 'XEXX010101HNEXXXA4', 'BXEI900101MNLRNR03', 'OOOM751231HJCRRL05'];
const INVALIDAS = {
  GALM9OO515MTCRPR09: /fecha de nacimiento/,
  GALM901315MTCRPR09: /no es válida/,
  GALM900532MTCRPR09: /no es válida/,
  GALM900515MTXRPR09: /estado de nacimiento/,
  GALM900515MTCRAR09: /consonantes/,
  GBLM900515MTCRPR09: /vocal/,
  GALM900515ZTCRPR09: /sexo/,
  GALM900515MTCRPR0O: /último carácter/,
  GALM900515MTCRPR0: /18 caracteres/,
  G4LM900515MTCRPR09: /letras/,
};

test('CURP válidas: pasan en el servidor sin mensaje de error', () => {
  for (const c of VALIDAS) {
    assert.ok(CURP_RE.test(c), `${c} debería ser válida`);
    assert.equal(motivoCurp(c), null, c);
  }
});

test('CURP inválidas: el servidor las rechaza y dice qué parte revisar', () => {
  for (const [c, re] of Object.entries(INVALIDAS)) {
    assert.ok(!CURP_RE.test(c), `${c} debería rechazarse`);
    assert.match(motivoCurp(c) || '', re, c);
  }
});

test('el teléfono valida la CURP exactamente igual que el servidor', () => {
  const telefono = motivoCurpTelefono();
  for (const c of [...VALIDAS, ...Object.keys(INVALIDAS), '', 'XXXXXXXXXXXXXXXXXX', '123456789012345678']) {
    assert.equal(telefono(c), motivoCurp(c), `diferencia con «${c}»`);
    // Lo que el teléfono acepta, el servidor también (evita capturas sin internet rechazadas al enviar)
    if (telefono(c) === null) assert.ok(CURP_RE.test(c), `el teléfono aceptó «${c}» y el servidor no`);
  }
});

test('clave de elector: 6 letras, 8 números, H/M/X y 3 números', () => {
  for (const c of ['GRLPMR90051527M800', 'ABCDEF12345678H123', 'ABCDEF12345678X001']) assert.ok(CLAVE_ELECTOR_RE.test(c), c);
  for (const c of ['GRLPMR9005152M800', 'GRLPMR90051527Z800', 'GRLPM190051527M800', 'grlpmr90051527m800']) assert.ok(!CLAVE_ELECTOR_RE.test(c), c);
});
