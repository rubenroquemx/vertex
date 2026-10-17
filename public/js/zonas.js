// Zonas del Coordinador de Promoción del Voto (CPV): resumen + alta/edición con mapa.
import { ICONS, $, esc, fmtNum, fmtSeccion, api, fieldErrorSetter, submitWith, toast, GEO_STYLE, homeControl, navigate } from './lib.js';
import { I, generatePassword, debounce, showAccessDialog } from './coordinador.js';

const METODOS = [
  { key: 'municipio', name: 'Por municipio', field: 'municipio', layer: 'municipio', help: 'Marca los municipios completos que conformarán esta zona.' },
  { key: 'distrito_local', name: 'Por distrito local', field: 'distritoLocal', layer: 'distrito_local', help: 'Marca los distritos locales que conformarán esta zona.' },
  { key: 'distrito_federal', name: 'Por distrito federal', field: 'distritoFederal', layer: 'distrito_federal', help: 'Marca los distritos federales que conformarán esta zona.' },
  { key: 'manual', name: 'Manual en mapa', field: null, layer: null, help: 'Haz clic en las secciones del mapa para agregarlas o quitarlas.' },
];
const LAYER_FIELD = { municipio: 'municipio', distrito_local: 'distrito_local', distrito_federal: 'distrito_federal' };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const num = (n) => (n === null || n === undefined ? '—' : fmtNum(n));

// Mapa base de OpenStreetMap con controles de zoom (mismo estilo que el resto de la app)
export function baseMap(el) {
  const map = L.map(el, { preferCanvas: true, zoomControl: false, scrollWheelZoom: false, zoomSnap: 0.5, minZoom: 5, maxZoom: 18 });
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);
  return { map, destroy: () => (ro.disconnect(), map.remove()) };
}

// Secciones del territorio del CPV (GeoJSON filtrado)
export async function seccionesGeo(entidad, claves) {
  const fc = await api(`/api/geo/states/${entidad}/layers/seccion`);
  const set = new Set(claves);
  return { type: 'FeatureCollection', features: fc.features.filter((f) => set.has(f.properties.seccion)) };
}

const sinTerritorio = `
    <div class="empty">
    <span aria-hidden="true">${ICONS.database}</span>
    <strong>Tu cuenta aún no tiene territorio asignado</strong>
    <span>El administrador debe asignarte un territorio para que puedas repartirlo en zonas.</span>
  </div>`;

