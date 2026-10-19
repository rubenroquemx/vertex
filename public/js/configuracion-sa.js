// Configuración del Super administrador: pestañas "WhatsApp (Evolution API)", "Cotizador" y "General".
import { icon, ICONS, $, esc, fmtNum, fmtDateTime, api, fieldErrorSetter, toast, abrirEnArea, navigate } from './lib.js';

const TABS = [
  { key: 'whatsapp', name: 'WhatsApp (Evolution API)' },
  { key: 'costos', name: 'Cotizador' },
  { key: 'general', name: 'General' },
];
const I = {
  plug: icon('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>'),
  send: icon('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
};

export async function viewConfiguracionSA(route) {
  const [wa, aviso, ejemplo, cz, gen] = await Promise.all([api('/api/configuracion/whatsapp'), api('/api/privacidad'), api('/api/configuracion/ejemplo'), api('/api/configuracion/costos'), api('/api/configuracion/generador')]);
  route.data = wa;
  route.costos = cz;
  route.gen = gen;
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
    <section class="tabs__panel" role="tabpanel" id="panel-costos" aria-labelledby="tab-costos" ${route.tab === 'costos' ? '' : 'hidden'}>${panelCostos(route.costos)}</section>
    <section class="tabs__panel" role="tabpanel" id="panel-general" aria-labelledby="tab-general" ${route.tab === 'general' ? '' : 'hidden'}>${panelGeneral(aviso, ejemplo)}${panelGenerador(route.gen)}</section>
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
  mountCostos(root, route);
  mountGenerador(root, route);
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

// ---------- Cotizador: parámetros del precio y enlace semi público ----------
const TIPOS_CZ = { estatal: 'Estatal', federal: 'Diputación federal', local: 'Diputación local', municipal: 'Municipal' };
const MXN = (n) => `$${fmtNum(Math.round(n))}`;
// Territorios de muestra para ver el efecto de los parámetros (lista nominal aproximada)
const MUESTRA = [
  ['Estado grande', 12700000],
  ['Referencia', null],
  ['Estado mediano', 1800000],
  ['Estado chico', 580000],
  ['Distrito federal típico', 330000],
  ['Municipio mediano', 100000],
  ['Municipio chico', 20000],
];

function panelCostos(d) {
  const c = d.config;
  const enlace = c.token ? `${location.origin}/costos/${c.token}` : '';
  const campo = (id, label, valor, ayuda = '', extra = 'inputmode="decimal"') => `
    <div class="field">
      <label for="cz_${id}">${label}</label>
      <input class="input" id="cz_${id}" name="${id}" ${extra} value="${esc(valor)}">
      ${ayuda ? `<p class="field__help">${ayuda}</p>` : ''}
      <p class="field__error" id="cz_${id}-err"></p>
    </div>`;
  const filas = MUESTRA.map(([n, ln]) => {
    const l = ln ?? c.anclaLn;
    const mens = Math.ceil((c.anclaPrecio * (l / c.anclaLn) ** c.exponente) / c.mesesRef / c.redondeo) * c.redondeo;
    const total = c.instalacion + mens * c.mesesRef;
    return `<tr><td>${esc(ln ? n : c.anclaNombre)}</td><td class="num">${fmtNum(l)}</td><td class="num">${MXN(total)}</td><td class="num">$${((mens * c.mesesRef) / l).toFixed(2)}</td></tr>`;
  }).join('');
  return `
    <div class="cfg-grid">
      <form class="card form-card" id="czForm" novalidate aria-labelledby="czT">
        <header class="form-card__head">
          <span class="form-card__icon" aria-hidden="true">${ICONS.alert}</span>
          <h3 id="czT">Precio por campaña</h3>
          <span class="form-card__aside">${d.actualizado ? `Actualizado ${esc(fmtDateTime(d.actualizado.at))}${d.actualizado.by ? ` · ${esc(d.actualizado.by)}` : ''}` : 'Valores iniciales'}</span>
        </header>
        <p class="units__help">Operación de la campaña = precio de referencia × (lista nominal ÷ lista de referencia)<sup>exponente</sup> × factor del tipo. Se cobra en mensualidades por adelantado, más la instalación. Precios sin IVA.</p>
        <div class="field-row">
          ${campo('anclaNombre', 'Territorio de referencia', c.anclaNombre, '', 'autocomplete="off"')}
          ${campo('anclaLn', 'Su lista nominal', fmtNum(c.anclaLn), '', 'inputmode="numeric"')}
        </div>
        <div class="field-row">
          ${campo('anclaPrecio', 'Precio de la campaña completa (sin IVA)', fmtNum(c.anclaPrecio), '', 'inputmode="numeric"')}
          ${campo('mesesRef', 'Meses de la campaña completa', c.mesesRef, 'La mensualidad es el precio entre estos meses.', 'inputmode="numeric"')}
        </div>
        <div class="field-row">
          ${campo('exponente', 'Exponente de proporcionalidad', c.exponente, '1 = proporcional directo; 0.8 = los territorios chicos pagan más por ciudadano.')}
          ${campo('instalacion', 'Instalación', fmtNum(c.instalacion), '', 'inputmode="numeric"')}
        </div>
        <div class="field-row">
          <div class="field"><label for="cz_fechaFin">Cierre del servicio</label><input class="input" id="cz_fechaFin" type="date" value="${esc(c.fechaFin)}"><p class="field__error" id="cz_fechaFin-err"></p></div>
          ${campo('minMeses', 'Mínimo de meses', c.minMeses, '', 'inputmode="numeric"')}
        </div>
        <div class="field-row">
          ${campo('iva', 'IVA (%)', c.iva, 'Se muestra aparte del precio.')}
          <div class="field"><label for="cz_redondeo">Redondear la mensualidad a</label>
            <select class="input" id="cz_redondeo">${[1, 10, 100, 1000].map((r) => `<option value="${r}" ${c.redondeo === r ? 'selected' : ''}>${r === 1 ? 'Sin redondeo' : `$${fmtNum(r)}`}</option>`).join('')}</select></div>
        </div>
        <fieldset class="cz-factores">
          <legend>Factor por tipo de elección</legend>
          <div class="field-row field-row--4">
            ${Object.entries(TIPOS_CZ).map(([k, n]) => campo(`factor_${k}`, n, c.factores[k])).join('')}
          </div>
        </fieldset>
        <p class="form-error" id="czErr" role="alert"></p>
        <div class="mat-form__acc"><button class="btn" type="submit">Guardar</button></div>
      </form>

      <div class="cz-side">
        <section class="card" aria-labelledby="czLinkT">
          <header class="dash-card__head"><h3 id="czLinkT">Enlace del cotizador</h3></header>
          <p class="dash-note">Solo quien tenga el enlace puede abrir el cotizador, sin iniciar sesión. Si lo regeneras, el anterior deja de funcionar.</p>
          ${
            enlace
              ? `<div class="cz-link"><input class="input mono" id="czLink" readonly value="${esc(enlace)}" aria-label="Enlace del cotizador">
                  <button class="btn btn--secondary" type="button" id="czCopiar">Copiar</button></div>
                <div class="cz-link__acc"><a class="btn btn--secondary btn--sm" href="${esc(enlace)}" target="_blank" rel="noopener">Abrir</a>
                  <button class="btn btn--secondary btn--sm btn--danger" type="button" id="czRegen">Regenerar enlace</button></div>`
              : '<button class="btn" type="button" id="czRegen">Crear enlace</button>'
          }
        </section>
        <section class="card" aria-labelledby="czPrevT">
          <header class="dash-card__head"><h3 id="czPrevT">Así quedan los precios</h3></header>
          <p class="dash-note">Campaña completa (${esc(String(c.mesesRef))} meses), tipo estatal, con los valores guardados.</p>
          <div class="table-wrap"><table class="table cz-prev"><thead><tr><th scope="col">Territorio</th><th scope="col" class="num">Lista nominal</th><th scope="col" class="num">Total sin IVA</th><th scope="col" class="num">Por ciudadano</th></tr></thead>
          <tbody>${filas}</tbody></table></div>
          ${d.territorios.length ? `<p class="dash-note">${d.territorios.length === 32 ? 'Las 32 entidades tienen padrón cargado' : `${fmtNum(d.territorios.length)} de 32 entidades con padrón cargado; las demás se cotizan capturando la lista nominal`}.</p>` : '<p class="dash-note">No hay padrón cargado: el cotizador pedirá capturar la lista nominal.</p>'}
        </section>
      </div>
    </div>`;
}

function mountCostos(root, route) {
  const form = $('#czForm', root);
  if (!form) return;
  const ids = ['anclaNombre', 'anclaLn', 'anclaPrecio', 'mesesRef', 'exponente', 'instalacion', 'fechaFin', 'minMeses', 'iva', 'factor_estatal', 'factor_federal', 'factor_local', 'factor_municipal'];
  const setErrors = fieldErrorSetter(root, Object.fromEntries(ids.map((k) => [k, `cz_${k}`])));
  const val = (k) => $(`#cz_${k}`, root).value.trim();
  const recargar = (d) => {
    route.costos = { ...route.costos, ...d };
    $('#panel-costos', root).innerHTML = panelCostos(route.costos);
    mountCostos(root, route);
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setErrors();
    $('#czErr', root).textContent = '';
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const body = {
        anclaNombre: val('anclaNombre'),
        anclaLn: val('anclaLn'),
        anclaPrecio: val('anclaPrecio'),
        mesesRef: val('mesesRef'),
        exponente: val('exponente').replace(',', '.'),
        instalacion: val('instalacion'),
        fechaFin: val('fechaFin'),
        minMeses: val('minMeses'),
        iva: val('iva'),
        redondeo: Number($('#cz_redondeo', root).value),
        factores: Object.fromEntries(Object.keys(TIPOS_CZ).map((k) => [k, val(`factor_${k}`).replace(',', '.')])),
      };
      const r = await api('/api/configuracion/costos', { method: 'PUT', body });
      toast('Precios del cotizador guardados');
      recargar(r);
    } catch (err) {
      if (err.data?.fields) setErrors(err.data.fields);
      else $('#czErr', root).textContent = err.message;
      btn.disabled = false;
    }
  });
  $('#czCopiar', root)?.addEventListener('click', async () => {
    const i = $('#czLink', root);
    try {
      await navigator.clipboard.writeText(i.value);
    } catch {
      i.select();
      document.execCommand('copy');
    }
    toast('Enlace copiado');
  });
  $('#czRegen', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    // Regenerar invalida el enlace anterior: dos toques
    if (route.costos.config.token && !b.dataset.confirmar) {
      b.dataset.confirmar = '1';
      b.textContent = '¿Seguro? El enlace actual dejará de funcionar';
      return;
    }
    b.disabled = true;
    try {
      recargar(await api('/api/configuracion/costos/enlace', { method: 'POST' }));
      toast('Enlace listo');
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  });
}

