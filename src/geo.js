// Importación de cartografía electoral (Marco Geográfico Electoral del INE) desde .zip con shapefiles.
//
// Flujo: .zip (admite zips anidados y varios estados) → capas conocidas → reproyección a WGS84
// (lon/lat) → GeoJSON por capa + catálogo territorial normalizado, guardados en data/geo/<entidad>/.
const path = require('path');
const AdmZip = require('adm-zip');
const { query, tx } = require('./db');
const shapefile = require('shapefile');
const proj4 = require('proj4');


// Límites de seguridad al descomprimir
const MAX_UNCOMPRESSED = 1.5 * 1024 ** 3;
const MAX_ENTRIES = 5000;
const MAX_ZIP_DEPTH = 3;

const COORD_DECIMALS = 6; // ~0.1 m

// Capas reconocidas (nombre del archivo sin extensión) y cómo normalizar sus atributos
const LAYERS = [
  { file: 'ENTIDAD', key: 'entidad', name: 'Entidad', fields: ['entidad', 'nombre'] },
  { file: 'DISTRITO_FEDERAL', key: 'distrito_federal', name: 'Distritos federales', fields: ['entidad', 'distrito_federal'] },
  { file: 'DISTRITO_LOCAL', key: 'distrito_local', name: 'Distritos locales', fields: ['entidad', 'distrito_local'] },
  { file: 'MUNICIPIO', key: 'municipio', name: 'Municipios', fields: ['entidad', 'municipio', 'nombre'] },
  { file: 'SECCION', key: 'seccion', name: 'Secciones', fields: ['entidad', 'distrito_federal', 'distrito_local', 'municipio', 'seccion', 'tipo'] },
];
const LAYER_BY_FILE = new Map(LAYERS.map((l) => [l.file, l]));
const LAYER_BY_KEY = new Map(LAYERS.map((l) => [l.key, l]));

// Los .dbf truncan los nombres de campo a 10 caracteres
const FIELD_ALIASES = { distrito_f: 'distrito_federal', distrito_l: 'distrito_local' };
const TEXT_FIELDS = new Set(['nombre']);

class ImportError extends Error {}

// ---------------------------------------------------------------------------
// 1. Descompresión
// ---------------------------------------------------------------------------
// Devuelve Map<"carpeta/STEM", { stem, dir, files: { shp, dbf, prj, cpg } }>
function collectShapefiles(buffer, sets = new Map(), depth = 0, budget = { bytes: 0, entries: 0 }) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new ImportError('El archivo no es un .zip válido.');
  }
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    budget.entries += 1;
    budget.bytes += entry.header.size;
    if (budget.entries > MAX_ENTRIES || budget.bytes > MAX_UNCOMPRESSED) {
      throw new ImportError('El .zip es demasiado grande para procesarse.');
    }
    const name = path.posix.basename(entry.entryName.replace(/\\/g, '/'));
    const dir = path.posix.dirname(entry.entryName.replace(/\\/g, '/'));
    const ext = path.posix.extname(name).toLowerCase().slice(1);
    const stem = name.slice(0, -(ext.length + 1)).toUpperCase();

    if (ext === 'zip') {
      if (depth >= MAX_ZIP_DEPTH) continue;
      collectShapefiles(entry.getData(), sets, depth + 1, budget);
    } else if (['shp', 'dbf', 'prj', 'cpg'].includes(ext)) {
      const id = `${depth}:${dir}/${stem}`;
      if (!sets.has(id)) sets.set(id, { stem, dir: `${depth}:${dir}`, files: {} });
      sets.get(id).files[ext] = entry.getData();
    }
  }
  return sets;
}

// Agrupa por carpeta: cada carpeta con capas conocidas es un estado
function groupByFolder(sets) {
  const folders = new Map();
  for (const s of sets.values()) {
    const layer = LAYER_BY_FILE.get(s.stem);
    if (!layer) continue;
    if (!folders.has(s.dir)) folders.set(s.dir, []);
    folders.get(s.dir).push({ layer, files: s.files });
  }
  return [...folders.values()];
}

