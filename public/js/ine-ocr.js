// Lectura (OCR) del frente de la INE en el propio dispositivo con Tesseract.js.
// La imagen no se envía a ningún servicio externo para leerla. El resultado es una
// propuesta: el promotor siempre la revisa antes de guardar.

let workerPromise = null;

function cargarTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/tesseract/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('No se pudo cargar el lector de texto.'));
    document.head.append(s);
  });
}

let reportar = () => {};
function worker() {
  workerPromise ||= cargarTesseract()
    .then((T) =>
      T.createWorker('spa', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract-core',
        langPath: '/vendor/tessdata',
        logger: (m) => reportar(m),
      })
    )
    .catch((err) => {
      workerPromise = null;
      throw err;
    });
  return workerPromise;
}

// Escala de grises con más contraste: ayuda al OCR con el fondo de seguridad de la credencial
function preparar(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1800 / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const v = Math.max(0, Math.min(255, (y - 128) * 1.6 + 128));
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      g.putImageData(d, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// Interpretación del texto
// ---------------------------------------------------------------------------
const A_LETRA = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 8: 'B' };
const A_DIGITO = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
// Corrige confusiones típicas del OCR según lo que debe ir en cada posición (L = letra, D = dígito)
function corregir(token, patron) {
  if (token.length !== patron.length) return token;
  return [...token]
    .map((ch, i) => {
      if (patron[i] === 'L' && /\d/.test(ch)) return A_LETRA[ch] || ch;
      if (patron[i] === 'D' && /[A-Z]/.test(ch)) return A_DIGITO[ch] || ch;
      return ch;
    })
    .join('');
}

const CURP_RE =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;
const CLAVE_RE = /^[A-Z]{6}\d{8}[HMX]\d{3}$/;
// CURP: 4 letras, 6 dígitos (fecha), 6 letras (sexo, estado, consonantes), homoclave y dígito
const PATRON_CURP = 'LLLLDDDDDDLLLLLLLD';
const PATRON_CLAVE = 'LLLLLLDDDDDDDDLDDD';

// Busca un identificador de 18 caracteres en el texto, tolerando espacios intermedios
function buscarId(texto, patron, re) {
  const plano = texto.replace(/[^A-Z0-9Ñ\n]/g, ' ');
  const tokens = new Set();
  for (const linea of plano.split('\n')) {
    const palabras = linea.split(/\s+/).filter(Boolean);
    for (let i = 0; i < palabras.length; i++) {
      let t = '';
      for (let j = i; j < palabras.length && t.length < 18; j++) {
        t += palabras[j];
        if (t.length === 18) tokens.add(t);
      }
      if (palabras[i].length > 18) for (let k = 0; k + 18 <= palabras[i].length; k++) tokens.add(palabras[i].slice(k, k + 18));
    }
  }
  for (const t of tokens) {
    if (re.test(t)) return t;
    const c = corregir(t, patron);
    if (re.test(c)) return c;
    // CURP: la penúltima posición puede ser dígito (homoclave numérica)
    if (patron === PATRON_CURP) {
      const c2 = corregir(t, 'LLLLDDDDDDLLLLLL?D'.replace('?', /\d/.test(t[16]) ? 'D' : 'L'));
      if (re.test(c2)) return c2;
    }
  }
  return '';
}

// La CURP y la clave de elector comparten la fecha de nacimiento (AAMMDD): si el OCR confundió
// algún dígito de la CURP (p. ej. 8 → S → 5), se toma la de la clave. La posición 17 es dígito
// para nacidos antes de 2000 y letra desde 2000.
function afinarCurp(curp, clave) {
  if (!curp) return curp;
  let c = curp;
  if (clave && CLAVE_RE.test(clave)) {
    const fijada = c.slice(0, 4) + clave.slice(6, 12) + c.slice(10);
    if (CURP_RE.test(fijada)) c = fijada;
  }
  // Quien vota nació hace al menos 18 años: AA mayor que (año actual − 18) es del siglo pasado
  const antes2000 = Number(c.slice(4, 6)) > (new Date().getFullYear() % 100) - 18;
  const pos = c[16];
  if (antes2000 && A_DIGITO[pos]) {
    const fijada = c.slice(0, 16) + A_DIGITO[pos] + c[17];
    if (CURP_RE.test(fijada)) c = fijada;
  }
  return c;
}

const soloLetras = (s) =>
  s
    .replace(/[^A-ZÑÁÉÍÓÚÜ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function interpretar(textoOriginal) {
  const texto = textoOriginal.toUpperCase().replace(/[|]/g, 'I');
  const lineas = texto
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const idx = (re) => lineas.findIndex((l) => re.test(l));
  const r = {};

  r.claveElector = buscarId(texto.replace(/CLAVE DE ELECTOR/g, ' '), PATRON_CLAVE, CLAVE_RE);
  r.curp = afinarCurp(buscarId(texto, PATRON_CURP, CURP_RE), r.claveElector);

  // Vigencia: «VIGENCIA 2023 - 2033» → 2033
  // (primero el rango; si no, un año 20XX junto a la etiqueta: nunca la sección, que también tiene 4 dígitos)
  const rango = texto.match(/\b((?:19|20)\d{2})\s*[-–—]\s*(20\d{2})\b/);
  const vig = rango ? rango[2] : texto.match(/VIGENCIA[^\d]{0,12}(20\d{2})\b/)?.[1];
  if (vig) r.vigencia = vig;

  // Sección: «SECCIÓN 0420» en el mismo renglón, o el número en el renglón de abajo
  // (junto a la fecha de nacimiento y la vigencia, que se descartan)
  const sec = texto.match(/SECCI[OÓ0]N[ \t:]{0,4}(\d{3,4})\b/);
  if (sec) r.seccion = String(Number(sec[1]));
  else {
    const iSec = idx(/SECCI[OÓ0]N/);
    if (iSec >= 0 && lineas[iSec + 1]) {
      const resto = lineas[iSec + 1].replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ').replace(/\d{4}\s*[-–—]\s*\d{4}/g, ' ');
      const m = resto.match(/\b(\d{3,4})\b/);
      if (m) r.seccion = String(Number(m[1]));
    }
  }

  // Nombre: renglones entre «NOMBRE» y «DOMICILIO» (paterno, materno y nombres)
  const iNom = idx(/\bNOMBRE\b/);
  const iDom = idx(/\bDOMICILIO\b/);
  if (iNom >= 0) {
    const hasta = iDom > iNom ? iDom : Math.min(lineas.length, iNom + 4);
    const partes = lineas
      .slice(iNom, hasta)
      .map((l) => soloLetras(l.replace(/\bNOMBRE\b/, '').replace(/\bSEXO\b.*$/, '').replace(/\bFECHA\b.*$/, '')))
      .filter((l) => l.length >= 2);
    if (partes.length >= 3) [r.paterno, r.materno, r.nombres] = [partes[0], partes[1], partes.slice(2).join(' ')];
    else if (partes.length === 2) [r.paterno, r.nombres] = partes;
  }

  // Domicilio: renglones entre «DOMICILIO» y «CLAVE DE ELECTOR»
  if (iDom >= 0) {
    const iClave = idx(/CLAVE DE ELECTOR|CLAVE ELECTOR/);
    const dom = lineas.slice(iDom, iClave > iDom ? iClave : iDom + 4).map((l) => l.replace(/\bDOMICILIO\b/, '').trim()).filter(Boolean);
    const calle = dom[0] || '';
    const m = calle.match(/^(.*?)\s+(S\/N|SN|\d+[A-Z]?)(?:\s+(?:INT\.?|INTERIOR)?\s*([A-Z0-9-]+))?$/);
    if (m) {
      r.calle = m[1].replace(/^C\s+/, '').trim();
      r.numExt = m[2] === 'SN' ? 'S/N' : m[2];
      if (m[3] && m[3] !== m[2]) r.numInt = m[3];
    } else if (calle) r.calle = calle.replace(/^C\s+/, '');
    const conCP = dom.find((l) => /\b\d{5}\b/.test(l));
    if (conCP) {
      r.cp = conCP.match(/\b(\d{5})\b/)[1];
      // La colonia puede llevar números («TABASCO 2000»): solo se quitan el tipo y el CP
      r.colonia = conCP
        .replace(/\b\d{5}\b/, '')
        .replace(/^(COL|FRACC|FRAC|BARRIO|RANCHERIA|RA|POB|EJ)\b\.?/, '')
        .replace(/[^A-ZÑÁÉÍÓÚÜ0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return r;
}

/**
 * Lee el frente de la INE.
 * @param {string} dataUrl  imagen JPEG
 * @param {(p: number, etapa: string) => void} onProgress  avance 0–1
 */
export async function leerINE(dataUrl, onProgress = () => {}) {
  reportar = (m) => {
    if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'Leyendo datos');
    else if (/load|initializ/i.test(m.status)) onProgress(Math.min(0.3, (m.progress || 0) * 0.3), 'Preparando el lector');
  };
  const w = await worker();
  const canvas = await preparar(dataUrl);
  const { data } = await w.recognize(canvas);
  return { campos: interpretar(data.text), texto: data.text };
}

export { interpretar };
