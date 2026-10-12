// Recorte automático de la INE: localiza la credencial en la foto y la endereza para guardar
// solo la credencial, con el menor fondo posible. Todo ocurre en el dispositivo.
//
// Método (ligero, sin librerías): en una copia reducida se estima el color del fondo con los
// bordes de la foto, se marca lo que difiere de él, se toma la mancha más grande (la credencial),
// sus cuatro esquinas por puntos extremos y se corrige la perspectiva. Si la detección no es
// confiable (fondo muy parecido a la credencial, credencial cortada, etc.) se conserva la foto.

const PROPORCION = 85.6 / 54; // tarjeta ID-1
const ANCHO_SALIDA = 1400;
const MAX_BASE = 2000;
const ANCHO_DETECCION = 320;

function cargarImagen(fuente) {
  return new Promise((resolve, reject) => {
    const url = typeof fuente === 'string' ? fuente : URL.createObjectURL(fuente);
    const img = new Image();
    img.onload = () => {
      if (typeof fuente !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof fuente !== 'string') URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

function lienzo(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------------------------------------------------------------------------
// Detección de las esquinas
// ---------------------------------------------------------------------------
function percentil(arr, p) {
  const a = Float32Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

function morfologia(mask, W, H, dilatar) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = dilatar ? 0 : 1;
      for (let dy = -1; dy <= 1 && v === (dilatar ? 0 : 1); dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const m = mask[yy * W + xx];
          if (dilatar && m) {
            v = 1;
            break;
          }
          if (!dilatar && !m) {
            v = 0;
            break;
          }
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

const areaPoligono = (p) => Math.abs(p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a.x * b.y - b.x * a.y;
}, 0)) / 2;

function detectarEsquinas(base) {
  const k = ANCHO_DETECCION / base.width;
  const W = ANCHO_DETECCION;
  const H = Math.max(8, Math.round(base.height * k));
  const c = lienzo(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(base, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;

  // Color del fondo: mediana de una franja en los bordes
  const borde = Math.max(2, Math.round(W * 0.02));
  const rs = [];
  const gs = [];
  const bs = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= borde && x < W - borde && y >= borde && y < H - borde) continue;
      const i = (y * W + x) * 4;
      rs.push(px[i]);
      gs.push(px[i + 1]);
      bs.push(px[i + 2]);
    }
  }
  const fondo = [percentil(rs, 0.5), percentil(gs, 0.5), percentil(bs, 0.5)];
  const dist = (i) => Math.abs(px[i] - fondo[0]) + Math.abs(px[i + 1] - fondo[1]) + Math.abs(px[i + 2] - fondo[2]);

  // Umbral: por encima de casi toda la variación propia del fondo
  const dBorde = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= borde && x < W - borde && y >= borde && y < H - borde) continue;
      dBorde.push(dist((y * W + x) * 4));
    }
  }
  const umbral = Math.max(42, percentil(dBorde, 0.92) + 18);

  let mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = dist(i * 4) > umbral ? 1 : 0;
  // Cierre: une el texto y el fondo de seguridad de la credencial en una sola mancha
  for (let n = 0; n < 2; n++) mask = morfologia(mask, W, H, true);
  for (let n = 0; n < 2; n++) mask = morfologia(mask, W, H, false);

  // Mancha más grande con sus puntos extremos
  const visto = new Uint8Array(W * H);
  const cola = new Int32Array(W * H);
  let mejor = null;
  for (let inicio = 0; inicio < W * H; inicio++) {
    if (!mask[inicio] || visto[inicio]) continue;
    let ini = 0;
    let fin = 0;
    cola[fin++] = inicio;
    visto[inicio] = 1;
    const m = { n: 0, minS: Infinity, maxS: -Infinity, minD: Infinity, maxD: -Infinity, tl: 0, br: 0, tr: 0, bl: 0, toca: 0 };
    while (ini < fin) {
      const p = cola[ini++];
      const x = p % W;
      const y = (p - x) / W;
      m.n++;
      const s = x + y;
      const d = x - y;
      if (s < m.minS) [m.minS, m.tl] = [s, p];
      if (s > m.maxS) [m.maxS, m.br] = [s, p];
      if (d > m.maxD) [m.maxD, m.tr] = [d, p];
      if (d < m.minD) [m.minD, m.bl] = [d, p];
      if (x === 0) m.toca |= 1;
      if (x === W - 1) m.toca |= 2;
      if (y === 0) m.toca |= 4;
      if (y === H - 1) m.toca |= 8;
      if (x > 0 && mask[p - 1] && !visto[p - 1]) (visto[p - 1] = 1), (cola[fin++] = p - 1);
      if (x < W - 1 && mask[p + 1] && !visto[p + 1]) (visto[p + 1] = 1), (cola[fin++] = p + 1);
      if (y > 0 && mask[p - W] && !visto[p - W]) (visto[p - W] = 1), (cola[fin++] = p - W);
      if (y < H - 1 && mask[p + W] && !visto[p + W]) (visto[p + W] = 1), (cola[fin++] = p + W);
    }
    if (!mejor || m.n > mejor.n) mejor = m;
  }
  if (!mejor) return null;

  // Validaciones: tamaño razonable, no ocupa toda la foto, forma de credencial
  if (mejor.n < 0.08 * W * H) return null;
  if (mejor.toca === 15) return null; // la mancha llega a los 4 bordes: no se distingue del fondo
  const pt = (p) => ({ x: p % W, y: (p - (p % W)) / W });
  let q = [pt(mejor.tl), pt(mejor.tr), pt(mejor.br), pt(mejor.bl)];
  const area = areaPoligono(q);
  if (area < 0.08 * W * H || area > 0.97 * W * H) return null;
  if (mejor.n / area < 0.75 || mejor.n / area > 1.25) return null; // la mancha no es un cuadrilátero
  const lado = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const ancho = (lado(q[0], q[1]) + lado(q[3], q[2])) / 2;
  const alto = (lado(q[0], q[3]) + lado(q[1], q[2])) / 2;
  // Credencial vertical: se gira para que quede horizontal
  if (alto > ancho) q = [q[3], q[0], q[1], q[2]];
  const prop = Math.max(ancho, alto) / Math.min(ancho, alto);
  if (prop < 1.25 || prop > 2.1) return null;
  return q.map((p) => ({ x: (p.x + 0.5) / k, y: (p.y + 0.5) / k }));
}

// ---------------------------------------------------------------------------
// Corrección de perspectiva (homografía de 4 puntos)
// ---------------------------------------------------------------------------
function resolver(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[max][i])) max = r;
    [A[i], A[max]] = [A[max], A[i]];
    [b[i], b[max]] = [b[max], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

// Homografía destino (u, v) → origen (x, y)
function homografia(dest, orig) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dest[i];
    const { x, y } = orig[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  return resolver(A, b);
}

function enderezar(base, q) {
  const W = ANCHO_SALIDA;
  const H = Math.round(W / PROPORCION);
  const h = homografia(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    q
  );
  const sw = base.width;
  const sh = base.height;
  const src = base.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const out = lienzo(W, H);
  const og = out.getContext('2d');
  const img = og.createImageData(W, H);
  const d = img.data;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const z = h[6] * u + h[7] * v + 1;
      let x = (h[0] * u + h[1] * v + h[2]) / z;
      let y = (h[3] * u + h[4] * v + h[5]) / z;
      x = Math.min(sw - 1.001, Math.max(0, x));
      y = Math.min(sh - 1.001, Math.max(0, y));
      const x0 = x | 0;
      const y0 = y | 0;
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (v * W + u) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const a = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * fx;
        const c = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * fx;
        d[o + ch] = a + (c - a) * fy;
      }
      d[o + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

/**
 * Prepara la foto de la INE para guardarla: la recorta y endereza si se detecta la credencial;
 * si no, solo la reduce.
 * @param {File|Blob|string} fuente  archivo o dataURL
 * @returns {Promise<{ dataUrl: string, recortada: boolean }>}
 */
export async function prepararINE(fuente) {
  const img = await cargarImagen(fuente);
  const k = Math.min(1, MAX_BASE / Math.max(img.naturalWidth, img.naturalHeight));
  const base = lienzo(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
  base.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, base.width, base.height);

  let esquinas = null;
  try {
    esquinas = detectarEsquinas(base);
  } catch {
    esquinas = null;
  }
  if (esquinas) return { dataUrl: enderezar(base, esquinas).toDataURL('image/jpeg', 0.85), recortada: true };

  // Sin detección confiable: se guarda la foto reducida
  const k2 = Math.min(1, 1600 / Math.max(base.width, base.height));
  const out = lienzo(Math.round(base.width * k2), Math.round(base.height * k2));
  out.getContext('2d').drawImage(base, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL('image/jpeg', 0.85), recortada: false };
}
