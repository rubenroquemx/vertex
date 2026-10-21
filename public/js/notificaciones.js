// Notificaciones: campana de la barra superior (con contador) y su página en el área de trabajo.
import { $, esc, fmtDateTime, api, navigate } from './lib.js';

const ic = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONO = {
  'promovido.nuevo': ic('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M19 8v6M16 11h6"/>'),
  'promovido.editado': ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  'promovido.aprobado': ic('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  'promovido.rechazado': ic('<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>'),
  'material.orden': ic('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  'material.recibida': ic('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m9 12 2 2 4-4"/>'),
  'material.comprobada': ic('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/>'),
  'material.activacion': ic('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/>'),
  'promovido.observacion': ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
};
const CAMPANA = ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>');

// «hace 5 min», «hace 3 h»; después de un día, la fecha completa
function hace(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'Hace un momento';
  if (s < 3600) return `Hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
  return fmtDateTime(iso);
}

// ---------- Contador de la campana ----------
export function pintarContador(n) {
  const badge = $('#notifBadge');
  const link = $('#topNotif');
  if (!badge || !link) return;
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : String(n);
  // Con pendientes por ver la campana se pinta de rojo y se mueve
  link.classList.toggle('has-nuevas', Boolean(n));
  const txt = n ? `Notificaciones: ${n} sin leer` : 'Notificaciones';
  link.setAttribute('aria-label', txt);
  link.title = txt;
}

export async function actualizarContador() {
  if (document.hidden) return;
  try {
    const { noLeidas } = await api('/api/notificaciones/conteo');
    pintarContador(noLeidas);
  } catch {
    // Sin conexión o sin sesión: se conserva el último valor
  }
}

export function iniciarCampana() {
  const link = $('#topNotif');
  if (!link) return;
  link.innerHTML = `${CAMPANA}<span class="topbar__badge" id="notifBadge" hidden></span>`;
  actualizarContador();
  setInterval(actualizarContador, 30000);
  document.addEventListener('visibilitychange', actualizarContador);
}

// ---------- Página ----------
const item = (n) => `
  <li class="notif${n.leida ? '' : ' is-nueva'}">
    <button class="notif__btn" type="button" data-id="${n.id}" data-url="${esc(n.url || '')}">
      <span class="notif__ic" aria-hidden="true">${ICONO[n.tipo] || CAMPANA}</span>
      <span class="notif__txt">
        <strong>${esc(n.titulo)}</strong>
        ${n.cuerpo ? `<span class="notif__cuerpo">${esc(n.cuerpo)}</span>` : ''}
        <time class="notif__at" datetime="${n.at}">${esc(hace(n.at))}</time>
      </span>
      ${n.leida ? '' : '<span class="notif__punto" aria-hidden="true"></span><span class="sr-only">Sin leer</span>'}
    </button>
  </li>`;

const grupo = (titulo, lista) =>
  lista.length
    ? `<section class="notif-grupo"><h3 class="promo-grupo__titulo">${titulo}</h3><ul class="notif-lista">${lista.map(item).join('')}</ul></section>`
    : '';

export async function viewNotificaciones() {
  const { noLeidas, items } = await api('/api/notificaciones');
  pintarContador(noLeidas);
  if (!items.length) {
    return `<div class="empty">${CAMPANA}<strong>Sin notificaciones</strong><span>Aquí te avisaremos de lo que pase en tu equipo.</span></div>`;
  }
  return `
    ${noLeidas ? `<div class="notif-acciones"><button class="btn btn--secondary btn--sm" type="button" id="notifTodas">Marcar todas como leídas</button></div>` : ''}
    ${grupo('Nuevas', items.filter((n) => !n.leida))}
    ${grupo('Anteriores', items.filter((n) => n.leida))}`;
}

export function mountNotificaciones(root) {
  $('#notifTodas', root)?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const { noLeidas } = await api('/api/notificaciones/leidas', { method: 'POST' }).catch(() => ({ noLeidas: null }));
    if (noLeidas !== null) pintarContador(noLeidas);
    navigate('/notificaciones');
  });
  // #view se reutiliza entre páginas: el listener se quita al salir
  const onClick = async (e) => {
    const b = e.target.closest('.notif__btn');
    if (!b) return;
    const li = b.closest('.notif');
    if (li.classList.contains('is-nueva')) {
      const r = await api(`/api/notificaciones/${b.dataset.id}/leida`, { method: 'POST' }).catch(() => null);
      if (r) pintarContador(r.noLeidas);
    }
    if (b.dataset.url) navigate(b.dataset.url);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
