// Caché breve en memoria para cálculos pesados (paneles): muchas visitas simultáneas comparten
// el mismo resultado durante unos segundos. Si dos piden a la vez, se calcula una sola vez.
const cache = new Map();

function memo(clave, ttlMs, fn) {
  const ahora = Date.now();
  const x = cache.get(clave);
  if (x && ahora - x.t < ttlMs) return x.p;
  const p = Promise.resolve()
    .then(fn)
    .catch((err) => {
      cache.delete(clave);
      throw err;
    });
  cache.set(clave, { t: ahora, p });
  return p;
}

// Limpieza periódica de lo vencido
setInterval(() => {
  const ahora = Date.now();
  for (const [k, x] of cache) if (ahora - x.t > 5 * 60 * 1000) cache.delete(k);
}, 60 * 1000).unref();

// Descarta lo guardado cuando cambia algo que altera los cálculos (p. ej. el factor de conversión),
// para que los paneles muestren el dato nuevo al momento y no después de que venza la caché
function olvidar() {
  cache.clear();
}

module.exports = { memo, olvidar };
