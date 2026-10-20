// Guía para encuadrar la INE, dentro del formulario (sin ventanas emergentes).
// Lo que queda dentro del marco es exactamente lo que se guarda:
//  - abrirCamara: cámara en vivo con el marco encima; se captura lo que está dentro.
//  - ajustarEnGuia: una foto ya tomada o cargada se coloca bajo el mismo marco; se arrastra
//    y se acerca (dos dedos o el control) hasta encuadrar la credencial.
// El navegador solo permite la cámara en vivo con HTTPS o en la misma computadora (localhost).
import { ICONS } from './lib.js';

// Proporción de la credencial (tarjeta ID-1: 85.6 × 54 mm) y tamaño con que se guarda
const PROPORCION = 85.6 / 54;
const ANCHO_SALIDA = 1100;
const ALTO_SALIDA = Math.round(ANCHO_SALIDA / PROPORCION);

export const camaraDisponible = () => Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);

const visor = (titulo, indicacion, medio, extra, boton) => `
  <div class="ine-cam__head">
    <strong>${titulo}</strong>
    <span>${indicacion}</span>
  </div>
  <div class="ine-cam__view">
    ${medio}
    <div class="ine-cam__frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  </div>
  ${extra}
  <div class="ine-cam__actions">
    <button type="button" class="btn btn--secondary" data-cam="cerrar">Cancelar</button>
    ${boton}
  </div>`;

// Rectángulo del marco relativo a `ref` (se toma del diseño real, no de supuestos)
function rectMarco(contenedor, ref) {
  const f = contenedor.querySelector('.ine-cam__frame').getBoundingClientRect();
  const r = ref.getBoundingClientRect();
  return { x: f.left - r.left, y: f.top - r.top, w: f.width, h: f.height };
}

function recortar(fuente, sx, sy, sw, sh) {
  const c = document.createElement('canvas');
  c.width = ANCHO_SALIDA;
  c.height = ALTO_SALIDA;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(fuente, sx, sy, sw, sh, 0, 0, c.width, c.height);
  // WebP con la calidad con que el servidor guarda la INE, así no tiene que volver a comprimirla.
  // Los navegadores que no generan WebP devuelven PNG: en ese caso va JPEG
  const webp = c.toDataURL('image/webp', 0.75);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.8);
}

/**
 * Cámara en vivo con el marco de la INE.
 * @returns {Promise<() => void>} función para cerrar la cámara
 */
export async function abrirCamara(contenedor, { titulo, onCaptura, onCerrar }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
    audio: false,
  });
  contenedor.innerHTML = visor(
    titulo,
    'Coloca la credencial justo dentro del marco, con buena luz y sin reflejos.',
    '<video playsinline muted autoplay></video>',
    '',
    `<button type="button" class="btn" data-cam="capturar">${ICONS.camera}<span>Capturar</span></button>`
  );
  contenedor.hidden = false;
  const video = contenedor.querySelector('video');
  video.srcObject = stream;
  await video.play().catch(() => {});

  const cerrar = () => {
    stream.getTracks().forEach((t) => t.stop());
    contenedor.hidden = true;
    contenedor.innerHTML = '';
    contenedor.onclick = null;
  };

  // El video se muestra con object-fit: cover; se convierte el marco a coordenadas del video
  const capturar = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const box = video.getBoundingClientRect();
    if (!vw || !vh || !box.width) return null;
    const escala = Math.max(box.width / vw, box.height / vh);
    const offX = (vw * escala - box.width) / 2;
    const offY = (vh * escala - box.height) / 2;
    const m = rectMarco(contenedor, video);
    return recortar(video, (m.x + offX) / escala, (m.y + offY) / escala, m.w / escala, m.h / escala);
  };

  contenedor.onclick = (e) => {
    const a = e.target.closest('[data-cam]')?.dataset.cam;
    if (a === 'cerrar') {
      cerrar();
      onCerrar?.();
    }
    if (a === 'capturar') {
      const foto = capturar();
      if (!foto) {
        contenedor.querySelector('.ine-cam__head span').textContent = 'La cámara aún no está lista. Espera un momento y vuelve a capturar.';
        return;
      }
      cerrar();
      onCaptura(foto);
    }
  };
  contenedor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return cerrar;
}

