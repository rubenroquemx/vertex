// Estructuras externas: el CPV carga en Excel las listas de otras estructuras que corren en paralelo y ve,
// solo con conteos, cuántas personas ya están en su árbol o se repiten entre esas estructuras.
// El super administrador ve las de todos los CPV. Nada de esto toca metas ni promovidos.
import { ICONS, $, esc, fmtNum, fmtDateTime, api, toast, uploadFile, navigate } from './lib.js';

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function viewExternas(route, _p, state) {
  const d = await api('/api/externas');
  route.data = d;
  const esCPV = d.rol === 'cpv';
  const intro = esCPV
    ? 'Carga en Excel las listas de otras estructuras que corren en paralelo. Solo verás cuántas personas ya están en tu estructura o se repiten entre ellas: no se convierten en promovidos ni cambian tus metas.'
    : 'Estructuras externas que cada CPV ha cargado y sus coincidencias, solo con conteos. Cada CPV las coteja únicamente contra su propio árbol.';

  const carga = esCPV
    ? `<section class="card form-card ext-carga" aria-labelledby="extCT">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.upload}</span><h3 id="extCT">Cargar estructura</h3>
          <a class="btn btn--secondary btn--sm" href="/api/externas/plantilla" download>Descargar plantilla</a></header>
        <form id="extForm" novalidate>
          <div class="field-row">
            <div class="field">
              <label for="extDestino">Estructura</label>
              <select class="input" id="extDestino">
                <option value="">+ Nueva estructura</option>
                ${(d.cpvs[0]?.estructuras || []).map((e) => `<option value="${e.id}">${esc(e.nombre)} (agregar personas)</option>`).join('')}
              </select>
              <p class="field__error" id="extDestino-err"></p>
            </div>
            <div class="field" id="extNombreF">
              <label for="extNombre">Nombre de la nueva estructura</label>
              <input class="input" id="extNombre" maxlength="80" placeholder="ej. Estructura del Partido X">
              <p class="field__error" id="extNombre-err"></p>
            </div>
          </div>
          <div class="field">
            <label for="extArchivo">Archivo de Excel (.xlsx)</label>
            <input class="input" type="file" id="extArchivo" accept=".xlsx,${XLSX}">
            <p class="field__help">Columnas: CLAVE_ELECTOR, CURP, APELLIDO_PATERNO, APELLIDO_MATERNO, NOMBRES, TELEFONO. Cada persona necesita al menos su clave de elector o su CURP.</p>
            <p class="field__error" id="extArchivo-err"></p>
          </div>
          <p class="form-error" id="extErr" role="alert"></p>
          <div class="ext-acc"><button class="btn" type="submit" id="extRevisar">Revisar archivo</button></div>
        </form>
        <div class="ext-prev" id="extPrev" hidden aria-live="polite"></div>
      </section>`
    : '';

  const bloques = d.cpvs.length
    ? d.cpvs.map((c) => bloqueCPV(c, esCPV)).join('')
    : `<div class="empty"><span aria-hidden="true">${ICONS.users}</span><strong>Aún no hay estructuras externas</strong><span>${esCPV ? 'Descarga la plantilla, llénala y cárgala aquí.' : 'Ningún CPV ha cargado estructuras externas.'}</span></div>`;

  return `
    <div class="ext">
      <div class="page-head"><h2>Estructuras externas</h2><p>${esc(intro)}</p></div>
      ${carga}
      ${bloques}
    </div>`;
}

