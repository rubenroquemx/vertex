// Jornada electoral: única fuente de la fecha en el servidor (la interfaz la recibe en /api/me).
// Apertura de casillas a las 8:00, hora del centro.
const FECHA = new Date('2027-06-06T08:00:00-06:00');
const ELECCION = {
  fecha: FECHA,
  anio: 2027,
  texto: '6 de junio de 2027',
  diasRestantes: () => Math.max(0, Math.ceil((FECHA - Date.now()) / 86400000)),
};
module.exports = ELECCION;