// ===========================================================================
// Resumen de zonas
// ===========================================================================
export async function viewZonas(route, _params, state) {
  route.data = null;
  const data = await api('/api/zonas');
  if (!data.entidad) return sinTerritorio;
  const op = await api('/api/zonas/opciones');
  route.data = { data, op };
  const t = data.totales;

  return `
    <div class="split split--list">
      <div class="split__form">
        <div class="page-head">
          <p>Reparte tu territorio en ${esc(data.entidad.nombre)} en zonas, cada una con su Coordinador de Zona.${
            state.me.godMode ? ' Para ver los niveles inferiores, entra a la cuenta de cada coordinador.' : ''
          }</p>
        </div>

        <div class="zstats card">
          <dl class="zstats__list">
            <div><dt>Zonas</dt><dd>${fmtNum(data.zonas.length)}</dd></div>
            <div><dt>Asignadas</dt><dd><span class="zstats__accent">${fmtNum(t.asignadas)}</span> de ${fmtNum(t.secciones)} <span class="muted">(${pct(t.asignadas, t.secciones)}%)</span></dd></div>
            <div><dt>Vacantes</dt><dd class="${t.vacantes ? 'zstats__warn' : ''}">${fmtNum(t.vacantes)}</dd></div>
            <div><dt>Electores</dt><dd>${num(t.electoresAsignados)} <span class="muted">de ${num(t.electores)}</span></dd></div>
          </dl>
          <div class="zstats__bar" role="img" aria-label="${pct(t.asignadas, t.secciones)}% de las secciones asignadas">
            ${data.zonas.map((z) => `<span style="width:${(z.secciones / t.secciones) * 100}%;background:${z.color}" title="${esc(z.codigo)} · ${fmtNum(z.secciones)} secc"></span>`).join('')}
          </div>
          <button class="btn" type="button" data-action="nueva" ${t.vacantes ? '' : 'disabled title="No quedan secciones vacantes"'}>${ICONS.plus}<span>Nueva zona</span></button>
        </div>

        ${
          data.zonas.length
            ? `<div class="table-wrap"><table class="table table--personas">
                <thead><tr><th scope="col">Zona</th><th scope="col">Coordinador</th><th scope="col" class="num">Secciones</th><th scope="col" class="num">Electores</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
                <tbody>
                  ${data.zonas
                    .map(
                      (z) => `<tr data-zona="${z.id}" tabindex="0">
                        <td><div class="zcell"><span class="zswatch" style="background:${z.color}" aria-hidden="true"></span><span><strong>${esc(z.codigo)}</strong><small>${esc(z.nombre)}</small></span></div></td>
                        <td>${esc(z.coordinador.name)}<small class="muted-block mono">${z.coordinador.username ? `@${esc(z.coordinador.username)}` : ''}</small></td>
                        <td class="num num--r" data-label="Secciones">${fmtNum(z.secciones)}</td>
                        <td class="num num--r" data-label="Electores">${num(z.electores)}</td>
                        <td class="cell-action">
                          <button class="icon-btn icon-btn--table" type="button" data-action="edit" data-id="${z.id}" title="Editar ${esc(z.codigo)}" aria-label="Editar zona ${esc(z.codigo)}">${ICONS.edit}</button>${
                            state.me.godMode
                              ? `<button class="icon-btn icon-btn--table" type="button" data-action="god" data-id="${z.id}" title="Entrar a la cuenta de ${esc(z.coordinador.name)}" aria-label="Entrar a la cuenta de ${esc(z.coordinador.name)} (modo dios)">${ICONS.eye}</button>`
                              : ''
                          }${
                            state.me.canDelete
                              ? `<button class="icon-btn icon-btn--table icon-btn--danger" type="button" data-action="delete" data-id="${z.id}" title="Eliminar ${esc(z.codigo)}" aria-label="Eliminar zona ${esc(z.codigo)} y su rama">${ICONS.trash}</button>`
                              : ''
                          }
                        </td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
            : `<div class="empty"><span aria-hidden="true">${I.map}</span><strong>Aún no tienes zonas</strong><span>Crea la primera para repartir tu territorio.</span></div>`
        }
      </div>
      <aside class="split__map" aria-label="Mapa de zonas">
        <div class="map map--split" id="zMap"></div>
        <p class="map-card__info" id="zInfo" aria-live="polite">Cargando mapa…</p>
      </aside>
    </div>`;
}

export function mountZonas(root, route, _params, state, { enterGodMode, openDeleteFlow }) {
  if (!route.data) return undefined;
  const { data, op } = route.data;
  const info = $('#zInfo', root);
  const { map, destroy } = baseMap($('#zMap', root));
  const homeBounds = { b: null };
  homeControl(() => homeBounds.b && map.fitBounds(homeBounds.b, { padding: [16, 16] })).addTo(map);
  const bySec = new Map(op.secciones.map((s) => [s.clave, s]));
  const layersByZona = new Map();
  let layer = null;
  const resumenTxt = `${fmtNum(data.totales.asignadas)} de ${fmtNum(data.totales.secciones)} secciones asignadas · ${fmtNum(data.totales.vacantes)} vacantes`;

  const style = (s, strong = false) =>
    s.zona
      ? { color: s.zona.color, weight: strong ? 2 : 0.6, opacity: 1, fillColor: s.zona.color, fillOpacity: strong ? 0.75 : 0.5 }
      : { color: '#3f3f46', weight: 0.8, opacity: 0.9, fillColor: '#71717a', fillOpacity: 0.32 };

  (async () => {
    try {
      const fc = await seccionesGeo(op.entidad.clave, op.secciones.map((s) => s.clave));
      layer = L.geoJSON(fc, {
        style: (f) => style(bySec.get(f.properties.seccion)),
        onEachFeature(f, l) {
          const s = bySec.get(f.properties.seccion);
          const label = `Sección ${fmtSeccion(s.clave)} · ${s.zona ? `${s.zona.codigo} ${s.zona.nombre}` : 'Vacante'}${s.electores !== null ? ` · ${fmtNum(s.electores)} electores` : ''}`;
          l.bindTooltip(esc(label), { sticky: true, direction: 'top', className: 'map-tip' });
          l.on({ mouseover: () => (info.textContent = label), mouseout: () => (info.textContent = resumenTxt) });
          if (s.zona) {
            if (!layersByZona.has(s.zona.id)) layersByZona.set(s.zona.id, []);
            layersByZona.get(s.zona.id).push({ l, s });
          }
        },
      }).addTo(map);
      homeBounds.b = layer.getBounds();
      map.fitBounds(homeBounds.b, { padding: [16, 16] });
      info.textContent = resumenTxt;
    } catch (err) {
      info.textContent = `No se pudo cargar el mapa: ${err.message}`;
    }
  })();

  // Resaltar una zona al pasar por su fila
  const highlight = (id, on) => {
    for (const { l, s } of layersByZona.get(id) || []) l.setStyle(style(s, on));
  };
  const focusZona = (id) => {
    const items = layersByZona.get(id);
    if (items?.length) map.fitBounds(L.featureGroup(items.map((x) => x.l)).getBounds(), { padding: [24, 24] });
  };
  root.querySelectorAll('tr[data-zona]').forEach((tr) => {
    tr.addEventListener('mouseenter', () => highlight(tr.dataset.zona, true));
    tr.addEventListener('mouseleave', () => highlight(tr.dataset.zona, false));
    tr.addEventListener('focus', () => highlight(tr.dataset.zona, true));
    tr.addEventListener('blur', () => highlight(tr.dataset.zona, false));
  });

  root.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      const tr = e.target.closest('tr[data-zona]');
      if (tr) focusZona(tr.dataset.zona);
      return;
    }
    const { action, id } = btn.dataset;
    if (action === 'nueva') navigate('/zonas/nueva');
    if (action === 'edit') navigate(`/zonas/${id}/editar`);
    if (action === 'god') {
      btn.disabled = true;
      enterGodMode(id).catch((err) => {
        btn.disabled = false;
        toast(err.message);
      });
    }
    if (action === 'delete') {
      const z = data.zonas.find((x) => x.id === id);
      openDeleteFlow({ id, name: `${z.codigo} · ${z.coordinador.name}` }, state.me, () => navigate('/zonas'));
    }
  };

  return destroy;
}

