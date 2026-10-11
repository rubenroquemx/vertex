// Escritura atómica de archivos, tolerante a bloqueos momentáneos de Windows
// (antivirus o indexador pueden retener el archivo destino unos milisegundos).
const fs = require('fs');

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let i = 0; i < 6; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!TRANSIENT.has(err.code)) throw err;
      pause(25 * (i + 1));
    }
  }
  // Último recurso: escritura directa (no atómica, pero no se pierde el cambio)
  fs.writeFileSync(file, data);
  fs.rmSync(tmp, { force: true });
}

module.exports = { atomicWrite };
