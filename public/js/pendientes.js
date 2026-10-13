// Promovidos guardados en el teléfono (capturados sin internet) que aún no se envían.
import { ICONS, $, esc, fmtNum, fmtDateTime, toast, navigate } from './lib.js';
import { pendientes, sesion, sincronizar, estadoSync, borrarDatosLocales } from './offline.js';

const ESTADO = {
  pendiente: { t: 'Por enviar', clase: 'is-revision' },
  enviando: { t: 'Enviando…', clase: 'is-revision' },
  error: { t: 'Con error', clase: 'is-observaciones' },
};

export async function viewPendientes() {
  const lista = await pendientes.todos(sesion.userId);
  const salir = new URLSearchParams(location.search).has('salir');
  const conError = lista.filter((p) => p.estado === 'error').length;
  const { sesionVencida } = estadoSync();
  return `
    <div class="pend">
      ${
        salir && lista.length
          ? `<div class="notice notice--error">${ICONS.alert}<div>
              <strong>Tienes ${fmtNum(lista.length)} ${lista.length === 1 ? 'promovido' : 'promovidos'} sin enviar.</strong>
              Si cierras sesión ahora se borrarán de tu teléfono. Conéctate a internet y envíalos primero.
              <div class="pend__salir"><button class="btn btn--destructive btn--sm" type="button" id="pendSalir">Cerrar sesión y borrarlos</button></div>
            </div></div>`
          : ''
      }
      <section class="pend-head card">
        <div>
          <p class="pend-head__n"><strong>${fmtNum(lista.length)}</strong> ${lista.length === 1 ? 'promovido guardado' : 'promovidos guardados'} en tu teléfono</p>
          <p class="muted" id="pendEstado">${
            !navigator.onLine
              ? 'Sin internet: se enviarán solos en cuanto recuperes la señal.'
              : sesionVencida
                ? 'Tu sesión venció: vuelve a iniciar sesión para enviarlos.'
                : lista.length
                  ? 'Con internet se envían solos; también puedes enviarlos ahora.'
                  : 'Todo está enviado.'
          }</p>
          ${conError ? `<p class="pend-err">${fmtNum(conError)} ${conError === 1 ? 'tiene' : 'tienen'} un error: corrígelos para enviarlos.</p>` : ''}
        </div>
        ${lista.length ? `<button class="btn" type="button" id="pendEnviar" ${navigator.onLine ? '' : 'disabled'}>${ICONS.upload}<span>Enviar ahora</span></button>` : ''}
      </section>
      ${
        lista.length
          ? `<ul class="promo-list pend-lista">${lista
              .map((p) => {
                const e = ESTADO[p.estado] || ESTADO.pendiente;
                return `<li class="promo-fila" data-id="${p.clientId}">
                  <div class="promo-item">
                    <span class="promo-ini ${e.clase}" aria-hidden="true">${esc((p.nombre || '?').split(' ').slice(0, 2).map((x) => x[0]).join(''))}</span>
                    <span class="promo-item__txt">
                      <strong>${esc(p.nombre)}</strong>
                      <span class="promo-item__mod">${e.t} · capturado el ${esc(fmtDateTime(p.creado))}</span>
                      ${p.error ? `<span class="pend-msg">${esc(p.error)}</span>` : ''}
                    </span>
                  </div>
                  <span class="pend-acc">
                    ${p.estado === 'error' ? `<a class="btn btn--sm" href="/promovidos/nuevo?pendiente=${p.clientId}" data-link>Corregir</a>` : ''}
                    <button class="btn btn--secondary btn--sm" type="button" data-descartar="${p.clientId}">Descartar</button>
                  </span>
                </li>`;
              })
              .join('')}</ul>`
          : `<div class="empty"><span aria-hidden="true">${ICONS.check}</span><strong>Nada pendiente</strong><span>Todo lo que capturaste ya está enviado.</span></div>`
      }
    </div>`;
}

export function mountPendientes(root) {
  $('#pendEnviar', root)?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const r = await sincronizar(sesion.userId);
    toast(r.enviados ? `${fmtNum(r.enviados)} ${r.enviados === 1 ? 'promovido enviado' : 'promovidos enviados'}` : r.errores ? 'Revisa los que tienen error' : 'No se pudo enviar; intenta más tarde.');
    navigate('/pendientes');
  });
  // Descartar en dos toques (sin ventanas modales)
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-descartar]');
    if (!b) return;
    if (!b.dataset.confirmar) {
      b.dataset.confirmar = '1';
      b.textContent = '¿Borrar? Toca de nuevo';
      b.classList.add('btn--destructive');
      return;
    }
    await pendientes.quitar(b.dataset.descartar);
    toast('Promovido descartado');
    navigate(location.pathname + location.search);
  });
  $('#pendSalir', root)?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    await borrarDatosLocales();
    localStorage.removeItem('vx:me');
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = '/';
  });
  // Se actualiza cuando se envía algo
  let t = null;
  const refrescar = () => {
    clearTimeout(t);
    t = setTimeout(() => !$('[data-confirmar]', root) && navigate(location.pathname + location.search), 600);
  };
  window.addEventListener('vx:pendientes', refrescar);
  return () => {
    clearTimeout(t);
    window.removeEventListener('vx:pendientes', refrescar);
  };
}