// ===========================================================================
// Alta / edición de zona
// ===========================================================================
export async function viewZona(route, params = []) {
  const id = params[0] || null;
  route.data = null;
  let op;
  try {
    op = await api(`/api/zonas/opciones${id ? `?exclude=${id}` : ''}`);
  } catch (err) {
    if (err.status === 409) return sinTerritorio;
    throw err;
  }
  const current = id ? await api(`/api/zonas/${id}`) : null;
  route.data = { id, op, current };
  const editing = Boolean(current);
  const z = current?.zona || {};
  const color = z.color || op.paleta.find((p) => !p.usado)?.color || op.paleta[0].color;
  route.data.color = color;
  const libres = op.secciones.filter((s) => !s.zona).length;

  return `
    <div class="split">
      <div class="split__form">
        <a class="back-link" href="/zonas" data-link>${ICONS.back}<span>Zonas</span></a>
        <div class="page-head">
          ${editing ? `<h2>${esc(z.codigo)} · ${esc(z.nombre)}</h2>` : ''}
          <p>${editing ? 'Edita la zona, su coordinador o sus secciones.' : `Hay ${fmtNum(libres)} secciones vacantes en tu territorio.`}</p>
        </div>

        <form id="zonaForm" novalidate>
          <section class="card form-card" aria-labelledby="zs1">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.map}</span>
              <h3 id="zs1">1. Datos de la zona</h3>
              <span class="form-card__aside">Campos requeridos <span class="req">*</span></span>
            </header>
            <div class="field-row field-row--wide">
              <div class="field">
                <label for="zNombre">Nombre de la zona <span class="req" aria-hidden="true">*</span></label>
                <input class="input" id="zNombre" name="zonaNombre" maxlength="60" autocomplete="off" value="${esc(z.nombre || '')}" placeholder="ej. Zona Centro" required>
                <p class="field__error" id="zNombre-err"></p>
              </div>
              <div class="field">
                <label for="zCodigo">Código <span class="req" aria-hidden="true">*</span></label>
                <input class="input mono" id="zCodigo" name="zonaCodigo" maxlength="20" autocomplete="off" value="${esc(z.codigo || op.siguienteCodigo)}" required>
                <p class="field__error" id="zCodigo-err"></p>
              </div>
            </div>
            <fieldset class="field">
              <legend>Color en el mapa <span class="req" aria-hidden="true">*</span></legend>
              <div class="swatches" role="radiogroup" aria-label="Color de la zona">
                ${op.paleta
                  .map(
                    (p) => `<label class="swatch ${p.usado ? 'is-used' : ''}" title="${p.usado ? 'Usado por otra zona' : 'Disponible'}">
                      <input type="radio" name="zonaColor" value="${p.color}" ${p.color === color ? 'checked' : ''} ${p.usado ? 'disabled' : ''}>
                      <span style="background:${p.color}"><span aria-hidden="true">${I.check}</span></span>
                      <span class="sr-only">${p.color}${p.usado ? ' (usado por otra zona)' : ''}</span>
                    </label>`
                  )
                  .join('')}
              </div>
              <p class="field__error" id="zColor-err"></p>
            </fieldset>
          </section>

          <section class="card form-card" aria-labelledby="zs2">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.user}</span>
              <h3 id="zs2">2. Coordinador de zona y cuenta de acceso</h3>
            </header>
            <div class="field">
              <label for="cName">Nombre completo del coordinador <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="cName" name="name" maxlength="120" autocomplete="off" value="${esc(current?.name || '')}" placeholder="ej. Juan Pérez López" required>
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

          <section class="card form-card" aria-labelledby="zs3">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.map}</span>
              <h3 id="zs3">3. Secciones de la zona</h3>
              <span class="form-card__aside">Dentro de tu territorio</span>
            </header>
            <fieldset class="field">
              <legend>Método de asignación de secciones <span class="req" aria-hidden="true">*</span></legend>
              <div class="methods" role="radiogroup" aria-label="Método de asignación">
                ${METODOS.map((m) => `<button type="button" class="method" role="radio" data-metodo="${m.key}" aria-checked="false">${esc(m.name)}</button>`).join('')}
              </div>
            </fieldset>
            <div class="units" id="zUnits" hidden>
              <p class="units__help" id="zHelp"></p>
              <div class="units__list" id="zList"></div>
            </div>
            <p class="field__error" id="zTerr-err"></p>
            <div class="units__total" aria-live="polite">
              <span id="zTotSecc">0 secciones</span>
              <span id="zTotElect"></span>
            </div>
          </section>

          <p class="form-error" id="zFormErr" role="alert"></p>
          <div class="form-footer">
            <a class="btn btn--secondary" href="/zonas" data-link>Cancelar</a>
            <button class="btn" type="submit">${editing ? 'Guardar cambios' : 'Guardar zona y crear cuenta'}</button>
          </div>
        </form>
      </div>
      <aside class="split__map" aria-label="Mapa de secciones">
        <div class="map map--split" id="zMap"></div>
        <p class="map-card__info" id="zInfo" aria-live="polite">Cargando mapa…</p>
      </aside>
    </div>
    <dialog class="dialog dialog--wide" id="doneDialog" aria-labelledby="doneTitle"></dialog>`;
}

