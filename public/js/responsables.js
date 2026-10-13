// Responsables de Sección del Coordinador de Zona: resumen + alta/edición con mapa.
// Se asigna una sola sección de la zona; cada sección admite un solo responsable.
import { downloadBackup } from './eliminar.js';
import { ICONS, $, esc, fmtNum, fmtSeccion, api, fieldErrorSetter, submitWith, toast, homeControl, navigate } from './lib.js';
import { I, generatePassword, debounce, showAccessDialog } from './coordinador.js';
import { baseMap, seccionesGeo } from './zonas.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const num = (n) => (n === null || n === undefined ? '—' : fmtNum(n));

// Colores del mapa: con responsable (azul), seleccionadas en el formulario (guinda), sin responsable (gris)
const C_CUBIERTA = '#2a78d6';
const C_SELECCION = '#171717';
const styleCubierta = (strong) => ({ color: C_CUBIERTA, weight: strong ? 2 : 0.6, opacity: 1, fillColor: C_CUBIERTA, fillOpacity: strong ? 0.7 : 0.45 });
const styleVacante = { color: '#3f3f46', weight: 0.7, opacity: 0.9, fillColor: '#71717a', fillOpacity: 0.25 };

const sinSecciones = `
  <div class="page-head"><h2>Responsables de sección</h2></div>
  <div class="empty">
    <span aria-hidden="true">${ICONS.map}</span>
    <strong>Tu zona aún no tiene secciones asignadas</strong>
    <span>Tu Coordinador de Promoción del Voto debe asignarte secciones para que puedas repartirlas.</span>
  </div>`;