function bloqueCPV(c, esCPV) {
  const t = c.total;
  const tu = esCPV ? 'tu estructura' : 'su estructura';
  if (!c.estructuras.length)
    return esCPV ? `<div class="empty"><span aria-hidden="true">${ICONS.users}</span><strong>Aún no cargas estructuras externas</strong><span>Descarga la plantilla, llénala y cárgala arriba.</span></div>` : '';
  const kpi = (label, valor, sub) => `<div class="ec-kpi"><span class="ec-kpi__label">${label}</span><span class="ec-kpi__valor">${valor}</span><span class="ec-kpi__sub">${sub}</span></div>`;
  const kpis = `
    <div class="ec-kpis ext-kpis">
      ${kpi('Estructuras externas', fmtNum(c.estructuras.length), `${fmtNum(t.personas)} registros cargados`)}
      ${kpi('Personas distintas', fmtNum(t.distintas), 'Entre todas las estructuras externas')}
      ${kpi(`También en ${tu}`, fmtNum(t.enNuestra), `${pct(t.enNuestra, t.distintas)} de las personas distintas`)}
      ${kpi('En dos o más externas', fmtNum(t.enDosOMasExternas), `${pct(t.enDosOMasExternas, t.distintas)} de las personas distintas`)}
      ${kpi('En tres o más estructuras', fmtNum(t.enTresOMas), `Contando ${tu}`)}
    </div>`;
  const filas = c.estructuras
    .map(
      (e) => `
      <li class="ext-est">
        <div class="ext-est__top">
          <div><h4>${esc(e.nombre)}</h4>
            <p class="muted">${fmtNum(e.personas)} personas${e.ultimaCarga ? ` · última carga ${esc(fmtDateTime(e.ultimaCarga.at))} por ${esc(e.ultimaCarga.por)}` : ''}</p></div>
        </div>
        <dl class="ext-cifras">
          <div><dt>También en ${tu}</dt><dd>${fmtNum(e.enNuestra)} <small>${pct(e.enNuestra, e.personas)}</small></dd>${barra(e.enNuestra, e.personas)}</div>
          <div><dt>En otras estructuras externas</dt><dd>${fmtNum(e.enOtras)} <small>${pct(e.enOtras, e.personas)}</small></dd>${barra(e.enOtras, e.personas)}</div>
          <div><dt>En tres o más estructuras</dt><dd>${fmtNum(e.enTresOMas)} <small>${pct(e.enTresOMas, e.personas)}</small></dd>${barra(e.enTresOMas, e.personas)}</div>
        </dl>
        <details class="ext-det" data-id="${e.id}">
          <summary>Detalle</summary>
          ${
            e.porOtra.length
              ? `<h5>Coincidencias con cada estructura externa</h5><ul class="ext-otras">${e.porOtra.map((o) => `<li><span>${esc(o.nombre)}</span><strong>${fmtNum(o.n)}</strong></li>`).join('')}</ul>`
              : '<p class="muted">No coincide con otras estructuras externas.</p>'
          }
          <h5>Cargas</h5>
          <div class="ext-cargas" data-cargas><p class="muted">Cargando…</p></div>
          <div class="ext-det__acc"><button class="btn btn--secondary btn--sm" type="button" data-eliminar="${e.id}" data-nombre="${esc(e.nombre)}">${ICONS.trash}<span>Eliminar estructura</span></button></div>
        </details>
      </li>`
    )
    .join('');

  // Cruce entre estructuras: cuántas personas de la fila están también en la columna
  const par = new Map(c.pares.map((p) => [`${p.a}|${p.b}`, p.n]));
  const cruce =
    c.estructuras.length > 0
      ? `<section class="card" aria-labelledby="extX${c.id}">
          <header class="dash-card__head"><h3 id="extX${c.id}">Cruce entre estructuras</h3><span class="muted">Personas de cada fila que también están en la columna</span></header>
          <div class="table-wrap"><table class="table ext-cruce">
            <thead><tr><th scope="col">Estructura</th><th scope="col" class="num">${esCPV ? 'Tu estructura' : 'Estructura del CPV'}</th>${c.estructuras.map((e) => `<th scope="col" class="num">${esc(e.nombre)}</th>`).join('')}</tr></thead>
            <tbody>${c.estructuras
              .map(
                (f) => `<tr><th scope="row">${esc(f.nombre)} <span class="muted">(${fmtNum(f.personas)})</span></th>
                  <td class="num">${celda(f.enNuestra, f.personas)}</td>
                  ${c.estructuras.map((col) => (col.id === f.id ? '<td class="num muted">—</td>' : `<td class="num">${celda(par.get(`${f.id}|${col.id}`) || 0, f.personas)}</td>`)).join('')}</tr>`
              )
              .join('')}</tbody>
          </table></div>
        </section>`
      : '';

  return `
    <section class="ext-cpv" aria-label="${esc(c.nombre)}">
      ${esCPV ? '' : `<h3 class="ext-cpv__t">${esc(c.nombre)}</h3>`}
      ${kpis}
      <ul class="ext-lista">${filas}</ul>
      ${cruce}
    </section>`;
}

const barra = (a, b) => `<span class="ec-bar" role="img" aria-label="${pct(a, b)}"><span style="width:${b ? Math.min(100, (a / b) * 100) : 0}%"></span></span>`;
const celda = (n, total) => (n ? `<strong>${fmtNum(n)}</strong> <small class="muted">${pct(n, total)}</small>` : '<span class="muted">0</span>');

