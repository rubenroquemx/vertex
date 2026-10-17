// Configuración del Super administrador: pestañas "General" y "WhatsApp (Evolution API)".
import { icon, ICONS, $, esc, fmtNum, fmtDateTime, api, fieldErrorSetter, toast, abrirEnArea, navigate } from './lib.js';

const TABS = [
  { key: 'whatsapp', name: 'WhatsApp (Evolution API)' },
  { key: 'general', name: 'General' },
];
const I = {
  plug: icon('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>'),
  send: icon('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
};

export async function viewConfiguracionSA(route) {
  const [wa, aviso, ejemplo] = await Promise.all([api('/api/configuracion/whatsapp'), api('/api/privacidad'), api('/api/configuracion/ejemplo')]);
  route.data = wa;
  const tab = new URLSearchParams(location.search).get('tab') || 'whatsapp';
  route.tab = TABS.some((t) => t.key === tab) ? tab : 'whatsapp';
  return `
    <div class="page-head">
      <p>Ajustes generales del sistema e integraciones.</p>
    </div>
    <div class="tabs" role="tablist" aria-label="Secciones de configuración">
      ${TABS.map(
        (t) => `<button type="button" role="tab" class="tabs__tab" id="tab-${t.key}" aria-controls="panel-${t.key}" aria-selected="${t.key === route.tab}" tabindex="${t.key === route.tab ? 0 : -1}" data-tab="${t.key}">${esc(t.name)}</button>`
      ).join('')}
    </div>
    <section class="tabs__panel" role="tabpanel" id="panel-whatsapp" aria-labelledby="tab-whatsapp" ${route.tab === 'whatsapp' ? '' : 'hidden'}>${panelWhatsapp(route.data)}</section>
    <section class="tabs__panel" role="tabpanel" id="panel-general" aria-labelledby="tab-general" ${route.tab === 'general' ? '' : 'hidden'}>${panelGeneral(aviso, ejemplo)}</section>
    <dialog class="dialog" id="waDialog" aria-labelledby="waDlgT"></dialog>`;
}

// ---------- General: aviso de privacidad y datos de ejemplo ----------
function panelGeneral(aviso, ej) {
  const hayEjemplo = ej.cuentas + ej.promovidos + ej.articulos + ej.ordenes + (ej.eventos || 0) + (ej.externas || 0) > 0;
  return `
    <div class="cfg-general">
      <form class="card form-card" id="avisoForm" novalidate aria-labelledby="avT">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.alert}</span><h3 id="avT">Aviso de privacidad</h3></header>
        <p class="muted">${
          aviso.version
            ? `Versión ${fmtNum(aviso.version)} · publicada el ${esc(fmtDateTime(aviso.actualizado))}.`
            : '<strong>Aún no se publica:</strong> el texto de abajo es una plantilla. Pide a tu área jurídica que lo revise antes de capturar datos reales.'
        } Se muestra en <a href="/aviso-de-privacidad" target="_blank" rel="noopener">/aviso-de-privacidad</a> y cada captura guarda la versión que se le dio a conocer a la persona.</p>
        <div class="field">
          <label for="avTexto">Texto del aviso</label>
          <textarea class="input aviso-texto" id="avTexto" name="texto" rows="16">${esc(aviso.texto)}</textarea>
          <p class="field__error" id="avTexto-err"></p>
        </div>
        <div class="mat-form__acc"><button class="btn" type="submit">Publicar nueva versión</button></div>
      </form>

      <section class="card form-card" aria-labelledby="ejT">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.trash}</span><h3 id="ejT">Datos de ejemplo</h3></header>
        ${
          hayEjemplo
            ? `<p>Hay datos de prueba cargados con el script de ejemplo. Bórralos antes de operar con personas reales; lo capturado a mano no se toca.</p>
          <dl class="sa-lista">
            <div><dt>Cuentas de ejemplo</dt><dd>${fmtNum(ej.cuentas)}</dd></div>
            <div><dt>Promovidos de ejemplo</dt><dd>${fmtNum(ej.promovidos)}</dd></div>
            <div><dt>Artículos y órdenes de material</dt><dd>${fmtNum(ej.articulos)} · ${fmtNum(ej.ordenes)}</dd></div>
            <div><dt>Asambleas y recorridos · estructuras paralelas</dt><dd>${fmtNum(ej.eventos || 0)} · ${fmtNum(ej.externas || 0)}</dd></div>
          </dl>
          <form id="ejForm" novalidate class="ej-form">
            <div class="field"><label for="ejPass">Tu contraseña para confirmar</label>
              <input class="input" id="ejPass" type="password" autocomplete="current-password"><p class="field__error" id="ejPass-err"></p></div>
            <button class="btn btn--destructive" type="submit">Borrar datos de ejemplo</button>
          </form>`
            : '<p class="muted">No hay datos de ejemplo en el sistema.</p>'
        }
      </section>
    </div>`;
}

function mountGeneral(root) {
  const form = $('#avisoForm', root);
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#avTexto-err', root).textContent = '';
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const a = await api('/api/privacidad', { method: 'PUT', body: { texto: $('#avTexto', root).value } });
      toast(`Aviso de privacidad publicado (versión ${a.version})`);
      navigate('/configuracion?tab=general');
    } catch (err) {
      $('#avTexto-err', root).textContent = err.data?.fields?.texto || err.message;
    } finally {
      btn.disabled = false;
    }
  });
  const ej = $('#ejForm', root);
  ej?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = ej.querySelector('[type="submit"]');
    // Dos toques: el primero pide confirmar
    if (!btn.dataset.confirmar) {
      btn.dataset.confirmar = '1';
      btn.textContent = '¿Seguro? Toca de nuevo para borrar';
      return;
    }
    btn.disabled = true;
    $('#ejPass-err', root).textContent = '';
    try {
      await api('/api/configuracion/ejemplo/borrar', { method: 'POST', body: { password: $('#ejPass', root).value } });
      toast('Datos de ejemplo borrados');
      navigate('/configuracion?tab=general');
    } catch (err) {
      $('#ejPass-err', root).textContent = err.data?.fields?.password || err.message;
      btn.disabled = false;
    }
  });
}