export function mountZona(root, route) {
  if (!route.data?.op) return undefined;
  const { id, op, current } = route.data;
  const editing = Boolean(current);
  const form = $('#zonaForm', root);
  const info = $('#zInfo', root);
  const secs = op.secciones;
  const bySec = new Map(secs.map((s) => [s.clave, s]));

  const sel = {
    metodo: current?.territorio?.metodo || null,
    unidades: new Set(current?.territorio?.unidades || []),
    manual: new Set(current?.territorio?.metodo === 'manual' ? current.territorio.secciones : []),
    color: route.data.color,
  };
  const metodoDef = () => METODOS.find((m) => m.key === sel.metodo);

  // Secciones seleccionadas según el método (las ocupadas por otras zonas nunca cuentan)
  function selected() {
    const m = metodoDef();
    if (!m) return new Set();
    if (!m.field) return new Set([...sel.manual].filter((c) => bySec.has(c) && !bySec.get(c).zona));
    return new Set(secs.filter((s) => !s.zona && sel.unidades.has(s[m.field])).map((s) => s.clave));
  }

  // ---------- Usuario: sugerencia y disponibilidad ----------
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

  // ---------- Contraseña ----------
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

  // ---------- Código en mayúsculas ----------
  const codigo = $('#zCodigo', root);
  codigo.addEventListener('input', () => {
    const pos = codigo.selectionStart;
    codigo.value = codigo.value.toUpperCase().replace(/\s/g, '-');
    codigo.setSelectionRange(pos, pos);
  });

  // ---------- Mapa ----------
  const { map, destroy } = baseMap($('#zMap', root));
  let homeB = null;
  homeControl(() => homeB && map.fitBounds(homeB, { padding: [16, 16] })).addTo(map);
  const featureBySec = new Map();
  let secLayer = null;
  let outlines = null;
  const unitLayerCache = new Map();

  function styleFor(s, sel2) {
    if (s.zona) return { color: s.zona.color, weight: 0.6, opacity: 0.9, fillColor: s.zona.color, fillOpacity: 0.3 };
    if (sel2.has(s.clave)) return { color: sel.color, weight: 1.6, opacity: 1, fillColor: sel.color, fillOpacity: 0.62 };
    return { color: '#3f3f46', weight: 0.7, opacity: 0.9, fillColor: '#71717a', fillOpacity: 0.22 };
  }
  function restyle() {
    const s2 = selected();
    for (const [clave, l] of featureBySec) l.setStyle(styleFor(bySec.get(clave), s2));
    if (outlines) outlines.bringToFront();
  }

  const munName = (c) => op.municipios[c] || `Municipio ${c}`;
  const secLabel = (s) =>
    `Sección ${fmtSeccion(s.clave)} · ${munName(s.municipio)} · DL ${s.distritoLocal} · DF ${s.distritoFederal}${s.electores !== null ? ` · ${fmtNum(s.electores)} electores` : ''}${
      s.zona ? ` · Asignada a ${s.zona.codigo}` : ''
    }`;

  function toggleFromMap(s) {
    const m = metodoDef();
    if (!m) {
      info.textContent = 'Primero elige un método de asignación.';
      return;
    }
    if (s.zona) {
      info.textContent = `La sección ${fmtSeccion(s.clave)} ya pertenece a ${s.zona.codigo} · ${s.zona.nombre}.`;
      return;
    }
    if (m.field) {
      const u = s[m.field];
      const unit = op.unidades[m.key].find((x) => x.clave === u);
      if (!unit?.libres) return;
      if (sel.unidades.has(u)) sel.unidades.delete(u);
      else sel.unidades.add(u);
    } else if (sel.manual.has(s.clave)) sel.manual.delete(s.clave);
    else sel.manual.add(s.clave);
    $('#zTerr-err', root).textContent = '';
    renderList();
    renderTotals();
    restyle();
  }

  (async () => {
    try {
      const fc = await seccionesGeo(op.entidad.clave, secs.map((s) => s.clave));
      secLayer = L.geoJSON(fc, {
        style: (f) => styleFor(bySec.get(f.properties.seccion), selected()),
        onEachFeature(f, l) {
          const s = bySec.get(f.properties.seccion);
          featureBySec.set(s.clave, l);
          l.bindTooltip(esc(secLabel(s)), { sticky: true, direction: 'top', className: 'map-tip' });
          l.on({
            mouseover: () => {
              info.textContent = secLabel(s);
              if (!s.zona) l.setStyle({ weight: 2.5, color: sel.color });
            },
            mouseout: () => {
              l.setStyle(styleFor(s, selected()));
              info.textContent = totalsText();
            },
            click: () => toggleFromMap(s),
          });
        },
      }).addTo(map);
      homeB = secLayer.getBounds();
      map.fitBounds(homeB, { padding: [16, 16] });
      info.textContent = totalsText();
      if (sel.metodo) await drawOutlines();
    } catch (err) {
      info.textContent = `No se pudo cargar el mapa: ${err.message}`;
    }
  })();

  // Contornos de las unidades del método elegido (municipios / distritos), como referencia
  async function drawOutlines() {
    if (outlines) {
      map.removeLayer(outlines);
      outlines = null;
    }
    const m = metodoDef();
    if (!m?.layer) return;
    const key = m.layer;
    if (!unitLayerCache.has(key)) unitLayerCache.set(key, await api(`/api/geo/states/${op.entidad.clave}/layers/${key}`));
    const valid = new Set(op.unidades[m.key].map((u) => u.clave));
    const fc = unitLayerCache.get(key);
    outlines = L.geoJSON(
      { type: 'FeatureCollection', features: fc.features.filter((f) => valid.has(f.properties[LAYER_FIELD[key]])) },
      { style: { color: '#18181b', weight: 2, opacity: 0.85, fill: false, interactive: false } }
    ).addTo(map);
  }

  // ---------- Lista de opciones del método ----------
  const listBox = $('#zUnits', root);
  const list = $('#zList', root);

  function renderList() {
    const m = metodoDef();
    root.querySelectorAll('[data-metodo]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.metodo === sel.metodo)));
    if (!m) {
      listBox.hidden = true;
      return;
    }
    listBox.hidden = false;
    $('#zHelp', root).textContent = m.help;
    if (m.field) {
      list.innerHTML = op.unidades[m.key]
        .map((u) => {
          const full = u.libres === 0;
          const partial = !full && u.libres < u.secciones;
          return `<label class="unit ${sel.unidades.has(u.clave) ? 'is-selected' : ''} ${full ? 'is-disabled' : ''}">
            <input type="checkbox" value="${u.clave}" ${sel.unidades.has(u.clave) ? 'checked' : ''} ${full ? 'disabled' : ''}>
            <span class="unit__name">${esc(u.nombre)}${full ? ' <span class="badge">Asignado a otras zonas</span>' : ''}</span>
            <span class="unit__stats">${partial ? `${fmtNum(u.libres)} libres de ` : ''}${fmtNum(u.secciones)} secc${u.electoresLibres !== null ? ` · ${fmtNum(u.electoresLibres)} electores` : ''}</span>
          </label>`;
        })
        .join('');
    } else {
      const chosen = [...selected()].sort((a, b) => a - b);
      list.innerHTML = chosen.length
        ? `<div class="secchips">${chosen
            .map((c) => `<button type="button" class="secchip" data-sec="${c}" aria-label="Quitar sección ${fmtSeccion(c)}">${fmtSeccion(c)}<span aria-hidden="true">${ICONS.close}</span></button>`)
            .join('')}</div>
           <button type="button" class="link-btn" data-clear>Quitar todas</button>`
        : '<p class="units__empty">Aún no has elegido secciones.</p>';
    }
  }

  const totalsText = () => {
    const s2 = selected();
    return s2.size ? `Zona: ${fmtNum(s2.size)} secciones seleccionadas` : 'Haz clic en el mapa o en la lista para elegir.';
  };
  function renderTotals() {
    const s2 = selected();
    const electores = op.hasPadron ? [...s2].reduce((t, c) => t + (bySec.get(c).electores || 0), 0) : null;
    $('#zTotSecc', root).textContent = `${fmtNum(s2.size)} secciones`;
    $('#zTotElect', root).textContent = electores !== null ? `${fmtNum(electores)} electores` : 'Sin padrón cargado';
    info.textContent = totalsText();
  }

  root.querySelector('.methods').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-metodo]');
    if (!b || b.dataset.metodo === sel.metodo) return;
    // Los métodos no se combinan: cambiar de método reinicia la selección
    sel.metodo = b.dataset.metodo;
    sel.unidades.clear();
    sel.manual.clear();
    $('#zTerr-err', root).textContent = '';
    renderList();
    renderTotals();
    restyle();
    await drawOutlines();
  });
  list.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const c = Number(e.target.value);
    if (e.target.checked) sel.unidades.add(c);
    else sel.unidades.delete(c);
    $('#zTerr-err', root).textContent = '';
    renderList();
    renderTotals();
    restyle();
  });
  list.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-sec]');
    if (chip) {
      sel.manual.delete(Number(chip.dataset.sec));
    } else if (e.target.closest('[data-clear]')) {
      sel.manual.clear();
    } else return;
    renderList();
    renderTotals();
    restyle();
  });

  root.querySelector('.swatches').addEventListener('change', (e) => {
    if (e.target.name !== 'zonaColor') return;
    sel.color = e.target.value;
    $('#zColor-err', root).textContent = '';
    restyle();
  });

  renderList();
  renderTotals();

  // ---------- Guardar ----------
  const baseSetErrors = fieldErrorSetter(root, {
    zonaNombre: 'zNombre',
    zonaCodigo: 'zCodigo',
    name: 'cName',
    username: 'cUser',
    password: 'cPass',
    phone: 'cPhone',
    email: 'cEmail',
  });
  const setErrors = (errs = {}) => {
    $('#zColor-err', root).textContent = errs.zonaColor || '';
    $('#zTerr-err', root).textContent = errs.territorio || '';
    baseSetErrors(errs);
    if (!Object.keys(errs).some((k) => !['zonaColor', 'territorio'].includes(k))) {
      if (errs.zonaColor) $('.swatches', root).scrollIntoView({ block: 'center', behavior: 'smooth' });
      else if (errs.territorio) $('#zTerr-err', root).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const m = metodoDef();
    const body = {
      ...fd,
      zonaColor: sel.color,
      territorio: m ? { metodo: m.key, unidades: m.field ? [...sel.unidades] : [], secciones: m.field ? [] : [...selected()] } : null,
    };
    const label = editing ? 'Guardar cambios' : 'Guardar zona y crear cuenta';
    const saved = await submitWith(form, label, 'Guardando…', setErrors, $('#zFormErr', root), () =>
      api(editing ? `/api/zonas/${id}` : '/api/zonas', { method: editing ? 'PUT' : 'POST', body })
    );
    if (!saved) return;
    if (body.password) {
      showAccessDialog($('#doneDialog', root), {
        user: saved,
        password: body.password,
        wasEditing: editing,
        roleLabel: 'Coordinador de Zona',
        subtitle: `${saved.zona.codigo} · ${saved.zona.nombre} · ${fmtNum(saved.territorio.secciones.length)} secciones`,
        backLabel: 'Ir a Zonas',
        backPath: '/zonas',
      });
    } else {
      toast('Zona actualizada');
      navigate('/zonas');
    }
  });

  return destroy;
}