export function mountExternas(root, route) {
  const d = route.data;
  // Detalle: historial de cargas (al abrir) y eliminar con doble toque
  root.addEventListener(
    'toggle',
    async (ev) => {
      const det = ev.target;
      if (!det.matches?.('.ext-det') || !det.open || det.dataset.cargado) return;
      det.dataset.cargado = '1';
      const box = det.querySelector('[data-cargas]');
      try {
        const cargas = await api(`/api/externas/${det.dataset.id}/cargas`);
        box.innerHTML = cargas.length
          ? `<ul class="ext-hist">${cargas
              .map(
                (c) => `<li><strong>${esc(fmtDateTime(c.at))}</strong> · ${esc(c.por)}${c.archivo ? ` · ${esc(c.archivo)}` : ''}<br>
                  <span class="muted">${fmtNum(c.filas)} filas · ${fmtNum(c.nuevas)} nuevas · ${fmtNum(c.repetidas)} ya estaban o repetidas · ${fmtNum(c.errores)} con error</span></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">Sin cargas.</p>';
      } catch (err) {
        box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
      }
    },
    true
  );
  let confirmar = null;
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-eliminar]');
    if (!b) return;
    if (confirmar !== b) {
      confirmar = b;
      b.querySelector('span').textContent = `¿Eliminar «${b.dataset.nombre}» y sus personas? Toca de nuevo`;
      setTimeout(() => {
        if (confirmar === b) {
          confirmar = null;
          b.querySelector('span').textContent = 'Eliminar estructura';
        }
      }, 4000);
      return;
    }
    b.disabled = true;
    try {
      const r = await api(`/api/externas/${b.dataset.eliminar}`, { method: 'DELETE' });
      toast(`Se eliminó «${r.nombre}» (${fmtNum(r.personas)} personas)`);
      navigate(location.pathname);
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  });

  if (d.rol !== 'cpv') return;
  const form = $('#extForm', root);
  const destino = $('#extDestino', root);
  const prev = $('#extPrev', root);
  const err = $('#extErr', root);
  const limpiar = () => ['extDestino-err', 'extNombre-err', 'extArchivo-err'].forEach((id) => ($(`#${id}`, root).textContent = ''));
  destino.addEventListener('change', () => ($('#extNombreF', root).hidden = Boolean(destino.value)));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpiar();
    err.textContent = '';
    prev.hidden = true;
    const file = $('#extArchivo', root).files[0];
    const nombre = $('#extNombre', root).value.trim();
    if (!destino.value && nombre.length < 2) return ($('#extNombre-err', root).textContent = 'Escribe el nombre de la estructura.');
    if (!file) return ($('#extArchivo-err', root).textContent = 'Elige el archivo de Excel.');
    if (!/\.xlsx$/i.test(file.name)) return ($('#extArchivo-err', root).textContent = 'El archivo debe ser de Excel (.xlsx).');
    const btn = $('#extRevisar', root);
    btn.disabled = true;
    const qs = destino.value ? `estructura=${encodeURIComponent(destino.value)}` : `nombre=${encodeURIComponent(nombre)}`;
    try {
      const r = await uploadFile(`/api/externas/revisar?${qs}`, file, XLSX, (p) => (btn.textContent = p < 1 ? `Subiendo… ${Math.round(p * 100)}%` : 'Revisando…'));
      prev.hidden = false;
      prev.innerHTML = `
        <h4>Revisión de «${esc(r.archivo)}» para ${r.nueva ? 'la nueva estructura' : 'la estructura'} «${esc(r.estructura)}»</h4>
        <dl class="inf-dl">
          <div><dt>Filas leídas</dt><dd>${fmtNum(r.filas)}</dd></div>
          <div><dt>Con clave de elector o CURP válida</dt><dd>${fmtNum(r.validas)}</dd></div>
          <div><dt>Repetidas dentro del archivo</dt><dd>${fmtNum(r.repetidasArchivo)}</dd></div>
          ${r.nueva ? '' : `<div><dt>Ya estaban en la estructura</dt><dd>${fmtNum(r.existentes)}</dd></div>`}
          <div><dt>Con error (sin clave ni CURP válida)</dt><dd>${fmtNum(r.errores)}</dd></div>
          <div class="ext-prev__total"><dt>Personas que se agregarán</dt><dd>${fmtNum(r.nuevas)}</dd></div>
        </dl>
        ${r.errores ? `<p class="field__help">Filas con error: ${r.filasConError.join(', ')}${r.errores > r.filasConError.length ? ` y ${fmtNum(r.errores - r.filasConError.length)} más` : ''}. Corrígelas en el archivo y vuelve a cargarlo; las demás no se duplicarán.</p>` : ''}
        <div class="ext-acc">
          <button class="btn btn--secondary" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="button" data-confirmar ${r.nuevas ? '' : 'disabled'}>Confirmar carga</button>
        </div>`;
      prev.querySelector('[data-cancelar]').addEventListener('click', () => {
        prev.hidden = true;
        prev.innerHTML = '';
      });
      prev.querySelector('[data-confirmar]').addEventListener('click', async (e2) => {
        const b2 = e2.currentTarget;
        b2.disabled = true;
        b2.textContent = 'Guardando…';
        try {
          const c = await api('/api/externas/confirmar', { method: 'POST', body: { token: r.token } });
          toast(`«${c.nombre}»: ${fmtNum(c.nuevas)} personas agregadas`);
          navigate(location.pathname);
        } catch (x) {
          b2.disabled = false;
          b2.textContent = 'Confirmar carga';
          err.textContent = x.message;
        }
      });
      prev.scrollIntoView({ block: 'nearest' });
    } catch (x) {
      err.textContent = x.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Revisar archivo';
    }
  });
}