function panelWhatsapp(c) {
  return `
    <div class="cfg-grid">
      <section class="card form-card" aria-labelledby="waT">
        <header class="form-card__head">
          <span class="form-card__icon" aria-hidden="true">${I.plug}</span>
          <h3 id="waT">Servidor de Evolution API</h3>
          <span class="form-card__aside">${c.actualizado ? `Actualizado ${esc(fmtDateTime(c.actualizado.at))}${c.actualizado.by ? ` · ${esc(c.actualizado.by)}` : ''}` : 'Sin configurar'}</span>
        </header>
        <p class="units__help">Se usa para enviar por WhatsApp el código de restablecimiento de contraseña.</p>
        <form id="waForm" novalidate>
          <div class="field">
            <label for="waUrl">URL del servidor</label>
            <input class="input mono" id="waUrl" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://evolution.midominio.com" value="${esc(c.url)}">
            <p class="field__error" id="waUrl-err"></p>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="waInstance">Nombre de la instancia</label>
              <input class="input mono" id="waInstance" name="instance" autocomplete="off" spellcheck="false" placeholder="vertex" value="${esc(c.instance)}">
              <p class="field__error" id="waInstance-err"></p>
            </div>
            <div class="field">
              <label for="waKey">API key</label>
              <div class="input-icon input-icon--action input-icon--none">
                <input class="input mono" id="waKey" name="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="${c.hasKey ? `Guardada (${esc(c.keyHint)}) — escribe otra para cambiarla` : 'Pega aquí la API key'}">
                <button type="button" class="input-action" id="waKeyShow" aria-label="Mostrar API key" aria-pressed="false">${ICONS.eye}</button>
              </div>
              <p class="field__help">${c.hasKey ? 'Déjala en blanco para conservar la guardada.' : 'La encuentras en la configuración de tu servidor de Evolution API.'}</p>
              <p class="field__error" id="waKey-err"></p>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="waVersion">Versión de la API</label>
              <select class="input" id="waVersion" name="apiVersion">
                <option value="v2" ${c.apiVersion !== 'v1' ? 'selected' : ''}>Evolution API v2</option>
                <option value="v1" ${c.apiVersion === 'v1' ? 'selected' : ''}>Evolution API v1</option>
              </select>
            </div>
            <div class="field">
              <label for="waCountry">Clave de país</label>
              <div class="input-prefix"><span>+</span><input class="input" id="waCountry" name="countryCode" inputmode="numeric" maxlength="4" value="${esc(c.countryCode)}"></div>
              <p class="field__help">Se antepone a los teléfonos de 10 dígitos (México: 52).</p>
              <p class="field__error" id="waCountry-err"></p>
            </div>
          </div>
          <label class="switch">
            <input type="checkbox" id="waEnabled" name="enabled" ${c.enabled ? 'checked' : ''}>
            <span class="switch__track" aria-hidden="true"><span></span></span>
            <span><strong>Activar envío de códigos por WhatsApp</strong><span class="muted-block">Muestra "¿Olvidaste tu contraseña?" en la pantalla de acceso.</span></span>
          </label>
          <p class="field__error" id="waEnabled-err"></p>
          <p class="form-error" id="waErr" role="alert"></p>
          <div class="form-actions form-actions--split">
            <button class="btn btn--secondary" type="button" id="waTest">${I.plug}<span>Probar conexión</span></button>
            <button class="btn" type="submit">Guardar</button>
          </div>
        </form>
      </section>

      <section class="card" aria-labelledby="waStT">
        <header class="dash-card__head"><h3 id="waStT">Estado</h3></header>
        <div class="wa-status" id="waStatus" aria-live="polite">
          <span class="wa-status__dot ${c.listo ? 'is-on' : ''}"></span>
          <span>${c.listo ? 'Envío activado' : c.enabled ? 'Configuración incompleta' : 'Envío desactivado'}</span>
        </div>
        <p class="dash-note" id="waConn">Usa "Probar conexión" para verificar que la instancia está conectada a WhatsApp.</p>

        <div class="wa-testmsg">
          <h4>Mensaje de prueba</h4>
          <div class="field">
            <label for="waPhone">Teléfono (10 dígitos)</label>
            <input class="input" id="waPhone" type="tel" inputmode="numeric" maxlength="14" autocomplete="off" placeholder="9931234567">
            <p class="field__error" id="waPhone-err"></p>
          </div>
          <button class="btn btn--secondary" type="button" id="waSend">${I.send}<span>Enviar mensaje de prueba</span></button>
          <p class="field__help">Se envía con los datos del formulario, aunque aún no los hayas guardado.</p>
        </div>
      </section>
    </div>`;
}

