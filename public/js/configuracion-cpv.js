// Configuración del CPV: factor de conversión (participación, conversión y promovidos por promotor).
// Vista previa en vivo; guardar pide contraseña y queda en bitácora.
import { ICONS, $, esc, fmtNum, fmtDateTime, api, fieldErrorSetter, toast, abrirEnArea } from './lib.js';
import { debounce } from './coordinador.js';
import { panelNovedades } from './novedades.js';

const ceil = (x) => Math.ceil(x - 1e-9);
const EJEMPLO = 1000;
const pctTxt = (v) => `${String(v).replace('.', ',')} %`;

function calcEjemplo(cfg) {
  const votantes = ceil((EJEMPLO * cfg.participacion) / 100);
  const meta = ceil((EJEMPLO * cfg.participacion * cfg.conversion) / 10000);
  return { votantes, meta, promotores: meta ? ceil(meta / cfg.factor) : 0 };
}

export async function viewConfiguracionCPV(route) {
  const [cfg, ver] = await Promise.all([api('/api/configuracion/cpv'), api('/api/version').catch(() => null)]);
  route.data = cfg;
  const { config: c } = route.data;
  return `
    <div class="page-head">
      <p>Estos valores aplican a todo tu territorio y definen las metas de cada sección.</p>
    </div>

    <div class="cfg-grid">
      <section class="card form-card" aria-labelledby="cfgT">
        <header class="form-card__head">
          <span class="form-card__icon" aria-hidden="true">${ICONS.settings}</span>
          <h3 id="cfgT">Factor de conversión</h3>
          <span class="form-card__aside" id="cfgUpd"></span>
        </header>
        <form id="cfgForm" novalidate>
          <div class="cfg-fields">
            <div class="field">
              <label for="fPart">Participación ciudadana estimada</label>
              <div class="input-suffix"><input class="input" id="fPart" name="participacion" inputmode="decimal" value="${c.participacion}" aria-describedby="fPart-help"><span>%</span></div>
              <p class="field__help" id="fPart-help">De la lista nominal, cuántos votarán.</p>
              <p class="field__error" id="fPart-err"></p>
            </div>
            <div class="field">
              <label for="fConv">Conversión objetivo</label>
              <div class="input-suffix"><input class="input" id="fConv" name="conversion" inputmode="decimal" value="${c.conversion}" aria-describedby="fConv-help"><span>%</span></div>
              <p class="field__help" id="fConv-help">De quienes votarán, cuántos debemos promover.</p>
              <p class="field__error" id="fConv-err"></p>
            </div>
            <div class="field">
              <label for="fFact">Factor por promotor</label>
              <div class="input-prefix"><span>1 ×</span><input class="input" id="fFact" name="factor" inputmode="numeric" value="${c.factor}" aria-describedby="fFact-help"></div>
              <p class="field__help" id="fFact-help">Promovidos que entrega cada promotor territorial.</p>
              <p class="field__error" id="fFact-err"></p>
            </div>
          </div>

          <div class="cfg-example" aria-live="polite">
            <p class="cfg-example__title">Ejemplo: una sección con ${fmtNum(EJEMPLO)} electores</p>
            <ol class="cfg-steps" id="cfgSteps"></ol>
          </div>

          <p class="form-error" id="cfgErr" role="alert"></p>
          <div class="form-actions form-actions--split">
            <button class="btn btn--secondary" type="button" id="cfgReset" disabled>Deshacer cambios</button>
            <button class="btn" type="submit" id="cfgSave" disabled>Guardar cambios</button>
          </div>
        </form>
      </section>

      <section class="card" aria-labelledby="cfgTerrT">
        <header class="dash-card__head">
          <h3 id="cfgTerrT">Metas de tu territorio</h3>
          <span class="muted" id="cfgPreviewTag"></span>
        </header>
        <div id="cfgTerr"></div>
      </section>

      <section class="card cfg-wide" aria-labelledby="cfgHistT">
        <header class="dash-card__head">
          <h3 id="cfgHistT">Historial de cambios</h3>
          <span class="muted">Registrado en bitácora</span>
        </header>
        <div id="cfgHist"></div>
      </section>

      <section class="cfg-wide cfg-nov" aria-labelledby="cfgNovT">
        <header class="dash-card__head">
          <h3 id="cfgNovT">Novedades de VERTEX</h3>
          ${ver ? `<span class="muted">Versión ${esc(ver.actual)}</span>` : ''}
        </header>
        ${panelNovedades(ver)}
      </section>
    </div>

    <dialog class="dialog" id="cfgDialog" aria-labelledby="cfgDlgT"></dialog>`;
}