// ---------- Generador de estructura (servidor de demostración) ----------
function panelGenerador(g) {
  const disponibles = g.cpvs.filter((c) => !c.tieneZonas);
  const lotes = [...g.lotes].reverse();
  return `
    <section class="card form-card gen" id="genCard" aria-labelledby="genT">
      <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.users}</span><h3 id="genT">Generar estructura de demostración</h3></header>
      <p>Arma la estructura completa de un Coordinador de Promoción del Voto que aún no tiene zonas: reparte su territorio en zonas con su coordinador y crea responsables de sección, promotores y promovidos (con revisiones y observaciones) hasta el porcentaje de su meta que indiques. Se registran como datos normales; cada carga se puede eliminar completa desde aquí.</p>
      <div class="field gen__pass"><label for="genPass">Tu contraseña para confirmar</label>
        <input class="input" id="genPass" type="password" autocomplete="current-password"><p class="field__error" id="genPass-err"></p></div>
      ${
        disponibles.length
          ? `<form id="genForm" novalidate class="gen__form">
              <div class="field-row">
                <div class="field"><label for="genCpv">Coordinador de Promoción del Voto</label>
                  <select class="input" id="genCpv">${disponibles.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.territorio ? ` · ${esc(c.territorio)}` : ''}</option>`).join('')}</select>
                  <p class="field__error" id="genCpv-err"></p></div>
                <div class="field"><label for="genPct">Avance de la meta (%)</label>
                  <input class="input" id="genPct" inputmode="numeric" value="20">
                  <p class="field__error" id="genPct-err"></p></div>
              </div>
              <p class="form-error" id="genErr" role="alert"></p>
              <div class="mat-form__acc"><button class="btn" type="submit">Generar estructura</button></div>
            </form>`
          : '<p class="muted">Todos los Coordinadores de Promoción del Voto ya tienen zonas. El generador solo trabaja con cuentas sin estructura.</p>'
      }
      <div id="genRes" aria-live="polite"></div>
      ${
        lotes.length
          ? `<h4 class="gen__sub">Cargas generadas</h4>
            <ul class="gen__lotes">${lotes
              .map(
                (l) => `<li>
                  <div><strong>${esc(l.cpv)}</strong> · ${fmtNum(l.porcentaje)} % de ${fmtNum(l.meta)}
                    <span class="muted-block">${esc(fmtDateTime(l.at))} · ${fmtNum(l.conteo.zonas)} zonas · ${fmtNum(l.conteo.responsables)} responsables · ${fmtNum(l.conteo.promotores)} promotores · ${fmtNum(l.conteo.promovidos)} promovidos</span></div>
                  <button class="btn btn--secondary btn--sm btn--danger" type="button" data-eliminar="${esc(l.id)}">Eliminar carga</button>
                </li>`
              )
              .join('')}</ul>
            <p class="field__help">Para eliminar una carga escribe tu contraseña en el campo de arriba. Se borran sus cuentas y promovidos; lo capturado por personas no se toca.</p>`
          : ''
      }
    </section>`;
}

function mountGenerador(root, route) {
  const card = $('#genCard', root);
  if (!card) return;
  const setErrors = fieldErrorSetter(root, { cpvId: 'genCpv', porcentaje: 'genPct', password: 'genPass' });
  const recargar = async () => {
    route.gen = await api('/api/configuracion/generador');
    const res = $('#genRes', root).innerHTML;
    card.outerHTML = panelGenerador(route.gen);
    $('#genRes', root).innerHTML = res;
    mountGenerador(root, route);
  };
  const form = $('#genForm', root);
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setErrors();
    $('#genErr', root).textContent = '';
    const pass = $('#genPass', root);
    if (!pass.value) return setErrors({ password: 'Escribe tu contraseña.' });
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Generando… puede tardar un minuto';
    try {
      const r = await api('/api/configuracion/generador', { method: 'POST', body: { cpvId: $('#genCpv', root).value, porcentaje: $('#genPct', root).value, password: pass.value } });
      const c = r.conteo;
      $('#genRes', root).innerHTML = `<div class="notice notice--ok">${ICONS.check || ''}<div>
          <strong>Estructura de ${esc(r.cpv)} lista</strong>: ${fmtNum(c.zonas)} zonas, ${fmtNum(c.responsables)} responsables de sección, ${fmtNum(c.promotores)} promotores y ${fmtNum(c.promovidos)} promovidos (${fmtNum(c.validado)} aprobados, ${fmtNum(c.en_revision + c.observaciones)} en revisión, ${fmtNum(c.rechazado)} rechazados) · ${fmtNum(r.porcentaje)} % de una meta de ${fmtNum(r.meta)}.
          <br>Todas las cuentas nuevas usan la contraseña <code class="mono" id="genClave">${esc(r.password)}</code> <button class="btn btn--secondary btn--sm" type="button" id="genCopiar">Copiar</button>. Guárdala: no se vuelve a mostrar.</div></div>`;
      $('#genCopiar', root)?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(r.password);
          toast('Contraseña copiada');
        } catch {}
      });
      toast('Estructura generada');
      await recargar();
    } catch (err) {
      if (err.data?.fields) setErrors(err.data.fields);
      else $('#genErr', root).textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Generar estructura';
    }
  });
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-eliminar]');
    if (!b) return;
    const pass = $('#genPass', root);
    if (!pass?.value) {
      setErrors({ password: 'Escribe tu contraseña para eliminar la carga.' });
      return pass?.focus();
    }
    // Dos toques: el primero pide confirmar
    if (!b.dataset.confirmar) {
      b.dataset.confirmar = '1';
      b.textContent = '¿Seguro? Toca de nuevo para eliminar';
      return;
    }
    b.disabled = true;
    try {
      await api(`/api/configuracion/generador/${encodeURIComponent(b.dataset.eliminar)}/eliminar`, { method: 'POST', body: { password: pass.value } });
      toast('Carga eliminada');
      $('#genRes', root).innerHTML = '';
      await recargar();
    } catch (err) {
      if (err.data?.fields) setErrors(err.data.fields);
      else toast(err.message);
      b.disabled = false;
    }
  });
}
