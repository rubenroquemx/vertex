// Lectura de la INE con Tesseract en nuestro servidor (prototipo). Las fotos se leen en memoria y no se
// guardan; el resultado solo prellena el formulario y el promotor lo revisa.
//  - Reverso: la zona de lectura mecánica (3 líneas que empiezan con IDMEX) trae apellidos, nombre(s),
//    fecha de nacimiento y vigencia, con dígitos verificadores que confirman la lectura.
//  - Frente: clave de elector, CURP, sección, vigencia y domicilio, leídos por sus etiquetas.
// La imagen llega ya recortada a la credencial por la guía de la cámara (1100 px de ancho).
const sharp = require('sharp');
const { createWorker, PSM } = require('tesseract.js');
const ENG = require('@tesseract.js-data/eng');
const SPA = require('@tesseract.js-data/spa');

const LIMITE = { limitInputPixels: 60_000_000 };
// Lecturas esperando a la vez (todas las cuentas): más allá, se pide intentar en un momento
const MAX_EN_COLA = 12;
let enCola = 0;
const CLAVE_RE = /^[A-Z]{6}\d{8}[HM]\d{3}$/;
const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z\d]\d$/;

// --- Trabajadores de Tesseract: uno por idioma, se crean al primer uso y se cierran sin actividad
const INACTIVO_MS = 10 * 60 * 1000;
const trabajadores = new Map();
function trabajador(clave, crear) {
  let t = trabajadores.get(clave);
  if (!t) {
    t = { listo: crear(), cola: Promise.resolve(), timer: null };
    trabajadores.set(clave, t);
  }
  clearTimeout(t.timer);
  t.timer = setTimeout(async () => {
    trabajadores.delete(clave);
    (await t.listo.catch(() => null))?.terminate().catch(() => {});
  }, INACTIVO_MS);
  t.timer.unref?.();
  return t;
}
// Una lectura a la vez por trabajador (Tesseract no es concurrente)
function leer(clave, crear, imagen, params) {
  const t = trabajador(clave, crear);
  const tarea = t.cola.then(async () => {
    const w = await t.listo;
    await w.setParameters(params);
    const { data } = await w.recognize(imagen);
    return data.text || '';
  });
  t.cola = tarea.catch(() => {});
  return tarea;
}
const crearIngles = () => createWorker(ENG.code, 1, { langPath: ENG.langPath, gzip: ENG.gzip, cacheMethod: 'none' });
const crearEspanol = () => createWorker(SPA.code, 1, { langPath: SPA.langPath, gzip: SPA.gzip, cacheMethod: 'none' });

// --- Correcciones de lectura: letras que parecen números y al revés
const A_DIGITO = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', B: '8', G: '6' };
const A_LETRA = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 8: 'B', 6: 'G', 4: 'A' };
const digitos = (s) => [...s].map((c) => A_DIGITO[c] || c).join('');
const letras = (s) => [...s].map((c) => A_LETRA[c] || c).join('');
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Dígito verificador de la zona de lectura mecánica (ICAO 9303: pesos 7, 3, 1)
function verificador(s) {
  const valor = (c) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
  return String([...s].reduce((t, c, i) => t + valor(c) * [7, 3, 1][i % 3], 0) % 10);
}

// ===========================================================================
// Reverso: zona de lectura mecánica
// ===========================================================================
const UMBRAL_ZONA = Number(process.env.INE_UMBRAL || 140);
async function prepararReverso(buf) {
  // La zona de lectura mecánica ocupa el tercio inferior del reverso
  const { width, height } = await sharp(buf, LIMITE).rotate().metadata();
  const top = Math.round(height * 0.55);
  return sharp(buf, LIMITE)
    .rotate()
    .extract({ left: 0, top, width, height: height - top })
    .resize({ width: 2000 })
    .grayscale()
    .normalize()
    .threshold(UMBRAL_ZONA)
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
}