// Flechas circulares para girar la foto
const giro = (izq) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    izq ? '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>' : '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'
  }</svg>`;

// La foto se lleva a un lienzo de tamaño moderado (suficiente para guardar 1100 px de ancho)
// sobre el que se gira y se ajusta
const MAX_LADO = 3000;
function aLienzo(img) {
  const k = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function girar(origen, izq) {
  const c = document.createElement('canvas');
  c.width = origen.height;
  c.height = origen.width;
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2);
  g.rotate(((izq ? -1 : 1) * Math.PI) / 2);
  g.drawImage(origen, -origen.width / 2, -origen.height / 2);
  return c;
}

function cargarImagen(fuente) {
  return new Promise((resolve, reject) => {
    const url = typeof fuente === 'string' ? fuente : URL.createObjectURL(fuente);
    const img = new Image();
    img.onload = () => resolve({ img, liberar: () => typeof fuente !== 'string' && URL.revokeObjectURL(url) });
    img.onerror = () => {
      if (typeof fuente !== 'string') URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

/**
 * Coloca una foto (archivo o dataURL) bajo el marco de la INE para encuadrarla:
 * se arrastra con el dedo o el mouse y se acerca con dos dedos, la rueda o el control.
 * @returns {Promise<() => void>} función para cerrar el ajuste
 */
export async function ajustarEnGuia(contenedor, { titulo, fuente, onListo, onCerrar }) {
  const cargada = await cargarImagen(fuente);
  let img = aLienzo(cargada.img);
  cargada.liberar();
  contenedor.innerHTML = visor(
    titulo,
    'Mueve y acerca la foto hasta que la credencial llene el marco.',
    '<div class="ine-ajuste" data-ajuste></div>',
    `<div class="ine-ajuste__ctrl">
      <button type="button" class="icon-btn icon-btn--always ine-girar" data-cam="izq" title="Girar a la izquierda" aria-label="Girar la foto 90° a la izquierda">${giro(true)}</button>
      <button type="button" class="icon-btn icon-btn--always ine-girar" data-cam="der" title="Girar a la derecha" aria-label="Girar la foto 90° a la derecha">${giro(false)}</button>
      <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Acercar la foto">
    </div>`,
    `<button type="button" class="btn" data-cam="usar">Usar foto</button>`
  );
  contenedor.hidden = false;
  const area = contenedor.querySelector('[data-ajuste]');
  const zoom = contenedor.querySelector('.ine-ajuste__ctrl input');
  img.className = 'ine-ajuste__foto';
  area.append(img);

  let iw = img.width;
  let ih = img.height;
  let marco = rectMarco(contenedor, area);
  // Escala mínima: la foto debe cubrir todo el marco
  let base = Math.max(marco.w / iw, marco.h / ih);
  let s = base;
  let tx = marco.x + (marco.w - iw * s) / 2;
  let ty = marco.y + (marco.h - ih * s) / 2;
  // Tras girar, la foto se vuelve a centrar cubriendo el marco
  const reiniciar = () => {
    iw = img.width;
    ih = img.height;
    base = Math.max(marco.w / iw, marco.h / ih);
    s = base;
    tx = marco.x + (marco.w - iw * s) / 2;
    ty = marco.y + (marco.h - ih * s) / 2;
  };

  const limitar = () => {
    s = Math.min(base * 4, Math.max(base, s));
    tx = Math.min(marco.x, Math.max(marco.x + marco.w - iw * s, tx));
    ty = Math.min(marco.y, Math.max(marco.y + marco.h - ih * s, ty));
  };
  const pintar = () => {
    limitar();
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    zoom.value = String(s / base);
  };
  // Acerca manteniendo fijo el punto (cx, cy) del área
  const acercar = (nueva, cx, cy) => {
    const n = Math.min(base * 4, Math.max(base, nueva));
    tx = cx - ((cx - tx) * n) / s;
    ty = cy - ((cy - ty) * n) / s;
    s = n;
    pintar();
  };
  pintar();

  // Arrastre y pellizco con eventos de puntero (dedo o mouse)
  const punteros = new Map();
  let previo = null;
  const centro = () => {
    const p = [...punteros.values()];
    const r = area.getBoundingClientRect();
    return {
      x: p.reduce((a, b) => a + b.x, 0) / p.length - r.left,
      y: p.reduce((a, b) => a + b.y, 0) / p.length - r.top,
      d: p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0,
    };
  };
  area.addEventListener('pointerdown', (e) => {
    area.setPointerCapture(e.pointerId);
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    previo = centro();
  });
  area.addEventListener('pointermove', (e) => {
    if (!punteros.has(e.pointerId)) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = centro();
    if (previo) {
      tx += c.x - previo.x;
      ty += c.y - previo.y;
      if (c.d && previo.d) {
        acercar(s * (c.d / previo.d), c.x, c.y);
      } else pintar();
    }
    previo = c;
  });
  const soltar = (e) => {
    punteros.delete(e.pointerId);
    previo = punteros.size ? centro() : null;
  };
  area.addEventListener('pointerup', soltar);
  area.addEventListener('pointercancel', soltar);
  area.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = area.getBoundingClientRect();
      acercar(s * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false }
  );
  zoom.addEventListener('input', () => acercar(base * Number(zoom.value), marco.x + marco.w / 2, marco.y + marco.h / 2));

  // Si cambia el tamaño del visor (giro del teléfono), se reacomoda
  const ro = new ResizeObserver(() => {
    const antes = { ...marco };
    marco = rectMarco(contenedor, area);
    if (!marco.w || (antes.w === marco.w && antes.h === marco.h)) return;
    const k = s / base;
    base = Math.max(marco.w / iw, marco.h / ih);
    s = base * k;
    tx = marco.x + (marco.w - iw * s) / 2;
    ty = marco.y + (marco.h - ih * s) / 2;
    pintar();
  });
  ro.observe(area);

  const cerrar = () => {
    ro.disconnect();
    contenedor.hidden = true;
    contenedor.innerHTML = '';
    contenedor.onclick = null;
  };

  contenedor.onclick = (e) => {
    const a = e.target.closest('[data-cam]')?.dataset.cam;
    if (a === 'cerrar') {
      cerrar();
      onCerrar?.();
    }
    if (a === 'izq' || a === 'der') {
      const nuevo = girar(img, a === 'izq');
      nuevo.className = img.className;
      img.replaceWith(nuevo);
      img = nuevo;
      reiniciar();
      pintar();
    }
    if (a === 'usar') {
      const foto = recortar(img, (marco.x - tx) / s, (marco.y - ty) / s, marco.w / s, marco.h / s);
      cerrar();
      onListo(foto);
    }
  };
  contenedor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return cerrar;
}