// ===========================================================================
// Resumen
// ===========================================================================
export async function viewResponsables(route, _params, state) {
  route.data = null;
  const data = await api('/api/responsables');
  if (!data.entidad) return sinSecciones;
  const op = await api('/api/responsables/opciones');
  route.data = { data, op };
  const t = data.totales;
  const z = data.zona;

  return `
    <div class="split split--list">
      <div class="split__form">
        <div class="page-head">
          <h2>Responsables de sección</h2>
          <p>${z ? `<span class="zswatch zswatch--inline" style="background:${z.color}"></span>${esc(z.codigo)} · ${esc(z.nombre)}. ` : ''}Asigna un responsable a cada sección de tu zona.${
            state.me.godMode ? ' Para ver los niveles inferiores, entra a la cuenta de cada responsable.' : ''
          }</p>
        </div>

        <div class="zstats card">
          <dl class="zstats__list">
            <div><dt>Responsables</dt><dd>${fmtNum(data.responsables.length)}</dd></div>
            <div><dt>Con responsable</dt><dd><span class="zstats__accent">${fmtNum(t.cubiertas)}</span> de ${fmtNum(t.secciones)} <span class="muted">(${pct(t.cubiertas, t.secciones)}%)</span></dd></div>
            <div><dt>Sin responsable</dt><dd class="${t.sinResponsable ? 'zstats__warn' : ''}">${fmtNum(t.sinResponsable)}</dd></div>
            <div><dt>Electores</dt><dd>${num(t.electoresCubiertos)} <span class="muted">de ${num(t.electores)}</span></dd></div>
          </dl>
          <div class="zstats__bar" role="img" aria-label="${pct(t.cubiertas, t.secciones)}% de las secciones con responsable">
            <span style="width:${(t.cubiertas / t.secciones) * 100}%;background:${C_CUBIERTA}"></span>
          </div>
          <button class="btn" type="button" data-action="nuevo" ${t.sinResponsable ? '' : 'disabled title="Todas las secciones ya tienen responsable"'}>${ICONS.plus}<span>Nuevo responsable</span></button>
        </div>

        ${
          data.responsables.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th scope="col">Responsable</th><th scope="col">Secciones</th><th scope="col" class="num">Electores</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
                <tbody>
                  ${data.responsables
                    .map(
                      (r) => `<tr data-rs="${r.id}" tabindex="0">
                        <td>${esc(r.name)}<small class="muted-block mono">${r.username ? `@${esc(r.username)}` : ''}</small></td>
                        <td><div class="secchips secchips--static">${r.secciones.map((s) => `<span class="secchip">${fmtSeccion(s)}</span>`).join('')}</div></td>
                        <td class="num num--r">${num(r.electores)}</td>
                        <td class="cell-action">
                          <button class="icon-btn icon-btn--table" type="button" data-action="edit" data-id="${r.id}" title="Editar ${esc(r.name)}" aria-label="Editar ${esc(r.name)}">${ICONS.edit}</button>${
                            state.me.godMode
                              ? `<button class="icon-btn icon-btn--table" type="button" data-action="god" data-id="${r.id}" title="Entrar a la cuenta de ${esc(r.name)}" aria-label="Entrar a la cuenta de ${esc(r.name)} (modo dios)">${ICONS.eye}</button>`
                              : ''
                          }${
                            state.me.canDelete
                              ? `<button class="icon-btn icon-btn--table icon-btn--danger" type="button" data-action="delete" data-id="${r.id}" title="Eliminar ${esc(r.name)}" aria-label="Eliminar ${esc(r.name)} y su rama">${ICONS.trash}</button>`
                              : ''
                          }
                        </td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
            : `<div class="empty"><span aria-hidden="true">${ICONS.users}</span><strong>Aún no tienes responsables de sección</strong><span>Da de alta el primero y asígnale sus secciones.</span></div>`
        }
      </div>
      <aside class="split__map" aria-label="Mapa de secciones de la zona">
        <div class="map map--split" id="rMap"></div>
        <ul class="legend"><li><span class="vz-sw" style="background:${C_CUBIERTA}"></span>Con responsable</li><li><span class="vz-sw vz-sw--vacant"></span>Sin responsable</li></ul>
        <p class="map-card__info" id="rInfo" aria-live="polite">Cargando mapa…</p>
      </aside>
    </div>`;
}

export function mountResponsables(root, route, _params, state, { enterGodMode, openDeleteFlow }) {
  if (!route.data) return undefined;
  const { data, op } = route.data;
  const info = $('#rInfo', root);
  const { map, destroy } = baseMap($('#rMap', root));
  let bounds = null;
  homeControl(() => bounds && map.fitBounds(bounds, { padding: [16, 16] })).addTo(map);
  const bySec = new Map(op.secciones.map((s) => [s.clave, s]));
  const layersByRs = new Map();
  const resumenTxt = `${fmtNum(data.totales.cubiertas)} de ${fmtNum(data.totales.secciones)} secciones con responsable`;
  const style = (s, strong = false) => (s.responsable ? styleCubierta(strong) : styleVacante);

  (async () => {
    try {
      const fc = await seccionesGeo(op.entidad.clave, op.secciones.map((s) => s.clave));
      const layer = L.geoJSON(fc, {
        style: (f) => style(bySec.get(f.properties.seccion)),
        onEachFeature(f, l) {
          const s = bySec.get(f.properties.seccion);
          const label = `Sección ${fmtSeccion(s.clave)} · ${s.responsable ? s.responsable.name : 'Sin responsable'}${s.electores !== null ? ` · ${fmtNum(s.electores)} electores` : ''}`;
          l.bindTooltip(esc(label), { sticky: true, direction: 'top', className: 'map-tip' });
          l.on({ mouseover: () => (info.textContent = label), mouseout: () => (info.textContent = resumenTxt) });
          if (s.responsable) {
            if (!layersByRs.has(s.responsable.id)) layersByRs.set(s.responsable.id, []);
            layersByRs.get(s.responsable.id).push({ l, s });
          }
        },
      }).addTo(map);
      bounds = layer.getBounds();
      map.fitBounds(bounds, { padding: [16, 16] });
      info.textContent = resumenTxt;
    } catch (err) {
      info.textContent = `No se pudo cargar el mapa: ${err.message}`;
    }
  })();

  const highlight = (id, on) => {
    for (const { l, s } of layersByRs.get(id) || []) l.setStyle(style(s, on));
  };
  root.querySelectorAll('tr[data-rs]').forEach((tr) => {
    tr.addEventListener('mouseenter', () => highlight(tr.dataset.rs, true));
    tr.addEventListener('mouseleave', () => highlight(tr.dataset.rs, false));
    tr.addEventListener('focus', () => highlight(tr.dataset.rs, true));
    tr.addEventListener('blur', () => highlight(tr.dataset.rs, false));
  });

  root.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      const tr = e.target.closest('tr[data-rs]');
      const items = tr && layersByRs.get(tr.dataset.rs);
      if (items?.length) map.fitBounds(L.featureGroup(items.map((x) => x.l)).getBounds(), { padding: [32, 32], maxZoom: 15 });
      return;
    }
    const { action, id } = btn.dataset;
    if (action === 'nuevo') navigate('/responsables/nuevo');
    if (action === 'edit') navigate(`/responsables/${id}/editar`);
    if (action === 'god') {
      btn.disabled = true;
      enterGodMode(id, '/estructura').catch((err) => {
        btn.disabled = false;
        toast(err.message);
      });
    }
    if (action === 'delete') {
      const r = data.responsables.find((x) => x.id === id);
      openDeleteFlow({ id, name: r.name }, state.me, () => navigate('/responsables'));
    }
  };
  return destroy;
}

// ===========================================================================
// Alta / edición
// ===========================================================================
export async function viewResponsable(route, params = []) {
  const id = params[0] || null;
  route.data = null;
  let op;
  try {
    op = await api(`/api/responsables/opciones${id ? `?exclude=${id}` : ''}`);
  } catch (err) {
    if (err.status === 409) return sinSecciones;
    throw err;
  }
  const current = id ? await api(`/api/responsables/${id}`) : null;
  route.data = { id, op, current };
  const editing = Boolean(current);
  const libres = op.secciones.filter((s) => !s.responsable).length;

  return `
    <div class="split">
      <div class="split__form">
        <a class="back-link" href="/responsables" data-link>${ICONS.back}<span>Responsables</span></a>
        <div class="page-head">
          <h2>${editing ? esc(current.name) : 'Nuevo responsable de sección'}</h2>
          <p>${editing ? 'Responsable de Sección · edita sus datos, acceso o secciones.' : `Hay ${fmtNum(libres)} secciones sin responsable en ${esc(op.zona.codigo)} · ${esc(op.zona.nombre)}.`}</p>
        </div>

        <form id="rsForm" novalidate>
          <section class="card form-card" aria-labelledby="rs1">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.user}</span>
              <h3 id="rs1">1. Responsable de sección y cuenta de acceso</h3>
              <span class="form-card__aside">Campos requeridos <span class="req">*</span></span>
            </header>
            <div class="field">
              <label for="cName">Nombre completo <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="cName" name="name" maxlength="120" autocomplete="off" value="${esc(current?.name || '')}" placeholder="ej. María López Hernández" required>
              <p class="field__error" id="cName-err"></p>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="cUser">Usuario de acceso <span class="req" aria-hidden="true">*</span></label>
                <div class="input-icon input-icon--text"><span aria-hidden="true">@</span>
                  <input class="input mono" id="cUser" name="username" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(current?.username || '')}" required></div>
                <p class="field__help">${editing ? 'Con este usuario inicia sesión.' : 'Te sugerimos uno a partir del nombre; puedes cambiarlo.'}</p>
                <p class="field__ok" id="cUser-ok" aria-live="polite"></p>
                <p class="field__error" id="cUser-err"></p>
              </div>
              <div class="field">
                <div class="label-row">
                  <label for="cPass">${editing ? 'Nueva contraseña (opcional)' : 'Contraseña <span class="req" aria-hidden="true">*</span>'}</label>
                  <button type="button" class="link-btn" id="cGen">Generar segura</button>
                </div>
                <div class="input-icon input-icon--action"><span aria-hidden="true">${I.lock}</span>
                  <input class="input mono" id="cPass" name="password" type="${editing ? 'password' : 'text'}" autocomplete="new-password" spellcheck="false" placeholder="${editing ? 'Dejar en blanco para conservar la actual' : ''}" value="${editing ? '' : generatePassword()}" ${editing ? '' : 'required'}>
                  <button type="button" class="input-action" id="cShow" aria-label="${editing ? 'Mostrar' : 'Ocultar'} contraseña" aria-pressed="${!editing}">${editing ? I.eye : I.eyeOff}</button>
                </div>
                <p class="field__help">Mínimo 8 caracteres, con letras y números.</p>
                <p class="field__error" id="cPass-err"></p>
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="cPhone">Teléfono / WhatsApp <span class="req" aria-hidden="true">*</span></label>
                <div class="input-icon"><span aria-hidden="true">${I.phone}</span>
                  <input class="input" id="cPhone" name="phone" type="tel" inputmode="numeric" maxlength="14" autocomplete="off" value="${esc(current?.phone || '')}" placeholder="10 dígitos" required></div>
                <p class="field__error" id="cPhone-err"></p>
              </div>
              <div class="field">
                <label for="cEmail">Correo electrónico</label>
                <div class="input-icon"><span aria-hidden="true">${I.mail}</span>
                  <input class="input" id="cEmail" name="email" type="email" autocomplete="off" value="${esc(current?.email || '')}" placeholder="opcional"></div>
                <p class="field__error" id="cEmail-err"></p>
              </div>
            </div>
          </section>

          <section class="card form-card" aria-labelledby="rs2">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.map}</span>
              <h3 id="rs2">2. Sección</h3>
              <span class="form-card__aside">Solo una</span>
            </header>
            <p class="units__help">Elige la sección en la lista o haz clic sobre ella en el mapa. Cada responsable tiene una sola sección y cada sección, un solo responsable.</p>
            <div class="units">
              <div class="units__search">
                <span aria-hidden="true">${ICONS.search}</span>
                <input class="input" type="search" id="rSearch" placeholder="Buscar sección" inputmode="numeric" aria-label="Buscar sección por número" autocomplete="off">
              </div>
              <label class="units__toggle"><input type="checkbox" id="rOnlyFree"> Mostrar solo secciones sin responsable</label>
              <div class="units__list units__list--secs" id="rList"></div>
            </div>
            <p class="field__error" id="rTerr-err"></p>
            <div class="units__total" aria-live="polite">
              <span id="rTotSecc">0 secciones</span>
              <span id="rTotElect"></span>
            </div>
          </section>

          <p class="form-error" id="rFormErr" role="alert"></p>
          <div class="form-footer">
            <a class="btn btn--secondary" href="/responsables" data-link>Cancelar</a>
            <button class="btn" type="submit">${editing ? 'Guardar cambios' : 'Guardar y crear cuenta'}</button>
          </div>
        </form>
      </div>
      <aside class="split__map" aria-label="Mapa de secciones de la zona">
        <div class="map map--split" id="rMap"></div>
        <ul class="legend"><li><span class="vz-sw" style="background:${C_SELECCION}"></span>Seleccionada</li><li><span class="vz-sw" style="background:${C_CUBIERTA}"></span>Con otro responsable</li><li><span class="vz-sw vz-sw--vacant"></span>Sin responsable</li></ul>
        <p class="map-card__info" id="rInfo" aria-live="polite">Cargando mapa…</p>
      </aside>
    </div>
    <dialog class="dialog dialog--wide" id="doneDialog" aria-labelledby="doneTitle"></dialog>`;
}

export function mountResponsable(root, route) {
  if (!route.data?.op) return undefined;
  const { id, op, current } = route.data;
  const editing = Boolean(current);
  const form = $('#rsForm', root);
  const info = $('#rInfo', root);
  const bySec = new Map(op.secciones.map((s) => [s.clave, s]));
  const sel = new Set(current?.territorio?.secciones || []);
  const munName = (c) => op.municipios[c] || `Municipio ${c}`;

  // ---------- Usuario y contraseña ----------
  const userInput = $('#cUser', root);
  const userOk = $('#cUser-ok', root);
  let userTouched = editing || Boolean(userInput.value);
  const checkUser = debounce(async () => {
    const u = userInput.value.trim().toLowerCase();
    userOk.textContent = '';
    if (!u) return;
    const r = await api(`/api/usernames/check?username=${encodeURIComponent(u)}${id ? `&exclude=${id}` : ''}`).catch(() => null);
    if (!r || userInput.value.trim().toLowerCase() !== u) return;
    $('#cUser-err', root).textContent = r.error || '';
    userOk.textContent = r.available ? 'Disponible' : '';
  }, 350);
  $('#cName', root).addEventListener(
    'input',
    debounce(async () => {
      if (userTouched) return;
      const name = $('#cName', root).value.trim();
      if (name.length < 3) return;
      const r = await api(`/api/usernames/suggest?name=${encodeURIComponent(name)}`).catch(() => null);
      if (r?.username && !userTouched) {
        userInput.value = r.username;
        checkUser();
      }
    }, 400)
  );
  userInput.addEventListener('input', () => {
    userTouched = true;
    userInput.value = userInput.value.toLowerCase().replace(/\s/g, '');
    checkUser();
  });
  const pass = $('#cPass', root);
  const showBtn = $('#cShow', root);
  const setShow = (on) => {
    pass.type = on ? 'text' : 'password';
    showBtn.setAttribute('aria-pressed', String(on));
    showBtn.setAttribute('aria-label', on ? 'Ocultar contraseña' : 'Mostrar contraseña');
    showBtn.innerHTML = on ? I.eyeOff : I.eye;
  };
  showBtn.addEventListener('click', () => setShow(pass.type === 'password'));
  $('#cGen', root).addEventListener('click', () => {
    pass.value = generatePassword();
    setShow(true);
    $('#cPass-err', root).textContent = '';
  });

  // ---------- Mapa ----------
  const { map, destroy } = baseMap($('#rMap', root));
  let bounds = null;
  homeControl(() => bounds && map.fitBounds(bounds, { padding: [16, 16] })).addTo(map);
  const featureBySec = new Map();
  const styleFor = (s) =>
    s.responsable
      ? { color: C_CUBIERTA, weight: 0.6, opacity: 0.9, fillColor: C_CUBIERTA, fillOpacity: 0.3 }
      : sel.has(s.clave)
        ? { color: '#0a0a0a', weight: 1.8, opacity: 1, fillColor: C_SELECCION, fillOpacity: 0.55 }
        : styleVacante;
  const secLabel = (s) =>
    `Sección ${fmtSeccion(s.clave)} · ${munName(s.municipio)}${s.electores !== null ? ` · ${fmtNum(s.electores)} electores` : ''}${s.responsable ? ` · Responsable: ${s.responsable.name}` : ''}`;
  const totalsText = () => (sel.size ? `Sección ${[...sel][0]} seleccionada` : 'Haz clic en el mapa o en la lista para elegir la sección.');

  function toggle(clave) {
    const s = bySec.get(clave);
    if (!s) return;
    if (s.responsable) {
      info.textContent = `La sección ${fmtSeccion(clave)} ya tiene responsable: ${s.responsable.name}.`;
      return;
    }
    // Una sola sección: elegir otra reemplaza la anterior
    const previas = [...sel];
    sel.clear();
    sel.add(clave);
    $('#rTerr-err', root).textContent = '';
    for (const c of [...previas, clave]) featureBySec.get(c)?.setStyle(styleFor(bySec.get(c)));
    featureBySec.get(clave)?.bringToFront();
    renderList();
    renderTotals();
  }

  (async () => {
    try {
      const fc = await seccionesGeo(op.entidad.clave, op.secciones.map((s) => s.clave));
      const layer = L.geoJSON(fc, {
        style: (f) => styleFor(bySec.get(f.properties.seccion)),
        onEachFeature(f, l) {
          const s = bySec.get(f.properties.seccion);
          featureBySec.set(s.clave, l);
          l.bindTooltip(esc(secLabel(s)), { sticky: true, direction: 'top', className: 'map-tip' });
          l.on({
            mouseover: () => {
              info.textContent = secLabel(s);
              if (!s.responsable) l.setStyle({ weight: 2.5, color: '#0a0a0a' });
            },
            mouseout: () => {
              l.setStyle(styleFor(s));
              info.textContent = totalsText();
            },
            click: () => toggle(s.clave),
          });
        },
      }).addTo(map);
      bounds = layer.getBounds();
      map.fitBounds(bounds, { padding: [16, 16] });
      info.textContent = totalsText();
    } catch (err) {
      info.textContent = `No se pudo cargar el mapa: ${err.message}`;
    }
  })();

  // ---------- Lista de secciones ----------
  const list = $('#rList', root);
  const search = $('#rSearch', root);
  const onlyFree = $('#rOnlyFree', root);
  function renderList() {
    const q = search.value.trim();
    const rows = op.secciones.filter((s) => (!q || fmtSeccion(s.clave).includes(q) || String(s.clave).includes(q)) && (!onlyFree.checked || !s.responsable || sel.has(s.clave)));
    list.innerHTML = rows.length
      ? rows
          .map(
            (s) => `<label class="unit unit--sec ${sel.has(s.clave) ? 'is-selected' : ''} ${s.responsable ? 'is-disabled' : ''}">
              <input type="radio" name="rSeccion" value="${s.clave}" ${sel.has(s.clave) ? 'checked' : ''} ${s.responsable ? 'disabled' : ''}>
              <span class="unit__name">Sección ${fmtSeccion(s.clave)}<small>${esc(munName(s.municipio))}${s.responsable ? ` · ${esc(s.responsable.name)}` : ''}</small></span>
              <span class="unit__stats">${s.electores !== null ? `${fmtNum(s.electores)} electores` : ''}</span>
            </label>`
          )
          .join('')
      : '<p class="units__empty">Sin coincidencias.</p>';
  }
  function renderTotals() {
    const electores = op.hasPadron ? [...sel].reduce((t, c) => t + (bySec.get(c)?.electores || 0), 0) : null;
    $('#rTotSecc', root).textContent = sel.size ? `Sección ${[...sel].sort((a, b) => a - b).map(fmtSeccion).join(', ')}` : 'Ninguna sección elegida';
    $('#rTotElect', root).textContent = electores !== null ? `${fmtNum(electores)} electores` : 'Sin padrón cargado';
    info.textContent = totalsText();
  }
  list.addEventListener('change', (e) => {
    if (e.target.type === 'radio') toggle(Number(e.target.value));
  });
  search.addEventListener('input', renderList);
  onlyFree.addEventListener('change', renderList);
  renderList();
  renderTotals();

  // ---------- Guardar ----------
  const baseSetErrors = fieldErrorSetter(root, { name: 'cName', username: 'cUser', password: 'cPass', phone: 'cPhone', email: 'cEmail' });
  const setErrors = (errs = {}) => {
    $('#rTerr-err', root).textContent = errs.territorio || '';
    baseSetErrors(errs);
    if (errs.territorio && Object.keys(errs).length === 1) $('#rTerr-err', root).scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // Cambio de sección con promotores o promovidos: transferirlos o respaldarlos y borrarlos
  let decision = null;
  const pedirDecision = (d) => {
    let box = $('#rDecision', root);
    if (!box) {
      box = document.createElement('section');
      box.id = 'rDecision';
      box.className = 'card dep-decision';
      $('#rFormErr', root).before(box);
    }
    box.innerHTML = `
      <h3>Antes de cambiarlo de sección</h3>
      <p>Tiene <strong>${fmtNum(d.promotores)} ${d.promotores === 1 ? 'promotor' : 'promotores'}</strong> y <strong>${fmtNum(d.promovidos)} ${d.promovidos === 1 ? 'promovido' : 'promovidos'}</strong> en su sección actual. Elige qué pasa con ellos:</p>
      ${
        d.destinos.length
          ? `<label class="dep-op"><input type="radio" name="depModo" value="transferir"><span><strong>Transferirlos a otro Responsable de tu zona</strong><small>Sus promotores y promovidos pasan a quien elijas.</small></span></label>
        <div class="field dep-destino" hidden><label for="depDestino">Responsable que los recibe</label>
          <select class="input" id="depDestino"><option value="">Elige…</option>${d.destinos
            .map((x) => `<option value="${x.id}">${esc(x.name)}${x.secciones.length ? ` · Sección ${x.secciones.map(fmtSeccion).join(', ')}` : ''}</option>`)
            .join('')}</select><p class="field__error" id="depDestino-err"></p></div>`
          : ''
      }
      <label class="dep-op"><input type="radio" name="depModo" value="borrar"><span><strong>Respaldar y borrarlos</strong><small>Primero se descarga un respaldo (obligatorio); después se borran sus promotores y promovidos.</small></span></label>
      <div class="dep-respaldo" hidden><button class="btn btn--secondary" type="button" id="depRespaldo">Descargar respaldo</button><span class="muted" id="depRespaldoOk"></span></div>
      <p class="muted">Después pulsa «Guardar cambios».</p>`;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.addEventListener('change', (e) => {
      if (e.target.name !== 'depModo') return;
      decision = { dependientes: e.target.value };
      $('.dep-destino', box) && ($('.dep-destino', box).hidden = e.target.value !== 'transferir');
      $('.dep-respaldo', box).hidden = e.target.value !== 'borrar';
    });
    $('#depRespaldo', box).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const nombre = await downloadBackup(id);
        $('#depRespaldoOk', box).textContent = `Descargado: ${nombre}`;
      } catch (err) {
        $('#depRespaldoOk', box).textContent = err.message;
        e.currentTarget.disabled = false;
      }
    });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(form)), secciones: [...sel] };
    if (decision) {
      Object.assign(body, decision);
      if (decision.dependientes === 'transferir') body.destinoId = $('#depDestino', root)?.value || '';
    }
    const label = editing ? 'Guardar cambios' : 'Guardar y crear cuenta';
    const saved = await submitWith(form, label, 'Guardando…', setErrors, $('#rFormErr', root), async () => {
      try {
        return await api(editing ? `/api/responsables/${id}` : '/api/responsables', { method: editing ? 'PUT' : 'POST', body });
      } catch (err) {
        if (err.data?.requiereDecision) {
          pedirDecision(err.data);
          return null;
        }
        if (err.data?.fields?.destinoId) $('#depDestino-err', root).textContent = err.data.fields.destinoId;
        throw err;
      }
    });
    if (!saved) return;
    if (body.password) {
      const n = saved.territorio.secciones.length;
      showAccessDialog($('#doneDialog', root), {
        user: saved,
        password: body.password,
        wasEditing: editing,
        roleLabel: 'Responsable de Sección',
        subtitle: `${n === 1 ? 'Sección' : 'Secciones'} ${saved.territorio.secciones.map(fmtSeccion).join(', ')}`,
        backLabel: 'Ir a Responsables',
        backPath: '/responsables',
      });
    } else {
      toast('Responsable actualizado');
      navigate('/responsables');
    }
  });

  return destroy;
}