function parsearZona(texto) {
  // Líneas candidatas: sin espacios, con relleno «<»; los «<» a veces se leen como K o C al final
  const lineas = texto
    .toUpperCase()
    .split('\n')
    .map((l) => l.replace(/[^A-Z0-9<]/g, ''))
    .filter((l) => l.length >= 20);
  const i1 = lineas.findIndex((l) => /^[I1][DO0]MEX/.test(l));
  const l1 = i1 >= 0 ? lineas[i1] : null;
  const resto = i1 >= 0 ? lineas.slice(i1 + 1) : lineas;
  const l2 = resto.find((l) => /MEX/.test(l) && /\d{6}/.test(digitos(l.slice(0, 7))));
  const l3 = resto.slice(resto.indexOf(l2) + 1).find((l) => /<</.test(l) && /[A-Z]{2}/.test(l));
  const out = { campos: {}, verificado: {} };

  // Línea 2: nacimiento (AAMMDD + verificador), sexo, vigencia (AAMMDD + verificador), MEX
  if (l2) {
    const m = /^(.{6})(.)(.)(.{6})(.)MEX/.exec(l2);
    if (m) {
      const nac = digitos(m[1]);
      const vig = digitos(m[4]);
      const okNac = /^\d{6}$/.test(nac) && verificador(nac) === digitos(m[2]);
      const okVig = /^\d{6}$/.test(vig) && verificador(vig) === digitos(m[5]);
      if (/^\d{6}$/.test(vig)) {
        out.campos.vigencia = `20${vig.slice(0, 2)}`;
        out.verificado.vigencia = okVig;
      }
      if (/^\d{6}$/.test(nac)) {
        const yy = Number(nac.slice(0, 2));
        const siglo = yy > Number(String(new Date().getFullYear()).slice(2)) ? 19 : 20;
        out.campos.nacimiento = `${siglo}${nac.slice(0, 2)}-${nac.slice(2, 4)}-${nac.slice(4, 6)}`;
        out.verificado.nacimiento = okNac;
      }
    }
  }
  // Línea 3: PATERNO<MATERNO<<NOMBRE<SEGUNDO<<<
  if (l3) {
    // El relleno final («<<<<») suele leerse como K o L: los nombres terminan en el segundo «<<»
    const [ap, nom = ''] = l3.split('<<');
    const apellidos = ap.split('<').filter(Boolean).map(letras);
    const nombres = nom.split('<').filter(Boolean).map(letras).join(' ');
    if (apellidos[0]) out.campos.paterno = apellidos[0];
    if (apellidos.length > 1) out.campos.materno = apellidos.slice(1).join(' ');
    if (nombres) out.campos.nombres = nombres;
  }
  // Línea 1: IDMEX + CIC (9 dígitos + verificador) << número OCR (13 dígitos)
  if (l1) {
    const m = /^.{5}(.{9})(.)<<(.{13})/.exec(l1);
    if (m) {
      const cic = digitos(m[1]);
      if (/^\d{9}$/.test(cic)) out.campos.cic = cic;
      const ocr = digitos(m[3]);
      if (/^\d{13}$/.test(ocr)) out.campos.ocr = ocr;
    }
  }
  return out;
}

async function leerReverso(buf) {
  const img = await prepararReverso(buf);
  const texto = await leer('eng', crearIngles, img, {
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    user_defined_dpi: '300',
  });
  return parsearZona(texto);
}

// ===========================================================================
// Frente: por etiquetas (NOMBRE, DOMICILIO, CLAVE DE ELECTOR, CURP, SECCIÓN, VIGENCIA)
// ===========================================================================
async function prepararFrente(buf) {
  // A la izquierda está la fotografía: se lee desde poco antes de la columna de datos
  const { width, height } = await sharp(buf, LIMITE).rotate().metadata();
  const left = Math.round(width * 0.27);
  return sharp(buf, LIMITE)
    .rotate()
    .extract({ left, top: Math.round(height * 0.18), width: width - left, height: Math.round(height * 0.8) })
    .resize({ width: 2000 })
    .grayscale()
    .normalize()
    .sharpen()
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
}

// Busca un dato de 18 caracteres con forma fija, corrigiendo letras y números según su posición
function buscarClave(compacto, forma, re) {
  for (let i = 0; i + 18 <= compacto.length; i++) {
    const v = [...compacto.slice(i, i + 18)].map((c, k) => (forma[k] === 'L' ? letras(c) : forma[k] === 'D' ? digitos(c) : c)).join('');
    if (re.test(v)) return v;
  }
  return null;
}
// Clave de elector: 6 letras, 8 números, H/M y 3 números · CURP: 4 letras, 6 números, H/M, 5 letras, 1 y 1 número
const FORMA_CLAVE = 'LLLLLLDDDDDDDD-DDD';
const FORMA_CURP = 'LLLLDDDDDD-LLLLL-D';