// ---------------------------------------------------------------------------
// 2. Lectura y reproyección
// ---------------------------------------------------------------------------
function makeProjector(prjBuffer, layerName) {
  if (!prjBuffer) throw new ImportError(`Falta el archivo .prj de la capa ${layerName}; no se puede ubicar el mapa.`);
  const wkt = prjBuffer.toString('utf8').trim();
  if (/^GEOGCS/i.test(wkt)) return { crs: wkt.match(/^GEOGCS\["([^"]+)"/i)?.[1] || 'Geográficas', project: null };
  let converter;
  try {
    converter = proj4(wkt, 'EPSG:4326');
  } catch {
    throw new ImportError(`No se reconoce la proyección de la capa ${layerName}.`);
  }
  return { crs: wkt.match(/^PROJCS\["([^"]+)"/i)?.[1] || 'Proyectada', project: (xy) => converter.forward(xy) };
}

const round = (n) => Math.round(n * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;

function transformCoords(coords, project, bbox) {
  if (typeof coords[0] === 'number') {
    const [lon, lat] = project ? project([coords[0], coords[1]]) : coords;
    if (lon < bbox[0]) bbox[0] = lon;
    if (lat < bbox[1]) bbox[1] = lat;
    if (lon > bbox[2]) bbox[2] = lon;
    if (lat > bbox[3]) bbox[3] = lat;
    return [round(lon), round(lat)];
  }
  return coords.map((c) => transformCoords(c, project, bbox));
}

function normalizeProps(raw, layer) {
  const lower = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase();
    lower[FIELD_ALIASES[key] || key] = v;
  }
  const props = {};
  for (const f of layer.fields) {
    const v = lower[f];
    if (v === undefined || v === null || v === '') continue;
    props[f] = TEXT_FIELDS.has(f) ? String(v).trim() : Number(v);
  }
  return props;
}

async function readLayer({ layer, files }) {
  if (!files.shp || !files.dbf) {
    throw new ImportError(`La capa ${layer.name} está incompleta (se requieren .shp y .dbf).`);
  }
  const { crs, project } = makeProjector(files.prj, layer.name);
  const encoding = files.cpg ? files.cpg.toString('utf8').trim().toLowerCase() || 'utf-8' : 'windows-1252';

  let source;
  try {
    source = await shapefile.open(files.shp, files.dbf, { encoding });
  } catch {
    throw new ImportError(`No se pudo leer la capa ${layer.name}.`);
  }

  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const features = [];
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const f = r.value;
    if (!f.geometry) continue;
    const props = normalizeProps(f.properties, layer);
    features.push({
      type: 'Feature',
      id: props[layer.key] ?? features.length + 1,
      properties: props,
      geometry: { type: f.geometry.type, coordinates: transformCoords(f.geometry.coordinates, project, bbox) },
    });
  }
  if (!features.length) throw new ImportError(`La capa ${layer.name} no contiene geometrías.`);

  // Sanidad: las coordenadas deben caer en territorio mexicano
  if (bbox[0] < -119 || bbox[2] > -85 || bbox[1] < 14 || bbox[3] > 33.5) {
    throw new ImportError(`Las coordenadas de la capa ${layer.name} no corresponden a México; revisa la proyección (.prj).`);
  }

  return { layer, crs, bbox: bbox.map(round), geojson: { type: 'FeatureCollection', features } };
}

// ---------------------------------------------------------------------------
// 3. Catálogo territorial normalizado
// ---------------------------------------------------------------------------
const byNum = (a, b) => a.clave - b.clave;

function buildCatalog(layers) {
  const props = (key) => (layers[key] ? layers[key].geojson.features.map((f) => f.properties) : []);
  const warnings = [];

  const ent = props('entidad')[0] || {};
  const secciones = props('seccion').map((p) => ({
    clave: p.seccion,
    municipio: p.municipio ?? null,
    distritoFederal: p.distrito_federal ?? null,
    distritoLocal: p.distrito_local ?? null,
    tipo: p.tipo ?? null,
  }));

  // Si falta la capa de distritos/municipios, se deducen de las secciones
  const uniq = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined))].map((clave) => ({ clave }));
  const municipios = layers.municipio
    ? props('municipio').map((p) => ({ clave: p.municipio, nombre: p.nombre || null }))
    : uniq(secciones.map((s) => s.municipio));
  const distritosFederales = layers.distrito_federal
    ? props('distrito_federal').map((p) => ({ clave: p.distrito_federal }))
    : uniq(secciones.map((s) => s.distritoFederal));
  const distritosLocales = layers.distrito_local
    ? props('distrito_local').map((p) => ({ clave: p.distrito_local }))
    : uniq(secciones.map((s) => s.distritoLocal));

  // Consistencia: cada sección debe apuntar a municipio y distritos existentes
  const check = (list, field, label) => {
    const known = new Set(list.map((x) => x.clave));
    const orphans = secciones.filter((s) => s[field] !== null && !known.has(s[field]));
    if (orphans.length) warnings.push(`${orphans.length} secciones apuntan a ${label} que no existe en el mapa.`);
  };
  check(municipios, 'municipio', 'un municipio');
  check(distritosFederales, 'distritoFederal', 'un distrito federal');
  check(distritosLocales, 'distritoLocal', 'un distrito local');

  const dupes = secciones.length - new Set(secciones.map((s) => s.clave)).size;
  if (dupes) warnings.push(`${dupes} secciones aparecen repetidas.`);

  return {
    catalog: {
      entidad: { clave: ent.entidad ?? null, nombre: ent.nombre || null },
      distritosFederales: distritosFederales.sort(byNum),
      distritosLocales: distritosLocales.sort(byNum),
      municipios: municipios.sort(byNum),
      secciones: secciones.sort(byNum),
    },
    warnings,
  };
}

