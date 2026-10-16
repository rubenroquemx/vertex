// Listas de personas en Excel con un solo formato para todo el sistema: estructuras paralelas
// (estructuras externas) y listas de asistencia de asambleas y recorridos.
// Columnas: CLAVE_ELECTOR, CURP, APELLIDO_PATERNO, APELLIDO_MATERNO, NOMBRES, TELEFONO, SECCION.
// La persona se identifica por su clave de elector o por su CURP (basta con una).
const ExcelJS = require('exceljs');
const { CLAVE_ELECTOR_RE, CURP_RE } = require('./promovidos');

const MAX_FILAS = 200000;
const COLUMNAS = ['CLAVE_ELECTOR', 'CURP', 'APELLIDO_PATERNO', 'APELLIDO_MATERNO', 'NOMBRES', 'TELEFONO', 'SECCION'];

class ListaError extends Error {}

// Encabezados aceptados (sin acentos, espacios ni guiones)
const llave = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
const SINONIMOS = {
  clave: ['CLAVEELECTOR', 'CLAVEDEELECTOR', 'CLAVE', 'CVEELECTOR', 'CLAVEINE'],
  curp: ['CURP'],
  paterno: ['APELLIDOPATERNO', 'PATERNO', 'APPATERNO', 'APATERNO'],
  materno: ['APELLIDOMATERNO', 'MATERNO', 'APMATERNO', 'AMATERNO'],
  nombres: ['NOMBRES', 'NOMBRE'],
  telefono: ['TELEFONO', 'NOTELEFONICO', 'NUMEROTELEFONICO', 'TEL', 'CELULAR', 'NOTELEFONO', 'NUMTELEFONO'],
  seccion: ['SECCION', 'SECCIONELECTORAL', 'SECC', 'NOSECCION'],
};
const texto = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return String(v.result ?? '');
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return String(v);
};
const limpio = (v) => texto(v).trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 120);
const sinEspacios = (v) => texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

// Lee la primera hoja. Devuelve filas válidas (con clave o CURP), las filas con error y las repetidas
// dentro del mismo archivo (por clave o por CURP), que se omiten.
async function leer(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ListaError('No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) con la plantilla.');
  }
  const hoja = wb.worksheets[0];
  if (!hoja) throw new ListaError('El archivo no tiene hojas.');
  let col = null;
  const filas = [];
  const errores = [];
  let leidas = 0;
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values;
    if (!col) {
      // Primera fila con encabezados reconocibles
      const mapa = {};
      vals.forEach((v, i) => {
        const k = llave(texto(v));
        for (const [campo, sin] of Object.entries(SINONIMOS)) if (sin.includes(k) && !(campo in mapa)) mapa[campo] = i;
      });
      if ('clave' in mapa || 'curp' in mapa) col = mapa;
      return;
    }
    const val = (c) => (col[c] === undefined ? '' : vals[col[c]]);
    const clave = sinEspacios(val('clave'));
    const curp = sinEspacios(val('curp'));
    const paterno = limpio(val('paterno'));
    const materno = limpio(val('materno'));
    const nombres = limpio(val('nombres'));
    if (!clave && !curp && !paterno && !materno && !nombres) return; // fila vacía
    leidas += 1;
    if (leidas > MAX_FILAS) return;
    const c = CLAVE_ELECTOR_RE.test(clave) ? clave : null;
    const u = CURP_RE.test(curp) ? curp : null;
    if (!c && !u) {
      errores.push(row.number);
      return;
    }
    const sec = Number(texto(val('seccion')).replace(/\D/g, ''));
    filas.push({
      c,
      u,
      paterno,
      materno,
      nombres,
      tel: texto(val('telefono')).replace(/\D/g, '').slice(-10),
      seccion: Number.isInteger(sec) && sec > 0 && sec < 10000 ? sec : null,
    });
  });
  if (!col) throw new ListaError('No se encontraron los encabezados. Usa la plantilla: debe tener al menos la columna CLAVE_ELECTOR o CURP.');
  if (leidas > MAX_FILAS) throw new ListaError(`El archivo tiene más de ${MAX_FILAS.toLocaleString('es-MX')} filas; divídelo en varias cargas.`);
  // Repetidas dentro del archivo
  const vistasC = new Set();
  const vistasU = new Set();
  const unicas = [];
  let repetidas = 0;
  for (const r of filas) {
    if ((r.c && vistasC.has(r.c)) || (r.u && vistasU.has(r.u))) {
      repetidas += 1;
      continue;
    }
    if (r.c) vistasC.add(r.c);
    if (r.u) vistasU.add(r.u);
    unicas.push(r);
  }
  return { leidas, validas: filas.length, unicas, repetidas, errores };
}

// Excel desde un data URL (cuando viaja dentro de un JSON, p. ej. en el reporte del evento)
function desdeDataUrl(dataUrl) {
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

const xlsxTipo = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Plantilla vacía con instrucciones
async function plantilla(hojaNombre = 'Personas', instrucciones = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(hojaNombre);
  ws.columns = COLUMNAS.map((h) => ({ header: h, key: h, width: h === 'CURP' || h === 'CLAVE_ELECTOR' ? 24 : h === 'SECCION' ? 12 : 20 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const ins = wb.addWorksheet('Instrucciones');
  [
    `Llena la hoja «${hojaNombre}» con una persona por fila, a partir de la fila 2.`,
    'Cada persona debe tener al menos su CLAVE_ELECTOR (18 caracteres) o su CURP (18 caracteres).',
    'SECCION es la sección electoral de la credencial (número de hasta 4 dígitos).',
    'Las filas sin clave de elector ni CURP válidas no se pueden cotejar y se reportan como error.',
    'Si una persona aparece dos veces en el archivo, se toma una sola vez.',
    ...instrucciones,
  ].forEach((t, i) => (ins.getCell(`A${i + 1}`).value = t));
  ins.getColumn(1).width = 110;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Exporta personas con el mismo formato (para descargar una lista ya cargada)
async function exportar(personas, hojaNombre = 'Personas') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(hojaNombre);
  ws.columns = COLUMNAS.map((h) => ({ header: h, key: h, width: 20 }));
  ws.getRow(1).font = { bold: true };
  for (const p of personas)
    ws.addRow([p.clave_elector || '', p.curp || '', p.paterno || '', p.materno || '', p.nombres || '', p.telefono || '', p.seccion ?? '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { ListaError, COLUMNAS, leer, desdeDataUrl, plantilla, exportar, xlsxTipo };
