// Importación del padrón electoral / lista nominal del INE por sección (.xlsx).
//
// Formatos admitidos (detectados por encabezados):
//  - "Sexo": columnas LISTA NOMINAL, LISTA HOMBRES, LISTA MUJERES (y fila final TOTALES).
//  - "Entidad de origen": columnas LN_<ESTADO>, LN87, LN88 y PAD_<ESTADO>, PAD87, PAD88,
//    que se suman para obtener la lista nominal y el padrón de la sección.
// Siempre se omiten los residentes en el extranjero (sección 0) y las filas de totales.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const { atomicWrite } = require('./fsutil');

const DIR = path.join(DATA_DIR, 'padron');
const META_FILE = path.join(DIR, 'meta.json');

class PadronError extends Error {}

const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

// Valor "plano" de una celda de ExcelJS (números, texto enriquecido, fórmulas)
function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

const toInt = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

function mapColumns(headers) {
  const idx = (name) => headers.findIndex((h) => h === name);
  const cols = {
    entidad: idx('CLAVE ENTIDAD'),
    nombreEntidad: idx('NOMBRE ENTIDAD'),
    distritoFederal: idx('CLAVE DISTRITO'),
    municipio: idx('CLAVE MUNICIPIO'),
    nombreMunicipio: idx('NOMBRE MUNICIPIO'),
    seccion: idx('SECCION'),
    ln: idx('LISTA NOMINAL'),
    padron: idx('PADRON ELECTORAL') >= 0 ? idx('PADRON ELECTORAL') : idx('PADRON'),
    hombres: idx('LISTA HOMBRES'),
    mujeres: idx('LISTA MUJERES'),
    lnParts: [],
    padParts: [],
  };
  if (cols.ln < 0) cols.lnParts = headers.map((h, i) => (/^LN(_|\d)/.test(h) ? i : -1)).filter((i) => i >= 0);
  if (cols.padron < 0) cols.padParts = headers.map((h, i) => (/^PAD(_|\d)/.test(h) ? i : -1)).filter((i) => i >= 0);

  if (cols.entidad < 0 || cols.seccion < 0) {
    throw new PadronError('No se encontraron las columnas "CLAVE ENTIDAD" y "SECCION". Verifica que sea el archivo del INE.');
  }
  if (cols.ln < 0 && !cols.lnParts.length) {
    throw new PadronError('No se encontró la lista nominal (columna "LISTA NOMINAL" o columnas "LN_…").');
  }
  cols.format = cols.ln >= 0 ? 'sexo' : 'entidad_origen';
  return cols;
}

// Fecha de corte a partir del nombre del archivo u hoja: 20251225 (aaaammdd) o 25122025 (ddmmaaaa)
function detectCorte(...names) {
  for (const name of names) {
    for (const m of String(name || '').matchAll(/(\d{8})/g)) {
      const s = m[1];
      const ymd = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(s) ? [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)] : null;
      const dmy = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}$/.test(s) ? [s.slice(4, 8), s.slice(2, 4), s.slice(0, 2)] : null;
      const d = ymd || dmy;
      if (d) return `${d[0]}-${d[1]}-${d[2]}`;
    }
  }
  return null;
}

async function readWorkbook(buffer) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
    entries: 'emit',
  });

  let sheetName = null;
  let cols = null;
  const states = new Map(); // clave -> { nombre, secciones: Map }
  const skipped = { extranjero: 0, otros: 0 };
  let splitSections = 0;

  try {
    for await (const ws of reader) {
      sheetName = ws.name;
      for await (const row of ws) {
        const vals = row.values.map(cellValue); // índice 1 = columna A
        if (!cols) {
          cols = mapColumns(vals.map(norm));
          continue;
        }
        const get = (i) => (i >= 0 ? vals[i] : null);
        const ent = toInt(get(cols.entidad));
        const sec = toInt(get(cols.seccion));
        const nombreEnt = String(get(cols.nombreEntidad) ?? '').trim();
        if (!ent) {
          skipped.otros += 1; // fila de TOTALES, vacía o notas
          continue;
        }
        if (/EXTRANJ/i.test(nombreEnt) || sec === 0) {
          skipped.extranjero += 1;
          continue;
        }
        if (ent < 1 || ent > 32 || !sec || sec < 0) {
          skipped.otros += 1;
          continue;
        }
        const ln = cols.ln >= 0 ? toInt(get(cols.ln)) : cols.lnParts.reduce((s, i) => s + (toInt(vals[i]) || 0), 0);
        const pad =
          cols.padron >= 0
            ? toInt(get(cols.padron))
            : cols.padParts.length
              ? cols.padParts.reduce((s, i) => s + (toInt(vals[i]) || 0), 0)
              : null;

        if (!states.has(ent)) states.set(ent, { nombre: nombreEnt, secciones: new Map(), municipios: new Map() });
        const st = states.get(ent);
        const mun = toInt(get(cols.municipio));
        if (mun && cols.nombreMunicipio >= 0 && !st.municipios.has(mun)) st.municipios.set(mun, String(get(cols.nombreMunicipio)).trim());
        // [lista nominal, padrón, hombres, mujeres, municipio, distrito federal]
        const rec = [
          ln ?? 0,
          pad,
          cols.hombres >= 0 ? toInt(get(cols.hombres)) : null,
          cols.mujeres >= 0 ? toInt(get(cols.mujeres)) : null,
          mun,
          toInt(get(cols.distritoFederal)),
        ];
        const prev = st.secciones.get(sec);
        if (prev) {
          // Sección partida entre dos municipios: se suman sus electores y se conserva
          // como municipio el que aporta más electores
          const add = (a, b) => (a === null && b === null ? null : (a || 0) + (b || 0));
          if (rec[0] > prev[0]) [prev[4], prev[5]] = [rec[4], rec[5]];
          for (let i = 0; i < 4; i++) prev[i] = add(prev[i], rec[i]);
          splitSections += 1;
        } else {
          st.secciones.set(sec, rec);
        }
      }
      break; // solo la primera hoja
    }
  } catch (err) {
    if (err instanceof PadronError) throw err;
    throw new PadronError('No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) válido.');
  }

  if (!cols) throw new PadronError('El archivo está vacío.');
  if (!states.size) throw new PadronError('No se encontraron secciones válidas en el archivo.');
  return { sheetName, format: cols.format, states, skipped, splitSections };
}