export function mountConfiguracionSA(root, route) {
  // ---------- Pestañas (con flechas del teclado) ----------
  const tabs = [...root.querySelectorAll('[data-tab]')];
  const select = (key, focus = false) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    root.querySelectorAll('.tabs__panel').forEach((p) => (p.hidden = p.id !== `panel-${key}`));
    history.replaceState(null, '', `/configuracion?tab=${key}`);
  };
  root.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) select(t.dataset.tab);
  });
  root.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    select(next.dataset.tab, true);
  });

  mountWhatsapp(root, route);
  mountGeneral(root);
  return undefined;
}

function mountWhatsapp(root, route) {
  const form = $('#waForm', root);
  const setErrors = fieldErrorSetter(root, { url: 'waUrl', instance: 'waInstance', apiKey: 'waKey', countryCode: 'waCountry', phone: 'waPhone' });
  const datos = () => ({
    url: $('#waUrl', root).value.trim(),
    instance: $('#waInstance', root).value.trim(),
    apiKey: $('#waKey', root).value.trim(),
    apiVersion: $('#waVersion', root).value,
    countryCode: $('#waCountry', root).value.trim(),
    enabled: $('#waEnabled', root).checked,
  });
  const clearMsgs = () => {
    setErrors();
    $('#waErr', root).textContent = '';
    $('#waEnabled-err', root).textContent = '';
  };
  const showErr = (err) => {
    if (err.data?.fields) {
      setErrors(err.data.fields);
      if (err.data.fields.enabled) $('#waEnabled-err', root).textContent = err.data.fields.enabled;
    } else $('#waErr', root).textContent = err.message;
  };

  $('#waKeyShow', root).addEventListener('click', (e) => {
    const k = $('#waKey', root);
    const show = k.type === 'password';
    k.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.setAttribute('aria-label', show ? 'Ocultar API key' : 'Mostrar API key');
  });

  const busy = async (btn, label, fn) => {
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = label;
    try {
      await fn();
    } finally {
      btn.disabled = false;
      btn.innerHTML = html;
    }
  };

  $('#waTest', root).addEventListener('click', (e) =>
    busy(e.currentTarget, 'Probando…', async () => {
      clearMsgs();
      const conn = $('#waConn', root);
      try {
        const r = await api('/api/configuracion/whatsapp/probar', { method: 'POST', body: datos() });
        conn.innerHTML = r.conectado
          ? '<strong>Conexión correcta:</strong> la instancia está conectada a WhatsApp.'
          : `<strong>El servidor respondió</strong>, pero la instancia no está conectada a WhatsApp (estado: ${esc(r.state)}). Escanea el código QR en Evolution API.`;
        conn.classList.toggle('is-ok', r.conectado);
        conn.classList.toggle('is-bad', !r.conectado);
      } catch (err) {
        if (err.data?.fields) return showErr(err);
        conn.innerHTML = `<strong>Sin conexión:</strong> ${esc(err.message)}`;
        conn.classList.remove('is-ok');
        conn.classList.add('is-bad');
      }
    })
  );

  $('#waSend', root).addEventListener('click', (e) =>
    busy(e.currentTarget, 'Enviando…', async () => {
      clearMsgs();
      try {
        await api('/api/configuracion/whatsapp/mensaje-prueba', { method: 'POST', body: { ...datos(), phone: $('#waPhone', root).value } });
        toast('Mensaje de prueba enviado');
      } catch (err) {
        if (err.data?.fields) showErr(err);
        else toast(err.message);
      }
    })
  );

  // Guardar: confirmación con contraseña
  const dlg = $('#waDialog', root);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearMsgs();
    const me = route.data.confirm;
    dlg.innerHTML = `
      <form class="dialog__body" id="waConfirm" novalidate>
        <div class="dialog__head"><h3 id="waDlgT">Guardar configuración</h3>
          <button class="icon-btn icon-btn--always" type="button" data-close aria-label="Cerrar">${ICONS.close}</button></div>
        <p class="dialog__meta">El cambio quedará registrado en la bitácora. La API key no se guarda en la bitácora.</p>
        ${
          me.hasPassword
            ? `<div class="field">
                <label for="waPass">Escribe tu contraseña para confirmar</label>
                <input class="input" id="waPass" type="password" autocomplete="current-password" required>
                <p class="field__error" id="waPass-err"></p>
              </div>
              <p class="form-error" id="waDlgErr" role="alert"></p>
              <div class="dialog__actions">
                <button class="btn btn--secondary" type="button" data-close>Cancelar</button>
                <button class="btn" type="submit">Guardar</button>
              </div>`
            : `<div class="notice">${ICONS.alert}<div>Para guardar necesitas una contraseña. Créala en <a href="/perfil" data-link>Mi perfil</a>.</div></div>
              <div class="dialog__actions"><button class="btn btn--secondary" type="button" data-close>Cerrar</button></div>`
        }
      </form>`;
    dlg.onclick = (ev) => {
      if (ev.target.closest('[data-close]') || ev.target.closest('a[data-link]')) dlg.close();
    };
    $('#waConfirm', dlg).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pass = $('#waPass', dlg);
      const btn = ev.target.querySelector('[type="submit"]');
      $('#waPass-err', dlg).textContent = '';
      $('#waDlgErr', dlg).textContent = '';
      if (!pass.value) {
        $('#waPass-err', dlg).textContent = 'Escribe tu contraseña.';
        return pass.focus();
      }
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        const r = await api('/api/configuracion/whatsapp', { method: 'PUT', body: { ...datos(), password: pass.value } });
        dlg.close();
        route.data = { ...route.data, ...r };
        toast('Configuración de WhatsApp guardada');
        $('#panel-whatsapp', root).innerHTML = panelWhatsapp(route.data);
        mountWhatsapp(root, route);
      } catch (err) {
        if (err.data?.fields?.password) {
          $('#waPass-err', dlg).textContent = err.data.fields.password;
          pass.select();
        } else {
          dlg.close();
          showErr(err);
        }
        btn.disabled = false;
        btn.textContent = 'Guardar';
      }
    });
    abrirEnArea(dlg);
    $('#waPass', dlg)?.focus();
  });
}
