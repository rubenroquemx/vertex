// Novedades de VERTEX: registro de cambios de la versión actual y la anterior
// (Configuración del CPV y del super administrador).
import { esc } from './lib.js';

const FECHA = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fecha = (key) => FECHA.format(new Date(`${key}T12:00:00Z`));

export function panelNovedades(d) {
  if (!d?.versiones?.length) return '<p class="muted">No hay notas de versión.</p>';
  return `
    <div class="nov">
      ${d.versiones
        .map(
          (v, i) => `
        <section class="card nov-ver" aria-labelledby="nov-${i}">
          <header class="nov-ver__head">
            <h3 id="nov-${i}">Versión ${esc(v.version)}</h3>
            ${i === 0 ? '<span class="estatus estatus--aprobado">Versión actual</span>' : '<span class="estatus estatus--neutro">Anterior</span>'}
            <span class="nov-ver__fecha">${esc(fecha(v.fecha))}</span>
          </header>
          ${v.titulo ? `<p class="nov-ver__titulo">${esc(v.titulo)}</p>` : ''}
          ${v.cambios
            .map(
              (c) => `<div class="nov-area"><h4>${esc(c.area)}</h4>
                <ul>${c.textos.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`
            )
            .join('')}
        </section>`
        )
        .join('')}
    </div>`;
}