export function mountConfiguracionCPV(root, route) {
  let saved = { ...route.data.config };
  const form = $('#cfgForm', root);
  const inputs = { participacion: $('#fPart', root), conversion: $('#fConv', root), factor: $('#fFact', root) };
  const setErrors = fieldErrorSetter(root, { participacion: 'fPart', conversion: 'fConv', factor: 'fFact' });
  const read = () => ({
    participacion: Number(inputs.participacion.value.replace(',', '.')),
    conversion: Number(inputs.conversion.value.replace(',', '.')),
    factor: Number(inputs.factor.value),
  });
  const valid = (c) => c.participacion > 0 && c.participacion <= 100 && c.conversion > 0 && c.conversion <= 100 && Number.isInteger(c.factor) && c.factor >= 1 && c.factor <= 1000;
  const changed = (c) => ['participacion', 'conversion', 'factor'].some((k) => c[k] !== saved[k]);

  const renderUpd = () => {
    const a = route.data.actualizado;
    $('#cfgUpd', root).textContent = a ? `Actualizado ${fmtDateTime(a.at)}${a.by ? ` · ${a.by}` : ''}` : 'Valores iniciales';
  };

  function renderEjemplo(c) {
    const steps = $('#cfgSteps', root);
    if (!valid(c)) {
      steps.innerHTML = '<li class="muted">Corrige los valores para ver el cálculo.</li>';
      return;
    }
    const e = calcEjemplo(c);
    steps.innerHTML = `
      <li><span class="cfg-steps__n">${fmtNum(EJEMPLO)}</span><span>electores</span></li>
      <li><span class="cfg-steps__op">× ${pctTxt(c.participacion)}</span><span class="cfg-steps__n">${fmtNum(e.votantes)}</span><span>votarán</span></li>
      <li><span class="cfg-steps__op">× ${pctTxt(c.conversion)}</span><span class="cfg-steps__n cfg-steps__n--goal">${fmtNum(e.meta)}</span><span>promovidos (meta)</span></li>
      <li><span class="cfg-steps__op">÷ ${fmtNum(c.factor)}</span><span class="cfg-steps__n cfg-steps__n--goal">${fmtNum(e.promotores)}</span><span>promotores mínimos</span></li>`;
  }

  function renderTerritorio(m, preview) {
    $('#cfgPreviewTag', root).textContent = preview ? 'Vista previa (sin guardar)' : 'Con los valores guardados';
    const box = $('#cfgTerr', root);
    if (!m.territorio) {
      box.innerHTML = '<p class="dash-note">Las metas se calculan cuando tu territorio tiene padrón cargado.</p>';
      return;
    }
    const t = m.territorio;
    box.innerHTML = `
      <dl class="cfg-totals ${preview ? 'is-preview' : ''}">
        <div><dt>Meta de promovidos</dt><dd>${fmtNum(t.meta)}</dd></div>
        <div><dt>Promotores mínimos</dt><dd>${fmtNum(t.promotores)}</dd></div>
      </dl>
      <p class="muted cfg-totals__base">${fmtNum(t.secciones)} secciones · ${fmtNum(t.electores)} electores</p>
      ${
        m.zonas.length
          ? `<div class="table-wrap"><table class="table">
              <thead><tr><th scope="col">Zona</th><th scope="col" class="num">Meta</th><th scope="col" class="num">Promotores</th></tr></thead>
              <tbody>${m.zonas
                .map(
                  (z) => `<tr><td><div class="zcell"><span class="zswatch" style="background:${z.color}"></span><span><strong>${esc(z.codigo)}</strong><small>${fmtNum(z.secciones)} secc · ${fmtNum(z.electores)} electores</small></span></div></td>
                    <td class="num num--r">${fmtNum(z.meta)}</td><td class="num num--r">${fmtNum(z.promotores)}</td></tr>`
                )
                .join('')}</tbody>
            </table></div>`
          : ''
      }`;
  }

  function renderHistorial(h) {
    $('#cfgHist', root).innerHTML = h.length
      ? `<ul class="cfg-hist">${h
          .map(
            (x) => `<li>
              <div class="cfg-hist__when"><strong>${esc(fmtDateTime(x.at))}</strong><span class="muted">${esc(x.by)}</span></div>
              <div class="cfg-hist__diff">${['participacion', 'conversion', 'factor']
                .filter((k) => x.before[k] !== x.after[k])
                .map((k) => {
                  const label = { participacion: 'Participación', conversion: 'Conversión', factor: 'Factor' }[k];
                  const fmt = (v) => (k === 'factor' ? `1 × ${fmtNum(v)}` : pctTxt(v));
                  return `<span>${label}: <s>${fmt(x.before[k])}</s> → <strong>${fmt(x.after[k])}</strong></span>`;
                })
                .join('')}</div>
            </li>`
          )
          .join('')}</ul>`
      : '<p class="dash-note">Aún no hay cambios. Se usan los valores iniciales (48 %, 60 % y 1 × 20).</p>';
  }

  const simular = debounce(async (c) => {
    try {
      renderTerritorio(await api('/api/configuracion/cpv/simular', { method: 'POST', body: c }), true);
    } catch {
      /* los errores de validación se muestran junto a los campos */
    }
  }, 300);

  function onInput() {
    const c = read();
    setErrors();
    $('#cfgErr', root).textContent = '';
    renderEjemplo(c);
    const dirty = changed(c);
    $('#cfgSave', root).disabled = !dirty || !valid(c);
    $('#cfgReset', root).disabled = !dirty;
    if (valid(c) && dirty) simular(c);
    else if (!dirty) renderTerritorio(route.data.metas, false);
  }
  Object.values(inputs).forEach((i) => i.addEventListener('input', onInput));

  $('#cfgReset', root).addEventListener('click', () => {
    inputs.participacion.value = saved.participacion;
    inputs.conversion.value = saved.conversion;
    inputs.factor.value = saved.factor;
    onInput();
  });

  // Guardar: confirmación con contraseña
  const dlg = $('#cfgDialog', root);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = read();
    if (!valid(c) || !changed(c)) return;
    const me = route.data.confirm;
    const fila = (label, a, b) => (a === b ? '' : `<li>${label}: <s>${a}</s> → <strong>${b}</strong></li>`);
    dlg.innerHTML = `
      <form class="dialog__body" id="cfgConfirm" novalidate>
        <div class="dialog__head"><h3 id="cfgDlgT">Confirmar cambio de metas</h3>
          <button class="icon-btn icon-btn--always" type="button" data-close aria-label="Cerrar">${ICONS.close}</button></div>
        <ul class="cfg-change">
          ${fila('Participación', pctTxt(saved.participacion), pctTxt(c.participacion))}
          ${fila('Conversión', pctTxt(saved.conversion), pctTxt(c.conversion))}
          ${fila('Factor', `1 × ${fmtNum(saved.factor)}`, `1 × ${fmtNum(c.factor)}`)}
        </ul>
        <p class="dialog__meta">Las metas de todas las secciones se recalcularán al momento y el cambio quedará registrado en la bitácora.</p>
        ${
          me.hasPassword
            ? `<div class="field">
                <label for="cfgPass">Escribe tu contraseña para confirmar${me.name ? ` <span class="legend-help">(${esc(me.name)})</span>` : ''}</label>
                <input class="input" id="cfgPass" type="password" autocomplete="current-password" required>
                <p class="field__error" id="cfgPass-err"></p>
              </div>
              <p class="form-error" id="cfgDlgErr" role="alert"></p>
              <div class="dialog__actions">
                <button class="btn btn--secondary" type="button" data-close>Cancelar</button>
                <button class="btn" type="submit">Guardar cambios</button>
              </div>`
            : `<div class="notice">${ICONS.alert}<div>Para confirmar este cambio necesitas una contraseña. Créala en <a href="/perfil" data-link>Mi perfil</a>.</div></div>
              <div class="dialog__actions"><button class="btn btn--secondary" type="button" data-close>Cerrar</button></div>`
        }
      </form>`;
    dlg.onclick = (ev) => {
      if (ev.target.closest('[data-close]') || ev.target.closest('a[data-link]')) dlg.close();
    };
    const f = $('#cfgConfirm', dlg);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pass = $('#cfgPass', dlg);
      const btn = f.querySelector('[type="submit"]');
      $('#cfgPass-err', dlg).textContent = '';
      $('#cfgDlgErr', dlg).textContent = '';
      if (!pass.value) {
        $('#cfgPass-err', dlg).textContent = 'Escribe tu contraseña.';
        return pass.focus();
      }
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        const r = await api('/api/configuracion/cpv', { method: 'PUT', body: { ...c, password: pass.value } });
        saved = { ...r.config };
        route.data.metas = r.metas;
        route.data.actualizado = { at: new Date().toISOString(), by: me.name };
        dlg.close();
        renderUpd();
        renderHistorial(r.historial);
        onInput();
        toast('Metas actualizadas');
      } catch (err) {
        if (err.data?.fields?.password) {
          $('#cfgPass-err', dlg).textContent = err.data.fields.password;
          pass.select();
        } else if (err.data?.fields) {
          dlg.close();
          setErrors(err.data.fields);
        } else $('#cfgDlgErr', dlg).textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Guardar cambios';
      }
    });
    abrirEnArea(dlg);
    $('#cfgPass', dlg)?.focus();
  });

  renderUpd();
  renderEjemplo(read());
  renderTerritorio(route.data.metas, false);
  renderHistorial(route.data.historial);
  return undefined;
}
