// Eliminación de una cuenta. Dos caminos (en ambos se confirma con la contraseña):
//  · Transferir sus dependientes a otra cuenta del mismo nivel y superior, y eliminar solo esa cuenta.
//  · Respaldo obligatorio y borrado de toda la rama, incluidos sus promovidos.
import { icon, ICONS, $, esc, fmtNum, api, toast, abrirEnArea } from './lib.js';

const I = {
  shield: icon('<path d="M12 3 4 6v6c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  download: icon('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  check: icon('<path d="m5 12 5 5L20 7"/>'),
};

// Descarga el respaldo (.zip) respetando el nombre de archivo que propone el servidor
export async function downloadBackup(userId) {
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
  const destinos = summary.destinos || [];
  const rol = esc(summary.user.roleName);
  let backupFile = null;
  let modo = null;

  const passwordBlock = (btnLabel, extra = '') => {
    if (!me.confirm.hasPassword) {
      return `<div class="notice">${ICONS.alert}<div>Para eliminar cuentas necesitas una contraseña. Créala en <a href="/perfil" data-link data-del="close">Mi perfil</a> y vuelve a intentarlo.</div></div>
        <div class="dialog__actions"><button class="btn btn--secondary" type="button" data-del="close">Cerrar</button></div>`;
    }
    return `
      <form class="del__form" id="delForm" novalidate>
        ${extra}
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

  const promTxt = summary.promovidos ? ` y <strong>${fmtNum(summary.promovidos)} ${summary.promovidos === 1 ? 'promovido' : 'promovidos'}</strong>` : '';
  const cerrar = `<button class="icon-btn icon-btn--always" type="button" data-del="close" aria-label="Cerrar">${ICONS.close}</button>`;
  const steps = {
    // 1) Qué pasa con sus dependientes
    intro: () => `
      <div class="dialog__body">
        <div class="dialog__head"><h3 id="delTitle">Eliminar a ${who}</h3>${cerrar}</div>
        <p class="del__role">${rol}</p>
        <p>Depende${total === 1 ? '' : 'n'} de esta cuenta:</p>
        ${nivelesText(summary)}
        ${summary.promovidos ? `<p class="del__prom">Su rama tiene <strong>${fmtNum(summary.promovidos)} ${summary.promovidos === 1 ? 'promovido' : 'promovidos'}</strong>.</p>` : ''}
        <p><strong>¿Qué hacemos con sus dependientes?</strong></p>
        <div class="del__opciones">
          ${
            destinos.length && total
              ? `<button class="del__op" type="button" data-del="transferir">${I.shield}<span><strong>Transferirlos a otro ${rol}</strong><small>Sus dependientes${promTxt.replace(/<[^>]+>/g, '')} pasan a quien elijas. Solo se elimina ${who}.</small></span></button>`
              : ''
          }
          <button class="del__op del__op--danger" type="button" data-del="borrar">${ICONS.trash}<span><strong>Respaldar y eliminar toda la rama</strong><small>Se descarga un respaldo (obligatorio) y después se borran la cuenta, sus dependientes y sus promovidos.</small></span></button>
        </div>
        <div class="dialog__actions"><button class="btn btn--secondary" type="button" data-del="close">Cancelar</button></div>
      </div>`,

    // 2a) Transferir a otra cuenta del mismo nivel
    transferir: () => `
      <div class="dialog__body">
        <div class="dialog__head"><h3 id="delTitle">Transferir y eliminar a ${who}</h3>${cerrar}</div>
        <p>Sus ${fmtNum(total)} cuenta${total === 1 ? '' : 's'} dependiente${total === 1 ? '' : 's'}${promTxt}${summary.user.role === 'coord_zona' ? ', sus secciones y su material' : ''} pasarán a:</p>
        ${passwordBlock(
          'Transferir y eliminar',
          `<div class="field"><label for="delDestino">${rol} que los recibe</label>
            <select class="input" id="delDestino" required><option value="">Elige…</option>${destinos
              .map((d) => `<option value="${d.id}">${esc(d.name)}${d.zona ? ` · ${esc(d.zona)}` : ''}</option>`)
              .join('')}</select><p class="field__error" id="delDestino-err"></p></div>`
        )}
        <p class="del__back"><button type="button" class="link-btn" data-del="volver">Volver</button></p>
      </div>`,

    // 2b) Respaldo obligatorio y borrado de toda la rama
    borrar: () => `
      <div class="dialog__body">
        <div class="dialog__head"><h3 id="delTitle">Eliminar a ${who} y toda su rama</h3>${cerrar}</div>
        <div class="notice notice--danger">${ICONS.alert}<div><strong>Esta acción no se podrá deshacer.</strong><br>
          Se borrarán ${who}${total ? `, sus ${fmtNum(total)} cuenta${total === 1 ? '' : 's'} dependiente${total === 1 ? '' : 's'}` : ''}${promTxt}.</div></div>
        ${
          backupFile
            ? `<div class="notice notice--ok">${I.check}<div><strong>Respaldo descargado.</strong><br><span class="mono">${esc(backupFile)}</span></div></div>
               ${passwordBlock('Eliminar todo')}`
            : `<p><strong>Paso 1:</strong> descarga el respaldo (obligatorio). Incluye las cuentas y los promovidos de la rama.</p>
               <p class="form-error" id="delErr" role="alert"></p>
               <div class="del__choices"><button class="btn" type="button" data-del="backup">${I.download}<span>Descargar respaldo</span></button></div>`
        }
        <p class="del__back"><button type="button" class="link-btn" data-del="volver">Volver</button></p>
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
      const body = { password: pass.value, modo };
      if (modo === 'transferir') {
        body.destinoId = $('#delDestino', dlg).value;
        if (!body.destinoId) {
          $('#delDestino-err', dlg).textContent = 'Elige a quién se transfieren.';
          btn.disabled = false;
          btn.textContent = label;
          return;
        }
      }
      const res = await api(`/api/users/${user.id}`, { method: 'DELETE', body });
      dlg.close();
      toast(
        modo === 'transferir'
          ? `Se transfirieron los dependientes y se eliminó ${summary.user.name}`
          : `Se eliminó ${summary.user.name}${res.removed > 1 ? ` y ${fmtNum(res.removed - 1)} cuenta${res.removed - 1 === 1 ? '' : 's'}` : ''}${res.promovidos ? ` y ${fmtNum(res.promovidos)} promovidos` : ''}`
      );
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
    if (action === 'volver') show('intro');
    if (action === 'transferir' || action === 'borrar') {
      modo = action === 'transferir' ? 'transferir' : 'eliminar';
      show(action);
    }
    if (action === 'backup') {
      const btn = e.target.closest('[data-del]');
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'Preparando respaldo…';
      try {
        backupFile = await downloadBackup(user.id);
        show('borrar');
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
