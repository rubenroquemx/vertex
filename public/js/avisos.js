// Centro de avisos del CPV: notificación (push y campana) a su estructura por niveles y alcance
// (global, por zona o por sección). Muestra a cuántas personas llega antes de enviar y el historial.
import { $, esc, fmtNum, fmtSeccion, fmtDateTime, api, toast } from './lib.js';
import { debounce } from './coordinador.js';

const NIVEL = { coord_zona: 'Coordinadores de Zona', resp_seccion: 'Responsables de Sección', promotor: 'Promotores' };
const ALCANCE = { global: 'Toda mi estructura', zonas: 'Por zona', secciones: 'Por sección' };

const chip = (name, value, texto, marcado = false, extra = '') =>
  `<label class="av-chip"><input type="checkbox" name="${name}" value="${esc(value)}" ${marcado ? 'checked' : ''}><span>${extra}${texto}</span></label>`;

function resumenAviso(a) {
  const niveles = a.niveles.map((n) => NIVEL[n] || n).join(', ');
  const donde = a.alcance === 'zonas' ? a.zonas.join(', ') : a.alcance === 'secciones' ? `Secciones ${a.secciones.map(fmtSeccion).join(', ')}` : 'Toda la estructura';
  return `${esc(niveles)} · ${esc(donde)}`;
}

export async function viewAvisos(route) {
  const d = await api('/api/avisos');
  route.data = d;
  return `
    <div class="page-head"><p>Envía un aviso a tu estructura: llega como notificación al celular y queda en su campana.</p></div>
    <div class="av">
      <form class="card av-form" id="avForm" novalidate>
        <fieldset class="av-grupo">
          <legend>¿A quién?</legend>
          <div class="av-chips" id="avNiveles">${Object.entries(NIVEL).map(([k, t]) => chip('nivel', k, t, true)).join('')}</div>
          <p class="field__error" id="avNiveles-err"></p>
        </fieldset>
        <fieldset class="av-grupo">
          <legend>¿Dónde?</legend>
          <div class="seg av-alcance" role="radiogroup" aria-label="Alcance">
            ${Object.entries(ALCANCE).map(([k, t], i) => `<label class="seg__btn${i ? '' : ' is-on'}"><input type="radio" name="alcance" value="${k}" ${i ? '' : 'checked'}>${t}</label>`).join('')}
          </div>
          <div class="av-sub" id="avZonas" hidden>
            ${d.zonas.length ? `<div class="av-chips">${d.zonas.map((z) => chip('zona', z.id, esc(`${z.codigo ? `${z.codigo} · ` : ''}${z.nombre}`), false, `<i class="av-sw" style="background:${esc(z.color)}"></i>`)).join('')}</div>` : '<p class="muted">Aún no tienes zonas.</p>'}
            <p class="field__error" id="avZonas-err"></p>
          </div>
          <div class="av-sub" id="avSecciones" hidden>
            ${
              d.secciones.length
                ? `<input class="input av-buscar" id="avBuscarSec" type="search" inputmode="numeric" placeholder="Buscar sección" autocomplete="off">
                   <div class="av-chips av-chips--secciones" id="avListaSec">${d.secciones.map((s) => chip('seccion', s.clave, fmtSeccion(s.clave))).join('')}</div>`
                : '<p class="muted">Aún no hay secciones con Responsable.</p>'
            }
            <p class="field__error" id="avSecciones-err"></p>
          </div>
        </fieldset>
        <div class="field">
          <label for="avTitulo">Título <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="avTitulo" name="titulo" maxlength="80" autocomplete="off" placeholder="ej. Reunión de coordinación el sábado">
          <p class="field__error" id="avTitulo-err"></p>
        </div>
        <div class="field">
          <label for="avCuerpo">Mensaje <span class="req" aria-hidden="true">*</span></label>
          <textarea class="input textarea" id="avCuerpo" name="cuerpo" rows="4" maxlength="300" placeholder="Lo que quieres que sepan"></textarea>
          <p class="field__help"><span id="avCuenta">0</span>/300 caracteres.</p>
          <p class="field__error" id="avCuerpo-err"></p>
        </div>
        <p class="av-alcanza" id="avAlcanza" role="status"></p>
        <p class="form-error" id="avErr" role="alert"></p>
        <div class="av-acc"><button class="btn av-enviar" type="submit" id="avEnviar">Enviar aviso</button></div>
      </form>

      <section class="av-hist" aria-labelledby="avHistT">
        <h3 class="promo-grupo__titulo" id="avHistT">Avisos enviados</h3>
        ${
          d.historial.length
            ? `<ul class="av-lista">${d.historial
                .map(
                  (a) => `<li class="card av-item">
                    <div class="av-item__top"><strong>${esc(a.titulo)}</strong><time datetime="${a.at}">${esc(fmtDateTime(a.at))}</time></div>
                    <p>${esc(a.cuerpo).replace(/\n/g, '<br>')}</p>
                    <small>${resumenAviso(a)} · llegó a ${fmtNum(a.destinatarios)} ${a.destinatarios === 1 ? 'persona' : 'personas'} (${fmtNum(a.conPush)} con notificaciones en el celular)</small>
                  </li>`
                )
                .join('')}</ul>`
            : '<p class="muted">Todavía no has enviado avisos.</p>'
        }
      </section>
    </div>`;
}

