// Panel del Responsable de Sección: cuántos Promotores Territoriales debe tener en su sección,
// según el cálculo (factor de conversión) que definió su Coordinador de Promoción del Voto.
import { ICONS, esc, fmtNum, fmtSeccion, api } from './lib.js';

export async function viewPanelSeccion() {
  const d = await api('/api/panel/seccion');
  // Sin encabezado: el título «Panel» ya está en la barra superior
  const head = '';

  if (!d.secciones.length) {
    return `${head}
      <div class="empty">
        <span aria-hidden="true">${ICONS.map}</span>
        <strong>Aún no tienes sección asignada</strong>
        <span>Tu Coordinador de Zona debe asignarte una sección.</span>
      </div>`;
  }
  const nombres = d.secciones.map((s) => fmtSeccion(s.clave)).join(', ');
  const etiqueta = `${d.secciones.length === 1 ? 'sección' : 'secciones'} ${nombres}`;

  if (d.promotores === null) {
    return `${head}
      <div class="empty">
        <span aria-hidden="true">${ICONS.database}</span>
        <strong>Falta el padrón electoral</strong>
        <span>Sin la lista nominal de la ${esc(etiqueta)} no se puede calcular cuántos promotores necesitas. Avisa a tu coordinador.</span>
      </div>`;
  }

  const faltan = Math.max(d.promotores - d.registrados, 0);
  const avance = d.promotores ? Math.min(Math.round((d.registrados / d.promotores) * 100), 100) : 0;
  const promovidos = d.promovidos || 0;
  const faltanProm = Math.max(d.meta - promovidos, 0);
  const avanceProm = d.meta ? Math.min(Math.round((promovidos / d.meta) * 100), 100) : 0;

  return `${head}
    <div class="ps-heroes">
    <section class="ps-hero" aria-labelledby="psTitle">
      <p class="ps-hero__label">Promotores Territoriales que debes tener</p>
      <p class="ps-hero__num" id="psTitle"><strong>${fmtNum(d.promotores)}</strong><span>${d.promotores === 1 ? 'promotor' : 'promotores'}</span></p>
      <p class="ps-hero__sub">en la ${esc(etiqueta)} · ${esc(d.secciones[0].municipio)}</p>
      <div class="ps-hero__progress">
        <div class="ps-bar" role="progressbar" aria-label="Promotores registrados" aria-valuemin="0" aria-valuemax="${d.promotores}" aria-valuenow="${d.registrados}"><span style="width:${avance}%"></span></div>
        <p>${fmtNum(d.registrados)} de ${fmtNum(d.promotores)} registrados · ${faltan ? `te ${faltan === 1 ? 'falta' : 'faltan'} <strong>${fmtNum(faltan)}</strong>` : '<strong>meta cubierta</strong>'}</p>
      </div>
    </section>

    <section class="ps-hero" aria-labelledby="psMeta">
      <p class="ps-hero__label">Meta global de promovidos</p>
      <p class="ps-hero__num" id="psMeta"><strong>${fmtNum(d.meta)}</strong><span>${d.meta === 1 ? 'promovido' : 'promovidos'}</span></p>
      <p class="ps-hero__sub">en la ${esc(etiqueta)} · ${esc(d.secciones[0].municipio)}</p>
      <div class="ps-hero__progress">
        <div class="ps-bar" role="progressbar" aria-label="Promovidos registrados" aria-valuemin="0" aria-valuemax="${d.meta}" aria-valuenow="${promovidos}"><span style="width:${avanceProm}%"></span></div>
        <p>${fmtNum(promovidos)} de ${fmtNum(d.meta)} registrados · ${faltanProm ? `${faltanProm === 1 ? 'falta' : 'faltan'} <strong>${fmtNum(faltanProm)}</strong>` : '<strong>meta cubierta</strong>'}</p>
      </div>
    </section>
    </div>
`;
}
