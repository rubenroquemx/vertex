// Eliminación de una cuenta y toda su rama, con respaldo previo recomendado.
// Pasos: 1) recomendar respaldo → 2a) respaldo descargado: eliminar con seguridad
//                              → 2b) sin respaldo: advertencia de pérdida irreversible
// En ambos casos se confirma con la contraseña de quien inició sesión.
import { icon, ICONS, $, esc, fmtNum, api, toast, abrirEnArea } from './lib.js';

const I = {
  shield: icon('<path d="M12 3 4 6v6c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  download: icon('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  check: icon('<path d="m5 12 5 5L20 7"/>'),
};

// Descarga el respaldo (.zip) respetando el nombre de archivo que propone el servidor
async function downloadBackup(userId) {
  const res = await fetch(`/api/users/${userId}/backup`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo generar el respaldo.');
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'respaldo-vertex.zip';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}

const nivelesText = (s) =>
  s.subordinados
    ? `<ul class="del__levels">${s.porNivel.map((n) => `<li><strong>${fmtNum(n.count)}</strong> ${esc(n.count === 1 ? n.name : n.plural)}</li>`).join('')}</ul>`
    : '<p class="del__none">No tiene cuentas subordinadas.</p>';

/**
 * Abre el flujo de eliminación.
 * @param {{id: string, name: string}} user  cuenta a eliminar
 * @param {object} me                        respuesta de /api/me (para la confirmación)
 * @param {(removed: number) => void} onDeleted
 */
export async function openDeleteFlow(user, me, onDeleted) {
  let dlg = $('#deleteDialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'deleteDialog';
    dlg.className = 'dialog dialog--wide';
    dlg.setAttribute('aria-labelledby', 'delTitle');
    document.body.append(dlg);
  }

  let summary;
  try {
    summary = await api(`/api/users/${user.id}/branch`);
  } catch (err) {
    toast(err.message);
    return;
  }
  const total = summary.subordinados;
  const who = esc(summary.user.name);
  let backupFile = null;

  const passwordBlock = (btnLabel) => {
    if (!me.confirm.hasPassword) {
      return `<div class="notice">${ICONS.alert}<div>Para eliminar cuentas necesitas una contraseña. Créala en <a href="/perfil" data-link data-del="close">Mi perfil</a> y vuelve a intentarlo.</div></div>
        <div class="dialog__actions"><button class="btn btn--secondary" type="button" data-del="close">Cerrar</button></div>`;
    }
    return `
      <form class="del__form" id="delForm" novalidate>
        <div class="field">
          <label for="delPass">Escribe tu contraseña para confirmar${me.godMode ? ` <span class="legend-help">(la de ${esc(me.confirm.name)})</span>` : ''}</label>
          <input class="input" id="delPass" name="password" type="password" autocomplete="current-password" required>
          <p class="field__error" id="delPass-err"></p>
        </div>
        <p class="form-error" id="delErr" role="alert"></p>
        <div class="dialog__actions">
          <button class="btn btn--secondary" type="button" data-del="close">Cancelar</button>
          <button class="btn btn--destructive" type="submit">${btnLabel}</button>
        </div>
      </form>`;
  };

  const steps = {
    // 1) Recomendación de respaldo
    intro: () => `
      <div class="dialog__body">
        <div class="dialog__head"><h3 id="delTitle">Eliminar a ${who}</h3>
          <button class="icon-btn icon-btn--always" type="button" data-del="close" aria-label="Cerrar">${ICONS.close}</button></div>
        <p class="del__role">${esc(summary.user.roleName)}</p>
        <p>Se eliminará esta cuenta y <strong>toda su rama</strong>${total ? ` (${fmtNum(total)} cuenta${total === 1 ? '' : 's'} subordinada${total === 1 ? '' : 's'})` : ''}:</p>
        ${nivelesText(summary)}
        <div class="notice notice--info">${I.shield}<div><strong>Te recomendamos descargar un respaldo antes de eliminar.</strong><br>
          Incluye los datos de ${who} y de todos sus subordinados (lista en Excel, datos completos y fotos de perfil).</div></div>
        <p class="form-error" id="delErr" role="alert"></p>
        <div class="del__choices">
          <button class="btn" type="button" data-del="backup">${I.download}<span>Descargar respaldo</span></button>
          <button class="btn btn--secondary" type="button" data-del="skip">No respaldar</button>
        </div>
        <div class="dialog__actions"><button class="btn btn--secondary" type="button" data-del="close">Cancelar</button></div>
      </div>`,

    // 2a) Respaldo descargado: puede eliminar con seguridad
    safe: () => `
      <div class="dialog__body">
        <div class="dialog__head"><h3 id="delTitle">Eliminar a ${who}</h3>
          <button class="icon-btn icon-btn--always" type="button" data-del="close" aria-label="Cerrar">${ICONS.close}</button></div>
        <div class="notice notice--ok">${I.check}<div><strong>Respaldo descargado.</strong> Ya puedes eliminar con seguridad.<br>
          <span class="mono">${esc(backupFile)}</span></div></div>
        <p>Se eliminarán ${who}${total ? ` y sus ${fmtNum(total)} cuenta${total === 1 ? '' : 's'} subordinada${total === 1 ? '' : 's'}` : ''}.</p>
        ${passwordBlock('Eliminar')}
      </div>`,

    // 2b) Sin respaldo: advertencia irreversible
    danger: () => `
      <div class="dialog__body">
        <div class="dialog__head"><h3 id="delTitle">Eliminar sin respaldo</h3>
          <button class="icon-btn icon-btn--always" type="button" data-del="close" aria-label="Cerrar">${ICONS.close}</button></div>
        <div class="notice notice--danger">${ICONS.alert}<div><strong>Esta acción no se podrá deshacer.</strong><br>
          Se perderá toda la información de ${who}${total ? ` y los datos de sus ${fmtNum(total)} subordinado${total === 1 ? '' : 's'}` : ''}.</div></div>
        <p class="del__back">¿Prefieres conservar sus datos? <button type="button" class="link-btn" data-del="backup">Descargar respaldo</button></p>
        ${passwordBlock('Eliminar sin respaldo')}
      </div>`,
  };

  function show(step) {
    dlg.innerHTML = steps[step]();
    const pass = $('#delPass', dlg);
    if (pass) pass.focus();
    const form = $('#delForm', dlg);
    if (form) form.addEventListener('submit', (e) => confirmDelete(e, form));
  }

  async function confirmDelete(e, form) {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const label = btn.textContent;
    const pass = $('#delPass', dlg);
    $('#delPass-err', dlg).textContent = '';
    $('#delErr', dlg).textContent = '';
    if (!pass.value) {
      $('#delPass-err', dlg).textContent = 'Escribe tu contraseña.';
      pass.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Eliminando…';
    try {
      const res = await api(`/api/users/${user.id}`, { method: 'DELETE', body: { password: pass.value, backupDone: Boolean(backupFile) } });
      dlg.close();
      toast(`Se eliminó ${summary.user.name}${res.removed > 1 ? ` y ${fmtNum(res.removed - 1)} cuenta${res.removed - 1 === 1 ? '' : 's'} subordinada${res.removed - 1 === 1 ? '' : 's'}` : ''}`);
      onDeleted(res.removed);
    } catch (err) {
      if (err.data?.fields?.password) {
        $('#delPass-err', dlg).textContent = err.data.fields.password;
        pass.select();
      } else {
        $('#delErr', dlg).textContent = navigator.onLine ? err.message : 'Sin conexión. Intenta de nuevo cuando estés en línea.';
      }
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  dlg.onclick = async (e) => {
    const action = e.target.closest('[data-del]')?.dataset.del;
    if (!action) return;
    if (action === 'close') dlg.close();
    if (action === 'skip') show('danger');
    if (action === 'backup') {
      const btn = e.target.closest('[data-del]');
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'Preparando respaldo…';
      try {
        backupFile = await downloadBackup(user.id);
        show('safe');
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = original;
        const errEl = $('#delErr', dlg);
        if (errEl) errEl.textContent = err.message;
        else toast(err.message);
      }
    }
  };

  show('intro');
  abrirEnArea(dlg);
}
