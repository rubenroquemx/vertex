// Configuración del Super administrador: pestañas "General" y "WhatsApp (Evolution API)".
import { icon, ICONS, $, esc, fmtDateTime, api, fieldErrorSetter, toast, abrirEnArea } from './lib.js';

const TABS = [
  { key: 'whatsapp', name: 'WhatsApp (Evolution API)' },
  { key: 'general', name: 'General' },
];
const I = {
  plug: icon('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>'),
  send: icon('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
};

export async function viewConfiguracionSA(route) {
  route.data = await api('/api/configuracion/whatsapp');
  const tab = new URLSearchParams(location.search).get('tab') || 'whatsapp';
  route.tab = TABS.some((t) => t.key === tab) ? tab : 'whatsapp';
  return `
    <div class="page-head">
      <h2>Configuración</h2>
      <p>Ajustes generales del sistema e integraciones.</p>
    </div>
    <div class="tabs" role="tablist" aria-label="Secciones de configuración">
      ${TABS.map(
        (t) => `<button type="button" role="tab" class="tabs__tab" id="tab-${t.key}" aria-controls="panel-${t.key}" aria-selected="${t.key === route.tab}" tabindex="${t.key === route.tab ? 0 : -1}" data-tab="${t.key}">${esc(t.name)}</button>`
      ).join('')}
    </div>
    <section class="tabs__panel" role="tabpanel" id="panel-whatsapp" aria-labelledby="tab-whatsapp" ${route.tab === 'whatsapp' ? '' : 'hidden'}>${panelWhatsapp(route.data)}</section>
    <section class="tabs__panel" role="tabpanel" id="panel-general" aria-labelledby="tab-general" ${route.tab === 'general' ? '' : 'hidden'}>
      ${panelCuentas()}
    </section>
    <dialog class="dialog" id="waDialog" aria-labelledby="waDlgT"></dialog>`;
}

// Reemplazar todas las cuentas con un archivo de `npm run exportar-cuentas`
function panelCuentas() {
  return `
    <section class="card form-card cfg-narrow" aria-labelledby="ccT">
      <header class="form-card__head">
        <span class="form-card__icon" aria-hidden="true">${ICONS.users}</span>
        <h3 id="ccT">Reemplazar cuentas</h3>
      </header>
      <p class="units__help">Carga las cuentas exportadas de otra instalación de VERTEX (comando <span class="mono">npm run exportar-cuentas</span>). Incluye usuarios, contraseñas y fotos de perfil de todos los niveles.</p>
      <div class="notice notice--danger">${ICONS.alert}<div><strong>Se borran todas las cuentas actuales</strong>, incluida la tuya, y se cierran todas las sesiones. Después entrarás con el usuario y la contraseña del Super administrador del archivo. Los promovidos, la cartografía, el padrón y la configuración no se tocan.</div></div>
      <form id="ccForm" novalidate>
        <div class="field">
          <label for="ccFile">Archivo de cuentas (.json)</label>
          <input class="input" id="ccFile" type="file" accept=".json,application/json">
          <p class="field__help" id="ccResumen"></p>
          <p class="field__error" id="ccFile-err"></p>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="ccConfirm">Escribe REEMPLAZAR</label>
            <input class="input mono" id="ccConfirm" name="confirmacion" autocomplete="off" autocapitalize="characters" spellcheck="false">
            <p class="field__error" id="ccConfirm-err"></p>
          </div>
          <div class="field">
            <label for="ccPass">Tu contraseña</label>
            <input class="input" id="ccPass" name="password" type="password" autocomplete="current-password">
            <p class="field__error" id="ccPass-err"></p>
          </div>
        </div>
        <p class="form-error" id="ccErr" role="alert"></p>
        <div class="form-actions">
          <button class="btn btn--destructive" type="submit" disabled>Reemplazar todas las cuentas</button>
        </div>
      </form>
    </section>`;
}

const NIVELES = {
  superadmin: 'Super admin',
  coord_promocion: 'CPV',
  coord_zona: 'Coord. de zona',
  resp_seccion: 'Resp. de sección',
  promotor: 'Promotores',
};

function mountCuentas(root) {
  const form = $('#ccForm', root);
  const btn = form.querySelector('[type="submit"]');
  const setErrors = fieldErrorSetter(root, { archivo: 'ccFile', confirmacion: 'ccConfirm', password: 'ccPass' });
  let archivo = null;
  const listo = () => (btn.disabled = !(archivo && $('#ccConfirm', root).value.trim().toUpperCase() === 'REEMPLAZAR' && $('#ccPass', root).value));
  $('#ccFile', root).addEventListener('change', async (e) => {
    archivo = null;
    $('#ccResumen', root).textContent = '';
    setErrors();
    const f = e.target.files?.[0];
    if (f) {
      try {
        const data = JSON.parse(await f.text());
        if (data.formato !== 'vertex-cuentas' || !Array.isArray(data.users)) throw new Error();
        archivo = data;
        const porRol = data.users.reduce((m, u) => ((m[u.role] = (m[u.role] || 0) + 1), m), {});
        $('#ccResumen', root).textContent =
          `${data.users.length} cuentas (${Object.entries(NIVELES).filter(([k]) => porRol[k]).map(([k, n]) => `${n}: ${porRol[k]}`).join(' · ')}), ` +
          `${(data.avatars || []).length} fotos · exportado el ${fmtDateTime(data.exportadoEn)}`;
      } catch {
        setErrors({ archivo: 'El archivo no es una exportación de cuentas de VERTEX.' });
      }
    }
    listo();
  });
  form.addEventListener('input', listo);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    setErrors();
    $('#ccErr', root).textContent = '';
    btn.disabled = true;
    btn.textContent = 'Reemplazando…';
    try {
      const r = await api('/api/configuracion/cuentas/importar', {
        method: 'POST',
        body: { archivo, confirmacion: $('#ccConfirm', root).value, password: $('#ccPass', root).value },
      });
      toast(`Listo: ${r.cuentas} cuentas cargadas. Inicia sesión con el Super administrador del archivo.`);
      setTimeout(() => (location.href = '/'), 1800);
    } catch (err) {
      if (err.data?.fields) setErrors(err.data.fields);
      else $('#ccErr', root).textContent = navigator.onLine ? err.message : 'Sin conexión.';
      btn.textContent = 'Reemplazar todas las cuentas';
      listo();
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
  mountCuentas(root);
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