function parsearFrente(texto) {
  const t = sinAcentos(texto.toUpperCase());
  const lineas = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { campos: {}, verificado: {} };

  const compacto = t.replace(/[^A-Z0-9]/g, '');
  const tras = (etq) => {
    const i = compacto.indexOf(etq);
    return i >= 0 ? compacto.slice(i + etq.length) : compacto;
  };
  const clave = buscarClave(tras('ELECTOR'), FORMA_CLAVE, CLAVE_RE);
  if (clave) out.campos.claveElector = clave;
  let curp = buscarClave(tras('CURP'), FORMA_CURP, CURP_RE);
  if (curp) {
    // Penúltimo carácter: número para nacidos en el siglo XX, letra desde el 2000
    const yy = Number(curp.slice(4, 6));
    const siglo20 = yy > Number(String(new Date().getFullYear()).slice(2));
    curp = curp.slice(0, 16) + (siglo20 ? digitos(curp[16]) : letras(curp[16])) + curp[17];
    if (CURP_RE.test(curp)) out.campos.curp = curp;
  }

  const sec = /SECCI[O0]N\s*([0-9OISZB]{4})/.exec(t);
  if (sec) out.campos.seccion = digitos(sec[1]);
  const vig = /VIGENCIA\s*([0-9OISZ]{4})\s*[-–—~]?\s*([0-9OISZ]{4})/.exec(t) || /\b(20\d\d)\s*[-–—]\s*(20\d\d)\b/.exec(t);
  if (vig) out.campos.vigencia = digitos(vig[2]);

  // Bloques entre etiquetas: NOMBRE … DOMICILIO … CLAVE
  const idx = (re) => lineas.findIndex((l) => re.test(l));
  const iNom = idx(/^NOMBRE/);
  const iDom = idx(/^DOMICILIO/);
  const iClave = idx(/CLAVE\s*DE\s*ELECTOR|^CLAVE/);
  const soloLetras = (l) => l.replace(/[^A-Z\s]/g, '').replace(/\s+/g, ' ').trim();
  if (iNom >= 0 && iDom > iNom) {
    const ns = lineas.slice(iNom + 1, iDom).map(soloLetras).filter((l) => l.length >= 2);
    if (ns[0]) out.campos.paterno = ns[0];
    if (ns.length >= 3) out.campos.materno = ns[1];
    if (ns.length >= 2) out.campos.nombres = ns.slice(ns.length >= 3 ? 2 : 1).join(' ');
  }
  if (iDom >= 0) {
    const fin = iClave > iDom ? iClave : Math.min(lineas.length, iDom + 4);
    const dom = lineas.slice(iDom + 1, fin);
    if (dom[0]) {
      // «C JUAREZ 123 INT 4» → calle, número exterior e interior
      const l = dom[0].replace(/^C\.?\s+/, '').replace(/\s+/g, ' ');
      const mInt = /\s+INT\.?\s*([A-Z0-9-]+)$/.exec(l);
      const base = mInt ? l.slice(0, mInt.index) : l;
      const mNum = /\s+((?:S\/?N)|\d+[A-Z]?)$/.exec(base);
      out.campos.calle = (mNum ? base.slice(0, mNum.index) : base).trim();
      if (mNum) out.campos.numExt = mNum[1].replace('SN', 'S/N');
      if (mInt) out.campos.numInt = mInt[1];
    }
    const cp = /\b(\d{5})\b/.exec(dom.slice(1).join(' ')) || /\b(\d{5})\b/.exec(dom.join(' '));
    if (cp) out.campos.cp = cp[1];
  }
  return out;
}

async function leerFrente(buf) {
  const img = await prepararFrente(buf);
  const texto = await leer('spa', crearEspanol, img, { tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: '', user_defined_dpi: '300' });
  return parsearFrente(texto);
}

// ===========================================================================
// API del módulo
// ===========================================================================
function imagenDe(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  return buf.length > 1000 && buf.length < 8 * 1024 * 1024 ? buf : null;
}

// lado: 'frente' | 'reverso'. Devuelve solo los datos que se pudieron leer.
async function leerIne(lado, dataUrl) {
  const buf = imagenDe(dataUrl);
  if (!buf) return { campos: {}, verificado: {}, error: 'La imagen no es válida.' };
  if (enCola >= MAX_EN_COLA) return { campos: {}, verificado: {}, error: 'El lector está ocupado; captura los datos a mano.', ocupado: true };
  enCola += 1;
  try {
    const r = lado === 'reverso' ? await leerReverso(buf) : await leerFrente(buf);
    return { lado, ...r };
  } finally {
    enCola -= 1;
  }
}

module.exports = { leerIne, parsearZona, parsearFrente, verificador };