function readMeta() {
  return fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, 'utf8')) : { states: {} };
}

async function importXlsx(buffer, { fileName, importedBy }) {
  const { sheetName, format, states, skipped, splitSections } = await readWorkbook(buffer);
  const corte = detectCorte(fileName, sheetName);
  const importedAt = new Date().toISOString();

  fs.mkdirSync(DIR, { recursive: true });
  const meta = readMeta();
  const summary = [];
  for (const [clave, st] of [...states].sort((a, b) => a[0] - b[0])) {
    const secciones = Object.fromEntries([...st.secciones].sort((a, b) => a[0] - b[0]));
    const totals = { secciones: st.secciones.size, ln: 0, padron: 0 };
    let hasPadron = false;
    for (const s of st.secciones.values()) {
      totals.ln += s[0];
      if (s[1] !== null) {
        totals.padron += s[1];
        hasPadron = true;
      }
    }
    if (!hasPadron) totals.padron = null;
    const file = path.join(DIR, `${String(clave).padStart(2, '0')}.json`);
    atomicWrite(file, JSON.stringify({ municipios: Object.fromEntries(st.municipios), secciones }));
    meta.states[clave] = { clave, nombre: st.nombre, ...totals, fileName, corte, importedAt, importedBy };
    summary.push(meta.states[clave]);
  }
  meta.lastImport = { fileName, corte, format, importedAt, importedBy, states: summary.length, skipped, splitSections };
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  return { ...meta.lastImport, totals: summary.reduce((t, s) => ({ secciones: t.secciones + s.secciones, ln: t.ln + s.ln }), { secciones: 0, ln: 0 }) };
}

function summary() {
  const meta = readMeta();
  return { lastImport: meta.lastImport || null, states: Object.values(meta.states).sort((a, b) => a.clave - b.clave) };
}

// Lista nominal por sección de una entidad: Map<sección, { ln, padron, hombres, mujeres, municipio, distritoFederal }>
const cache = new Map();
function sectionsOf(clave) {
  const file = path.join(DIR, `${String(clave).padStart(2, '0')}.json`);
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(clave);
  if (hit && hit.mtime === mtime) return hit.data;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = new Map(
    Object.entries(raw.secciones).map(([k, [ln, padron, hombres, mujeres, municipio, distritoFederal]]) => [
      Number(k),
      { ln, padron, hombres, mujeres, municipio, distritoFederal },
    ])
  );
  cache.set(clave, { mtime, data });
  return data;
}

// Cruce con la cartografía cargada: secciones que no coinciden entre ambos archivos
function crossCheck(clave, catalog) {
  const pad = sectionsOf(clave);
  if (!pad || !catalog) return null;
  const geo = new Set(catalog.secciones.map((s) => s.clave));
  const onlyPadron = [...pad.keys()].filter((k) => !geo.has(k));
  const onlyMap = [...geo].filter((k) => !pad.has(k));
  return { matched: geo.size - onlyMap.length, onlyPadron, onlyMap };
}

function removeState(clave) {
  const meta = readMeta();
  if (!meta.states[clave]) return false;
  delete meta.states[clave];
  fs.rmSync(path.join(DIR, `${String(clave).padStart(2, '0')}.json`), { force: true });
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  return true;
}

module.exports = { importXlsx, summary, sectionsOf, crossCheck, removeState, PadronError };
