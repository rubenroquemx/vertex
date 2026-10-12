// Formatos de presentación compartidos en el servidor.

// Sección electoral siempre con 4 dígitos, como en la credencial del INE (420 → 0420)
const fmtSeccion = (s) => (s === null || s === undefined || s === '' ? '' : String(Number(s)).padStart(4, '0'));

module.exports = { fmtSeccion };
