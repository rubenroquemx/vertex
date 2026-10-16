// Indicador minimalista de asistencias a eventos: punto azul con el número de asambleas y punto verde
// con el número de recorridos (caminatas). Siempre con su texto para lectores de pantalla.
import { fmtNum } from './lib.js';

export function indicador(a, { vacio = '' } = {}) {
  const asam = a?.asambleas || 0;
  const rec = a?.recorridos || 0;
  if (!asam && !rec) return vacio;
  const partes = [
    asam ? `${fmtNum(asam)} ${asam === 1 ? 'asamblea' : 'asambleas'}` : '',
    rec ? `${fmtNum(rec)} ${rec === 1 ? 'recorrido' : 'recorridos'}` : '',
  ].filter(Boolean);
  return `<span class="asis" role="img" aria-label="Asistió a ${partes.join(' y ')}" title="Asistió a ${partes.join(' y ')}">${
    asam ? `<span class="asis__i asis__i--asam">${fmtNum(asam)}</span>` : ''
  }${rec ? `<span class="asis__i asis__i--rec">${fmtNum(rec)}</span>` : ''}</span>`;
}

export const leyendaAsistencias = () =>
  `<p class="asis-ley"><span class="asis__i asis__i--asam">n</span> asambleas · <span class="asis__i asis__i--rec">n</span> recorridos a los que asistió</p>`;
