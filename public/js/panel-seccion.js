// Panel del Responsable de Sección: cuántos Promotores Territoriales debe tener en su sección,
// según el cálculo (factor de conversión) que definió su Coordinador de Promoción del Voto.
import { ICONS, esc, fmtNum, api } from './lib.js';

const pct = (v) => `${fmtNum(v)}%`;

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
  const nombres = d.secciones.map((s) => s.clave).join(', ');
  const etiqueta = `${d.secciones.length === 1 ? 'sección' : 'secciones'} ${nombres}`;

  if (d.promotores === null) {
    return `${head}
      <div class="empty">
        <span aria-hidden="true">${ICONS.database}</span>
        <strong>Falta el padrón electoral</strong>
        <span>Sin la lista nominal de la ${esc(etiqueta)} no se puede calcular cuántos promotores necesitas. Avisa a tu coordinador.</span>
      </div>`;
  }

  const c = d.config;
  const faltan = Math.max(d.promotores - d.registrados, 0);
  const avance = d.promotores ? Math.min(Math.round((d.registrados / d.promotores) * 100), 100) : 0;
  const varias = d.secciones.length > 1;

  return `${head}
    <section class="ps-hero" aria-labelledby="psTitle">
      <p class="ps-hero__label">Promotores Territoriales que debes tener</p>
      <p class="ps-hero__num" id="psTitle"><strong>${fmtNum(d.promotores)}</strong><span>${d.promotores === 1 ? 'promotor' : 'promotores'}</span></p>
      <p class="ps-hero__sub">en la ${esc(etiqueta)} · ${esc(d.secciones[0].municipio)}</p>
      <div class="ps-hero__progress">
        <div class="ps-bar" role="progressbar" aria-label="Promotores registrados" aria-valuemin="0" aria-valuemax="${d.promotores}" aria-valuenow="${d.registrados}"><span style="width:${avance}%"></span></div>
        <p>${fmtNum(d.registrados)} de ${fmtNum(d.promotores)} registrados · ${faltan ? `te ${faltan === 1 ? 'falta' : 'faltan'} <strong>${fmtNum(faltan)}</strong>` : '<strong>meta cubierta</strong>'}</p>
      </div>
    </section>

    <section class="card ps-calc" aria-labelledby="psCalc">
      <h3 class="card__title" id="psCalc">¿Cómo se calculó?</h3>
      <p class="ps-calc__intro">Con los valores que definió tu Coordinador de Promoción del Voto:</p>
      <ol class="ps-steps">
        <li><span>Lista nominal${varias ? ' de tus secciones' : ` de la sección ${d.secciones[0].clave}`}</span><strong>${fmtNum(d.electores)} electores</strong></li>
        <li><span>× Participación esperada</span><strong>${pct(c.participacion)}</strong></li>
        <li><span>× Conversión a favor</span><strong>${pct(c.conversion)}</strong></li>
        <li class="ps-steps__res"><span>= Meta de promovidos</span><strong>${fmtNum(d.meta)}</strong></li>
        <li><span>÷ Promovidos por promotor</span><strong>${fmtNum(c.factor)}</strong></li>
        <li class="ps-steps__res"><span>= Promotores necesarios</span><strong>${fmtNum(d.promotores)}</strong></li>
      </ol>
      <p class="field__help">Los resultados se redondean hacia arriba. Si tu coordinador cambia estos valores, la cifra se actualiza sola.</p>
    </section>`;
}