// Clave de la entidad: de la capa ENTIDAD o, si no viene, de los atributos de cualquier capa
function detectEntidad(layers) {
  const claves = new Set();
  for (const l of Object.values(layers)) for (const f of l.geojson.features) if (f.properties.entidad) claves.add(f.properties.entidad);
  if (claves.size === 0) throw new ImportError('No se encontró la clave de entidad en los atributos.');
  if (claves.size > 1) throw new ImportError('Las capas de una misma carpeta mezclan varias entidades.');
  const clave = [...claves][0];
  if (!Number.isInteger(clave) || clave < 1 || clave > 32) throw new ImportError(`Clave de entidad inválida: ${clave}.`);
  return clave;
}

// ---------------------------------------------------------------------------
// 4. Guardado en PostgreSQL (reemplaza por completo la carga anterior de la entidad)
//    Metadatos y catálogo se mantienen en memoria; las capas se leen de la base al pedirse.
// ---------------------------------------------------------------------------
const states = new Map(); // clave → { meta, catalog }

async function persistAll(results) {
  await tx(async (c) => {
    for (const { clave, layers, meta, catalog } of results) {
      await c.query('DELETE FROM geo_states WHERE clave = $1', [clave]);
      await c.query('INSERT INTO geo_states (clave, meta, catalog) VALUES ($1, $2, $3)', [clave, meta, catalog]);
      for (const l of Object.values(layers)) {
        await c.query('INSERT INTO geo_layers (clave, layer, geojson) VALUES ($1, $2, $3)', [clave, l.layer.key, JSON.stringify(l.geojson)]);
      }
    }
  });
  for (const { clave, meta, catalog } of results) {
    states.set(clave, { meta, catalog });
    for (const k of [...layerCache.keys()]) if (k.startsWith(`${clave}:`)) layerCache.delete(k);
    seccionIdx.delete(clave);
  }
}

// Capas recientes en memoria (las de sección pesan varios MB)
const layerCache = new Map();
const LAYER_CACHE_MAX = 12;