export function mountAvisos(root, route) {
  const form = $('#avForm', root);
  if (!form) return;
  const valores = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const filtro = () => {
    const alcance = form.querySelector('input[name="alcance"]:checked').value;
    return { niveles: valores('nivel'), alcance, zonas: valores('zona'), secciones: valores('seccion').map(Number) };
  };
  const alcanza = $('#avAlcanza', root);
  const enviar = $('#avEnviar', root);
  let ultimo = { destinatarios: 0 };

  const contar = debounce(async () => {
    const f = filtro();
    const falta = !f.niveles.length || (f.alcance === 'zonas' && !f.zonas.length) || (f.alcance === 'secciones' && !f.secciones.length);
    if (falta) {
      ultimo = { destinatarios: 0 };
      alcanza.textContent = !f.niveles.length ? 'Elige al menos un nivel.' : f.alcance === 'zonas' ? 'Elige al menos una zona.' : 'Elige al menos una sección.';
      return;
    }
    try {
      ultimo = await api('/api/avisos/conteo', { method: 'POST', body: f });
      alcanza.innerHTML = ultimo.destinatarios
        ? `Llegará a <strong>${fmtNum(ultimo.destinatarios)} ${ultimo.destinatarios === 1 ? 'persona' : 'personas'}</strong> · ${fmtNum(ultimo.conPush)} ${ultimo.conPush === 1 ? 'tiene' : 'tienen'} activadas las notificaciones en su celular; a los demás les queda en la campana.`
        : 'Nadie de tu estructura coincide con lo que elegiste.';
    } catch {
      alcanza.textContent = '';
    }
    reiniciarConfirmacion();
  }, 250);

  const reiniciarConfirmacion = () => {
    delete enviar.dataset.confirmar;
    enviar.textContent = 'Enviar aviso';
  };

  form.addEventListener('change', (e) => {
    if (e.target.name === 'alcance') {
      form.querySelectorAll('.av-alcance .seg__btn').forEach((b) => b.classList.toggle('is-on', b.querySelector('input').checked));
      $('#avZonas', root).hidden = e.target.value !== 'zonas';
      $('#avSecciones', root).hidden = e.target.value !== 'secciones';
    }
    contar();
  });
  $('#avBuscarSec', root)?.addEventListener('input', (e) => {
    const q = e.target.value.replace(/\D/g, '');
    root.querySelectorAll('#avListaSec .av-chip').forEach((c) => {
      const marcado = c.querySelector('input').checked;
      c.hidden = Boolean(q) && !marcado && !c.textContent.includes(q.padStart(Math.min(4, q.length), '0'));
    });
  });
  const cuerpo = $('#avCuerpo', root);
  cuerpo.addEventListener('input', () => ($('#avCuenta', root).textContent = cuerpo.value.length));
  form.addEventListener('input', (e) => {
    if (['avTitulo', 'avCuerpo'].includes(e.target.id)) reiniciarConfirmacion();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const p of root.querySelectorAll('.field__error, .form-error')) p.textContent = '';
    const body = { ...filtro(), titulo: $('#avTitulo', root).value.trim(), cuerpo: cuerpo.value.trim() };
    if (body.titulo.length < 3) return ($('#avTitulo-err', root).textContent = 'Escribe el título del aviso.');
    if (body.cuerpo.length < 3) return ($('#avCuerpo-err', root).textContent = 'Escribe el mensaje.');
    if (!ultimo.destinatarios) return ($('#avErr', root).textContent = 'Elige a quién enviar el aviso.');
    // Envío en dos toques: el segundo confirma a cuántas personas llega
    if (!enviar.dataset.confirmar) {
      enviar.dataset.confirmar = '1';
      enviar.textContent = `¿Enviar a ${fmtNum(ultimo.destinatarios)} ${ultimo.destinatarios === 1 ? 'persona' : 'personas'}? Toca de nuevo`;
      return;
    }
    enviar.disabled = true;
    try {
      const r = await api('/api/avisos', { method: 'POST', body });
      toast(`Aviso enviado a ${fmtNum(r.destinatarios)} ${r.destinatarios === 1 ? 'persona' : 'personas'}`);
      window.dispatchEvent(new CustomEvent('vx:navigate', { detail: '/avisos' }));
    } catch (err) {
      const f = err.data?.fields || {};
      const ids = { niveles: 'avNiveles', zonas: 'avZonas', secciones: 'avSecciones', titulo: 'avTitulo', cuerpo: 'avCuerpo' };
      for (const [k, id] of Object.entries(ids)) if (f[k]) $(`#${id}-err`, root).textContent = f[k];
      $('#avErr', root).textContent = err.message;
      enviar.disabled = false;
      reiniciarConfirmacion();
    }
  });
  contar();
}
