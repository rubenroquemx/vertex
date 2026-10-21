// Bandeja de revisión del Responsable de Sección: los promovidos que capturan sus promotores,
// por estatus (por revisar · rechazados · aprobados), con filtro por promotor y búsqueda.
import { ICONS, $, esc, fmtNum, fmtDateTime, api, navigate } from './lib.js';

const TABS = [
  { k: 'revision', t: 'Por revisar', clase: 'is-revision', f: (p) => p.estatus === 'en_revision' },
  { k: 'rechazado', t: 'Rechazados', clase: 'is-observaciones', f: (p) => p.estatus === 'rechazado' },
  { k: 'aprobado', t: 'Aprobados', clase: 'is-aprobado', f: (p) => p.estatus === 'validado' },
];
const LOTE = 40;
const DIA = 86400000;

function hace(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `hace ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'día' : 'días'}`;
  return `el ${fmtDateTime(iso)}`;
}

const fila = (p, tab) => {
  const viejo = p.estatus === 'en_revision' && Date.now() - new Date(p.createdAt) > 3 * DIA;
  return `<li class="promo-fila"><a class="promo-item" href="/promovidos/${p.id}" data-link>
    <span class="promo-ini ${tab.clase}" aria-hidden="true">${esc(p.iniciales)}</span>
    <span class="promo-item__txt">
      <strong>${esc(p.nombre)}</strong>
      <span class="promo-item__mod">${esc(p.promotor)} · capturado ${esc(hace(p.createdAt))}</span>
      ${p.conObservaciones || viejo ? `<span class="rev-tags">${p.conObservaciones && p.estatus === 'en_revision' ? '<span class="rev-tag">Con observaciones</span>' : ''}${viejo ? '<span class="rev-tag rev-tag--viejo">Más de 3 días</span>' : ''}</span>` : ''}
    </span>
    <span class="rev-flecha" aria-hidden="true">›</span>
  </a></li>`;
};

export async function viewRevision(route) {
  const lista = await api('/api/revision');
  route.data = lista;
  if (!lista.length) {
    return `<div class="empty"><span aria-hidden="true">${ICONS.users}</span><strong>Aún no hay promovidos</strong>
      <span>Cuando tus Promotores Territoriales capturen promovidos, aquí los revisarás.</span></div>`;
  }
  const promotores = [...new Map(lista.map((p) => [p.promotorId, p.promotor])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  const pendientes = lista.filter(TABS[0].f).length;
  return `
    <div class="rev">
      <div class="rev-head">
        <div class="seg" role="tablist" aria-label="Estatus">
          ${TABS.map((t, i) => `<button type="button" class="seg__btn${i ? '' : ' is-on'}" role="tab" aria-selected="${!i}" data-tab="${t.k}">${t.t} <span class="rev-n" data-n="${t.k}"></span></button>`).join('')}
        </div>
        ${pendientes ? `<button class="btn" type="button" id="revEmpezar">${ICONS.eye}<span>Revisar en orden</span></button>` : ''}
      </div>
      <div class="toolbar rev-filtros">
        <label class="field--inline"><span class="sr-only">Buscar por nombre</span><span class="field__icon" aria-hidden="true">${ICONS.search}</span>
          <input class="input input--icon" type="search" id="revBuscar" placeholder="Buscar por nombre" autocomplete="off"></label>
        <label class="rev-promotor"><span class="sr-only">Promotor</span>
          <select class="input" id="revPromotor"><option value="">Todos los promotores</option>${promotores.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></label>
      </div>
      <p class="rev-ayuda" id="revAyuda"></p>
      <ul class="promo-list rev-lista" id="revLista"></ul>
      <div class="scroll-centinela" id="revCentinela" aria-hidden="true"></div>
    </div>`;
}

export function mountRevision(root, route) {
  const lista = route.data;
  if (!lista?.length) return undefined;
  let tab = TABS[0];
  let filas = [];
  let pintados = 0;
  const ul = $('#revLista', root);
  const ayuda = $('#revAyuda', root);
  const filtrar = () => {
    const q = $('#revBuscar', root).value.trim().toLowerCase();
    const pr = $('#revPromotor', root).value;
    const base = lista.filter((p) => (!pr || p.promotorId === pr) && (!q || p.nombre.toLowerCase().includes(q)));
    for (const t of TABS) $(`[data-n="${t.k}"]`, root).textContent = fmtNum(base.filter(t.f).length);
    // Por revisar: los más antiguos primero; los demás, lo más reciente primero
    filas = base.filter(tab.f).sort((a, b) => (tab.k === 'revision' ? a.createdAt.localeCompare(b.createdAt) : b.modificado.localeCompare(a.modificado)));
    ayuda.textContent =
      tab.k === 'revision'
        ? 'Del más antiguo al más reciente. Revisa que los datos coincidan con la INE antes de aprobar.'
        : tab.k === 'rechazado'
          ? 'Esperan corrección de su promotor; al corregirlos regresan a «Por revisar».'
          : 'Ya no los puede modificar el promotor.';
    pintados = 0;
    ul.innerHTML = filas.length ? '' : '<li class="rev-vacio">No hay promovidos aquí.</li>';
    mas();
  };
  const mas = () => {
    ul.insertAdjacentHTML('beforeend', filas.slice(pintados, pintados + LOTE).map((p) => fila(p, tab)).join(''));
    pintados = Math.min(filas.length, pintados + LOTE);
  };
  const obs = new IntersectionObserver((e) => e[0].isIntersecting && pintados < filas.length && mas(), { rootMargin: '400px' });
  obs.observe($('#revCentinela', root));

  root.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = TABS.find((t) => t.k === b.dataset.tab);
      root.querySelectorAll('[data-tab]').forEach((x) => {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-selected', String(x === b));
      });
      filtrar();
    })
  );
  $('#revBuscar', root).addEventListener('input', filtrar);
  $('#revPromotor', root).addEventListener('change', filtrar);
  // Desde «Promotores»: llega filtrado por un promotor, en la primera pestaña que tenga promovidos suyos
  const pr = new URLSearchParams(location.search).get('promotor');
  // Sin promovidos todavía: se elige igual para que la lista quede vacía (no la de todos)
  if (pr && /^[0-9a-f-]{36}$/.test(pr) && !$(`#revPromotor option[value="${pr}"]`, root)) {
    $('#revPromotor', root).insertAdjacentHTML('beforeend', `<option value="${pr}">Promotor sin promovidos</option>`);
  }
  if (pr && $(`#revPromotor option[value="${CSS.escape(pr)}"]`, root)) {
    $('#revPromotor', root).value = pr;
    const suyos = lista.filter((p) => p.promotorId === pr);
    const t = TABS.find((x) => suyos.some(x.f));
    if (t && t !== tab) {
      tab = t;
      root.querySelectorAll('[data-tab]').forEach((x) => {
        x.classList.toggle('is-on', x.dataset.tab === t.k);
        x.setAttribute('aria-selected', String(x.dataset.tab === t.k));
      });
    }
  }
  $('#revEmpezar', root)?.addEventListener('click', () => {
    const primero = lista.filter(TABS[0].f).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (primero) navigate(`/promovidos/${primero.id}`);
  });
  filtrar();
  return () => obs.disconnect();
}