async function init() {
  const { rows } = await query('SELECT clave, meta, catalog FROM geo_states');
  states.clear();
  for (const r of rows) states.set(r.clave, { meta: r.meta, catalog: r.catalog });
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
async function importZip(buffer, { fileName, importedBy }) {
  const groups = groupByFolder(collectShapefiles(buffer));
  if (!groups.length) {
    throw new ImportError(`No se encontraron capas reconocidas. Se esperan: ${LAYERS.map((l) => `${l.file}.shp`).join(', ')}.`);
  }

  const results = [];
  for (const group of groups) {
    const layers = {};
    for (const item of group) {
      const read = await readLayer(item);
      layers[read.layer.key] = read;
    }
    if (!layers.seccion) throw new ImportError('Falta la capa SECCION, indispensable para la estructura.');

    const clave = detectEntidad(layers);
    const { catalog, warnings } = buildCatalog(layers);
    catalog.entidad.clave = clave;

    const bbox = Object.values(layers).reduce(
      (b, l) => [Math.min(b[0], l.bbox[0]), Math.min(b[1], l.bbox[1]), Math.max(b[2], l.bbox[2]), Math.max(b[3], l.bbox[3])],
      [Infinity, Infinity, -Infinity, -Infinity]
    );

    const meta = {
      clave,
      nombre: catalog.entidad.nombre || `Entidad ${clave}`,
      fileName,
      importedAt: new Date().toISOString(),
      importedBy,
      crs: layers.seccion.crs,
      bbox,
      layers: Object.fromEntries(
        LAYERS.filter((l) => layers[l.key]).map((l) => [l.key, { name: l.name, features: layers[l.key].geojson.features.length }])
      ),
      counts: {
        distritosFederales: catalog.distritosFederales.length,
        distritosLocales: catalog.distritosLocales.length,
        municipios: catalog.municipios.length,
        secciones: catalog.secciones.length,
      },
      warnings,
    };
    results.push({ clave, layers, meta, catalog });
  }

  // Se guarda solo si todas las entidades del archivo se procesaron sin errores
  await persistAll(results);
  return results.map((r) => r.meta);
}

function listStates() {
  return [...states.values()].map((x) => x.meta).sort((a, b) => a.clave - b.clave);
}

const toClave = (c) => (/^\d{1,2}$/.test(String(c)) ? Number(c) : null);

function getState(clave) {
  const st = states.get(toClave(clave));
  return st ? { meta: st.meta, catalog: st.catalog } : null;
}

// GeoJSON (texto) de una capa; null si no existe
async function layerText(clave, layerKey) {
  const c = toClave(clave);
  if (c === null || !states.has(c) || !LAYER_BY_KEY.has(layerKey)) return null;
  const k = `${c}:${layerKey}`;
  if (layerCache.has(k)) {
    const v = layerCache.get(k);
    layerCache.delete(k);
    layerCache.set(k, v);
    return v;
  }
  const { rows } = await query('SELECT geojson FROM geo_layers WHERE clave = $1 AND layer = $2', [c, layerKey]);
  if (!rows.length) return null;
  layerCache.set(k, rows[0].geojson);
  if (layerCache.size > LAYER_CACHE_MAX) layerCache.delete(layerCache.keys().next().value);
  return rows[0].geojson;
}

// GeoJSON ya interpretado (para cálculos en el servidor)
async function layer(clave, layerKey) {
  const t = await layerText(clave, layerKey);
  return t ? JSON.parse(t) : null;
}

// Contorno de una sola sección (para que el celular no descargue la capa completa de la entidad).
// El índice sección → geometría se arma una vez por entidad.
const seccionIdx = new Map();
async function seccionFeature(clave, seccion) {
  const c = toClave(clave);
  if (c === null || !states.has(c)) return null;
  if (!seccionIdx.has(c)) {
    const idx = new Map();
    for (const f of (await layer(c, 'seccion'))?.features || []) idx.set(Number(f.properties?.seccion), f);
    seccionIdx.set(c, idx);
  }
  return seccionIdx.get(c).get(Number(seccion)) || null;
}

async function removeState(clave) {
  const c = toClave(clave);
  if (c === null || !states.has(c)) return false;
  await query('DELETE FROM geo_states WHERE clave = $1', [c]);
  states.delete(c);
  for (const k of [...layerCache.keys()]) if (k.startsWith(`${c}:`)) layerCache.delete(k);
  seccionIdx.delete(c);
  return true;
}

module.exports = { init, importZip, persistAll, listStates, getState, layerText, layer, seccionFeature, removeState, ImportError, LAYERS };
