// Cámara con guía para encuadrar la INE, dentro del formulario (sin ventanas emergentes).
// El navegador solo permite la cámara en vivo con HTTPS o en la misma computadora (localhost);
// si no está disponible, quien la usa debe recurrir a la cámara del sistema.
import { ICONS } from './lib.js';

// Proporción de la credencial (tarjeta ID-1: 85.6 × 54 mm)
const PROPORCION = 85.6 / 54;
// El marco ocupa este ancho del visor
const ANCHO_MARCO = 0.88;

export const camaraDisponible = () => Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);

/**
 * Muestra la cámara en `contenedor` con un marco del tamaño de la INE.
 * @returns {Promise<() => void>} función para cerrar la cámara
 */
export async function abrirCamara(contenedor, { titulo, onCaptura, onCerrar }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  contenedor.innerHTML = `
    <div class="ine-cam__head">
      <strong>${titulo}</strong>
      <span>Coloca la credencial dentro del marco, con buena luz y sin reflejos.</span>
    </div>
    <div class="ine-cam__view">
      <video playsinline muted autoplay></video>
      <div class="ine-cam__frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    </div>
    <div class="ine-cam__actions">
      <button type="button" class="btn btn--secondary" data-cam="cerrar">Cancelar</button>
      <button type="button" class="btn" data-cam="capturar">${ICONS.camera}<span>Capturar</span></button>
    </div>`;
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

  // Recorta exactamente lo que se ve dentro del marco (el video se muestra con object-fit: cover)
  const capturar = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const box = video.getBoundingClientRect();
    if (!vw || !vh || !box.width) return null;
    const escala = Math.max(box.width / vw, box.height / vh);
    const offX = (vw * escala - box.width) / 2;
    const offY = (vh * escala - box.height) / 2;
    const fw = box.width * ANCHO_MARCO;
    const fh = fw / PROPORCION;
    const fx = (box.width - fw) / 2;
    const fy = (box.height - fh) / 2;
    const sx = (fx + offX) / escala;
    const sy = (fy + offY) / escala;
    const sw = fw / escala;
    const sh = fh / escala;
    const salida = Math.min(1600, Math.round(sw));
    const c = document.createElement('canvas');
    c.width = salida;
    c.height = Math.round(salida / PROPORCION);
    c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  };

  contenedor.onclick = (e) => {
    const a = e.target.closest('[data-cam]')?.dataset.cam;
    if (a === 'cerrar') {
      cerrar();
      onCerrar?.();
    }
    if (a === 'capturar') {
      const foto = capturar();
      if (!foto) return;
      cerrar();
      onCaptura(foto);
    }
  };
  contenedor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return cerrar;
}
