// Alta y edición del Coordinador de Promoción del Voto (super administrador).
// Pantalla dividida: formulario (50 %) + mapa del territorio (50 %).
import { icon, ICONS, $, esc, fmtNum, api, fieldErrorSetter, submitWith, toast, GEO_STYLE, homeControl, navigate, abrirEnArea } from './lib.js';

export const I = {
  user: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 16 0v1"/>'),
  phone: icon('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  mail: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  userCheck: icon('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a7 7 0 0 1 11-5.7"/><path d="m16 19 2 2 4-4"/>'),
  key: icon('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>'),
  lock: icon('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  map: icon('<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>'),
  check: icon('<path d="m5 12 5 5L20 7"/>'),
  eye: ICONS.eye,
  eyeOff: icon('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  copy: icon('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2m0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2m4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3"/></svg>',
};

const METODOS = [
  { key: 'estatal', name: 'Estatal', layer: 'entidad', help: 'Todo el estado será el territorio de este coordinador.' },
  { key: 'municipio', name: 'Por municipio', layer: 'municipio', help: 'Elige el municipio que conformará el territorio.' },
  { key: 'distrito_local', name: 'Por distrito local', layer: 'distrito_local', help: 'Elige el distrito local que conformará el territorio.' },
  { key: 'distrito_federal', name: 'Por distrito federal', layer: 'distrito_federal', help: 'Elige el distrito federal que conformará el territorio.' },
];
const LAYER_KEY_FIELD = { municipio: 'municipio', distrito_local: 'distrito_local', distrito_federal: 'distrito_federal', entidad: 'entidad' };

// Contraseña aleatoria legible (sin caracteres ambiguos), siempre con letras y números
export function generatePassword(length = 12) {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const rnd = (n) => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  };
  let pw = '';
  while (!(/[A-Za-z]/.test(pw) && /\d/.test(pw))) {
    pw = Array.from({ length }, () => all[rnd(all.length)]).join('');
  }
  return pw;
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

const unitStats = (u) => `${fmtNum(u.secciones)} secc${u.electores !== null ? ` · ${fmtNum(u.electores)} electores` : ''}`;


// Ventana con el acceso recién creado o actualizado, lista para enviar por WhatsApp
export function showAccessDialog(dlg, { user, password, wasEditing, roleLabel, subtitle = '', backLabel, backPath }) {
  const url = location.origin;
  const msg = [
    `Hola ${user.name}, ${wasEditing ? 'actualizamos tu acceso a' : 'te damos la bienvenida a'} VERTEX como ${roleLabel}.`,
    '',
    `Entra en: ${url}`,
    `Usuario: ${user.username}`,
    `Contraseña: ${password}`,
    '',
    'Te recomendamos cambiar tu contraseña desde "Mi perfil" al entrar.',
  ].join('\n');
  const wa = `https://wa.me/52${user.phone}?text=${encodeURIComponent(msg)}`;
  dlg.innerHTML = `
    <div class="dialog__body">
      <div class="done__icon" aria-hidden="true">${I.check}</div>
      <h3 id="doneTitle" class="done__title">${wasEditing ? 'Acceso actualizado' : 'Cuenta creada'}</h3>
      <p class="done__sub">${esc(user.name)}${subtitle ? ` · ${esc(subtitle)}` : ''}</p>
      <dl class="creds">
        <div><dt>Entra en</dt><dd class="mono">${esc(url)}</dd></div>
        <div><dt>Usuario</dt><dd class="mono">${esc(user.username)}</dd></div>
        <div><dt>Contraseña</dt><dd class="mono">${esc(password)}</dd></div>
      </dl>
      <p class="field__help">La contraseña se muestra solo esta vez. Envíala ahora por WhatsApp o cópiala.</p>
      <div class="done__actions">
        <a class="btn btn--whatsapp" href="${esc(wa)}" target="_blank" rel="noopener">${I.whatsapp}<span>Enviar por WhatsApp</span></a>
        <button class="btn btn--secondary" type="button" data-done="copy">${I.copy}<span>Copiar acceso</span></button>
      </div>
      <div class="dialog__actions"><button class="btn btn--secondary" type="button" data-done="close">${esc(backLabel)}</button></div>
    </div>`;
  dlg.onclick = async (e) => {
    const action = e.target.closest('[data-done]')?.dataset.done;
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(msg);
        toast('Acceso copiado');
      } catch {
        toast('No se pudo copiar; selecciona el texto manualmente.');
      }
    }
    if (action === 'close') dlg.close();
  };
  dlg.onclose = () => navigate(backPath);
  abrirEnArea(dlg);
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------
export async function viewCoordinador(route, params = []) {
  const id = params[0] || null;
  const [partidos, entidades, current] = await Promise.all([
    api('/api/catalogos/partidos'),
    api('/api/territorio/entidades'),
    id ? api(`/api/coordinadores/${id}`) : Promise.resolve(null),
  ]);
  route.data = { id, partidos, entidades, current };
  const c = current || { partidos: [], territorio: null };
  const editing = Boolean(current);

  if (!entidades.length) {
    return `
      <a class="back-link" href="/usuarios" data-link>${ICONS.back}<span>Usuarios</span></a>
      <div class="empty">
        <span aria-hidden="true">${ICONS.database}</span>
        <strong>Primero carga la cartografía de un estado</strong>
        <span>Para asignar territorio necesitas al menos una entidad en <a href="/bases-de-datos" data-link>Bases de datos</a>.</span>
      </div>`;
  }

  return `
    <div class="split">
      <div class="split__form">
        <a class="back-link" href="/usuarios" data-link>${ICONS.back}<span>Usuarios</span></a>
        <div class="page-head">
          <h2>${editing ? esc(c.name) : 'Nuevo Coordinador de Promoción del Voto'}</h2>
          <p>${editing ? 'Coordinador de Promoción del Voto · edita sus datos, acceso o territorio.' : 'Captura los datos del titular, su acceso y el territorio que coordinará.'}</p>
        </div>

        <form id="coordForm" novalidate>
          <section class="card form-card" aria-labelledby="s1">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.user}</span>
              <h3 id="s1">1. Datos del titular</h3>
              <span class="form-card__aside">Campos requeridos <span class="req">*</span></span>
            </header>
            <div class="field">
              <label for="cName">Nombre completo <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="cName" name="name" maxlength="120" autocomplete="off" value="${esc(c.name || '')}" required>
              <p class="field__error" id="cName-err"></p>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="cPhone">Teléfono móvil (WhatsApp) <span class="req" aria-hidden="true">*</span></label>
                <div class="input-icon"><span aria-hidden="true">${I.phone}</span>
                  <input class="input" id="cPhone" name="phone" type="tel" inputmode="numeric" maxlength="14" autocomplete="off" value="${esc(c.phone || '')}" aria-describedby="cPhone-help" required></div>
                <p class="field__help" id="cPhone-help">10 dígitos. Ahí se enviará el acceso.</p>
                <p class="field__error" id="cPhone-err"></p>
              </div>
              <div class="field">
                <label for="cEmail">Correo electrónico</label>
                <div class="input-icon"><span aria-hidden="true">${I.mail}</span>
                  <input class="input" id="cEmail" name="email" type="email" autocomplete="off" value="${esc(c.email || '')}"></div>
                <p class="field__error" id="cEmail-err"></p>
              </div>
            </div>
            <div class="field">
              <label for="cCandidato">Nombre del candidato <span class="req" aria-hidden="true">*</span></label>
              <div class="input-icon"><span aria-hidden="true">${I.userCheck}</span>
                <input class="input" id="cCandidato" name="candidato" maxlength="120" autocomplete="off" placeholder="ej. Lic. Javier May Rodríguez" value="${esc(c.candidato || '')}" required></div>
              <p class="field__error" id="cCandidato-err"></p>
            </div>
            <fieldset class="field">
              <legend>Partido político <span class="req" aria-hidden="true">*</span> <span class="legend-help">Elige varios para formar una coalición</span></legend>
              <div class="chips" id="cPartidos" role="group" aria-describedby="cPartidos-err">
                ${partidos
                  .map(
                    (p) => `<button type="button" class="chip" data-partido="${p.key}" aria-pressed="${c.partidos.includes(p.key)}" title="${esc(p.name)}">
                      <span class="chip__dot" style="background:${p.color}" aria-hidden="true"></span>
                      <span class="chip__label">${esc(p.name)}</span>
                      <span class="chip__check" aria-hidden="true">${I.check}</span>
                    </button>`
                  )
                  .join('')}
              </div>
              <p class="field__error" id="cPartidos-err"></p>
              <p class="field__help coalicion" id="cCoalicion" aria-live="polite"></p>
            </fieldset>
            <div class="field" id="cOtroWrap" ${c.partidos.includes('OTRO') ? '' : 'hidden'}>
              <label for="cOtro">Nombre del otro partido o candidatura independiente <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="cOtro" name="partidoOtro" maxlength="60" autocomplete="off" value="${esc(c.partidoOtro || '')}">
              <p class="field__error" id="cOtro-err"></p>
            </div>
          </section>

          <section class="card form-card" aria-labelledby="s2">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.key}</span>
              <h3 id="s2">2. Credenciales de acceso</h3>
              <span class="form-card__aside">Acceso a plataforma</span>
            </header>
            <div class="field-row">
              <div class="field">
                <label for="cUser">Nombre de usuario <span class="req" aria-hidden="true">*</span></label>
                <div class="input-icon input-icon--text"><span aria-hidden="true">@</span>
                  <input class="input mono" id="cUser" name="username" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(c.username || '')}" aria-describedby="cUser-help" required></div>
                <p class="field__help" id="cUser-help">${editing ? 'Con este usuario inicia sesión.' : 'Te sugerimos uno a partir del nombre; puedes cambiarlo.'}</p>
                <p class="field__ok" id="cUser-ok" aria-live="polite"></p>
                <p class="field__error" id="cUser-err"></p>
              </div>
              <div class="field">
                <div class="label-row">
                  <label for="cPass">${editing ? 'Nueva contraseña (opcional)' : 'Contraseña <span class="req" aria-hidden="true">*</span>'}</label>
                  <button type="button" class="link-btn" id="cGen">Generar segura</button>
                </div>
                <div class="input-icon input-icon--action"><span aria-hidden="true">${I.lock}</span>
                  <input class="input mono" id="cPass" name="password" type="password" autocomplete="new-password" spellcheck="false" placeholder="${editing ? 'Dejar en blanco para conservar la actual' : ''}" aria-describedby="cPass-help" ${editing ? '' : 'required'}>
                  <button type="button" class="input-action" id="cShow" aria-label="Mostrar contraseña" aria-pressed="false">${I.eye}</button>
                </div>
                <p class="field__help" id="cPass-help">Mínimo 8 caracteres, con letras y números.</p>
                <p class="field__error" id="cPass-err"></p>
              </div>
            </div>
          </section>

          <section class="card form-card" aria-labelledby="s3">
            <header class="form-card__head">
              <span class="form-card__icon" aria-hidden="true">${I.map}</span>
              <h3 id="s3">3. Territorio</h3>
              <span class="form-card__aside">Una sola entidad</span>
            </header>
            <div class="field">
              <label for="cEntidad">Entidad <span class="req" aria-hidden="true">*</span></label>
              <select class="input" id="cEntidad">
                ${entidades
                  .map((e) => `<option value="${e.clave}" ${c.territorio?.entidad === e.clave ? 'selected' : ''}>${esc(e.nombre)}${e.padron ? '' : ' (sin padrón)'}</option>`)
                  .join('')}
              </select>
            </div>
            <fieldset class="field">
              <legend>Método de asignación de secciones <span class="req" aria-hidden="true">*</span></legend>
              <div class="methods" role="radiogroup" aria-label="Método de asignación">
                ${METODOS.map(
                  (m) => `<button type="button" class="method" role="radio" data-metodo="${m.key}" aria-checked="${c.territorio?.tipo === m.key}">${esc(m.name)}</button>`
                ).join('')}
              </div>
            </fieldset>
            <div class="units" id="cUnits" hidden>
              <p class="units__help" id="cUnitsHelp"></p>
              <div class="units__search" id="cUnitsSearchWrap">
                <span aria-hidden="true">${ICONS.search}</span>
                <input class="input" type="search" id="cUnitsSearch" placeholder="Buscar" aria-label="Buscar en la lista" autocomplete="off">
              </div>
              <div class="units__list" id="cUnitsList" role="radiogroup" aria-label="Opciones del territorio"></div>
            </div>
            <p class="field__error" id="cTerr-err"></p>
            <div class="units__total" aria-live="polite">
              <span id="cTotSecc">Sin territorio seleccionado</span>
              <span id="cTotElect"></span>
            </div>
          </section>

          <p class="form-error" id="cFormErr" role="alert"></p>
          <div class="form-footer">
            <a class="btn btn--secondary" href="/usuarios" data-link>Cancelar</a>
            <button class="btn" type="submit">${editing ? 'Guardar cambios' : 'Guardar territorio y crear cuenta'}</button>
          </div>
        </form>
      </div>

      <aside class="split__map" aria-label="Mapa del territorio">
        <div class="map map--split" id="cMap"></div>
        <p class="map-card__info" id="cMapInfo" aria-live="polite">Elige un método de asignación para ver las opciones en el mapa.</p>
      </aside>
    </div>

    <dialog class="dialog dialog--wide" id="doneDialog" aria-labelledby="doneTitle"></dialog>`;
}

// ---------------------------------------------------------------------------
// Comportamiento
// ---------------------------------------------------------------------------
export function mountCoordinador(root, route) {
  const { id, partidos, current } = route.data;
  const form = $('#coordForm', root);
  if (!form) return undefined;
  const editing = Boolean(current);

  const sel = {
    partidos: new Set(current?.partidos || []),
    entidad: current?.territorio?.entidad || Number($('#cEntidad', root).value),
    tipo: current?.territorio?.tipo || null,
    clave: current?.territorio?.clave ?? null,
  };
  let opciones = null; // opciones del territorio de la entidad elegida

  // ---------- Partidos (selección múltiple = coalición) ----------
  const otroWrap = $('#cOtroWrap', root);
  const renderCoalicion = () => {
    const names = partidos.filter((p) => sel.partidos.has(p.key)).map((p) => (p.key === 'OTRO' ? $('#cOtro', root).value || 'Otro' : p.name));
    $('#cCoalicion', root).textContent = names.length > 1 ? `Coalición: ${names.join(' · ')}` : '';
  };
  $('#cPartidos', root).addEventListener('click', (e) => {
    const chip = e.target.closest('[data-partido]');
    if (!chip) return;
    const key = chip.dataset.partido;
    if (sel.partidos.has(key)) sel.partidos.delete(key);
    else sel.partidos.add(key);
    chip.setAttribute('aria-pressed', String(sel.partidos.has(key)));
    otroWrap.hidden = !sel.partidos.has('OTRO');
    if (key === 'OTRO' && sel.partidos.has('OTRO')) $('#cOtro', root).focus();
    renderCoalicion();
  });
  $('#cOtro', root).addEventListener('input', renderCoalicion);
  renderCoalicion();

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
  const suggest = debounce(async () => {
    if (userTouched) return;
    const name = $('#cName', root).value.trim();
    if (name.length < 3) return;
    const r = await api(`/api/usernames/suggest?name=${encodeURIComponent(name)}`).catch(() => null);
    if (r?.username && !userTouched) {
      userInput.value = r.username;
      checkUser();
    }
  }, 400);
  $('#cName', root).addEventListener('input', suggest);
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

  // ---------- Mapa ----------
  const mapEl = $('#cMap', root);
  const info = $('#cMapInfo', root);
  const map = L.map(mapEl, { preferCanvas: true, zoomControl: false, scrollWheelZoom: false, zoomSnap: 0.5, minZoom: 5, maxZoom: 18 });
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());
  // El contenedor cambia de tamaño con el sidebar y la ventana
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(mapEl);

  let entityBounds = null;
  const home = homeControl(() => entityBounds && map.fitBounds(entityBounds, { padding: [16, 16] }));
  home.addTo(map);
  const layerCache = new Map();
  let outline = null;
  let unitsLayer = null;
  const featureByClave = new Map();

  const STYLE_SELECTED = { color: '#0a0a0a', weight: 3, opacity: 1, fillColor: '#171717', fillOpacity: 0.4 };
  const styleFor = (clave) => (clave === sel.clave ? STYLE_SELECTED : GEO_STYLE.base);

  async function getLayer(key) {
    const k = `${sel.entidad}:${key}`;
    if (!layerCache.has(k)) layerCache.set(k, await api(`/api/geo/states/${sel.entidad}/layers/${key}`));
    return layerCache.get(k);
  }

  async function loadEntidad() {
    mapEl.classList.add('is-busy');
    try {
      opciones = await api(`/api/territorio/${sel.entidad}/opciones`);
      const ent = await getLayer('entidad');
      if (outline) map.removeLayer(outline);
      outline = L.geoJSON(ent, { style: GEO_STYLE.outline }).addTo(map);
      entityBounds = outline.getBounds();
      map.fitBounds(entityBounds, { padding: [16, 16] });
    } finally {
      mapEl.classList.remove('is-busy');
    }
  }

  async function showLayer() {
    if (unitsLayer) {
      map.removeLayer(unitsLayer);
      unitsLayer = null;
    }
    featureByClave.clear();
    if (!sel.tipo) return;
    const metodo = METODOS.find((m) => m.key === sel.tipo);
    const units = new Map(opciones.tipos[sel.tipo].map((u) => [u.clave, u]));
    mapEl.classList.add('is-busy');
    try {
      const fc = await getLayer(metodo.layer);
      const field = LAYER_KEY_FIELD[metodo.layer];
      unitsLayer = L.geoJSON(fc, {
        style: (f) => styleFor(sel.tipo === 'estatal' ? sel.entidad : f.properties[field]),
        onEachFeature(f, layer) {
          const clave = sel.tipo === 'estatal' ? sel.entidad : f.properties[field];
          const u = units.get(clave);
          featureByClave.set(clave, layer);
          const label = u ? `${u.nombre} · ${unitStats(u)}` : String(clave);
          layer.bindTooltip(esc(label), { sticky: true, direction: 'top', className: 'map-tip' });
          layer.on({
            mouseover: () => {
              if (clave !== sel.clave) layer.setStyle(GEO_STYLE.hover);
              info.textContent = label;
            },
            mouseout: () => {
              layer.setStyle(styleFor(clave));
              info.textContent = selectionText();
            },
            click: () => choose(clave, { fly: false }),
          });
        },
      }).addTo(map);
      if (outline) outline.bringToFront();
      if (sel.clave !== null) focusSelected();
      info.textContent = selectionText();
    } finally {
      mapEl.classList.remove('is-busy');
    }
  }

  function focusSelected() {
    const layer = featureByClave.get(sel.clave);
    if (layer) {
      layer.setStyle(STYLE_SELECTED);
      layer.bringToFront();
      if (outline) outline.bringToFront();
      map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 13 });
    }
  }

  // ---------- Métodos y opciones ----------
  const unitsBox = $('#cUnits', root);
  const unitsList = $('#cUnitsList', root);
  const search = $('#cUnitsSearch', root);

  const selectedUnit = () => (sel.tipo && sel.clave !== null ? opciones?.tipos[sel.tipo].find((u) => u.clave === sel.clave) : null);
  const selectionText = () => {
    const u = selectedUnit();
    return u ? `Seleccionado: ${u.nombre} · ${unitStats(u)}` : 'Haz clic en el mapa o en la lista para elegir.';
  };

  function renderTotals() {
    const u = selectedUnit();
    $('#cTotSecc', root).textContent = u ? `${u.nombre} · ${fmtNum(u.secciones)} secciones` : 'Sin territorio seleccionado';
    $('#cTotElect', root).textContent = u ? (u.electores !== null ? `${fmtNum(u.electores)} electores` : 'Sin padrón cargado') : '';
  }

  function renderUnits() {
    if (!sel.tipo) {
      unitsBox.hidden = true;
      return;
    }
    const metodo = METODOS.find((m) => m.key === sel.tipo);
    unitsBox.hidden = false;
    $('#cUnitsHelp', root).textContent = metodo.help;
    const list = opciones.tipos[sel.tipo];
    $('#cUnitsSearchWrap', root).hidden = list.length < 8;
    const q = search.value.trim().toLowerCase();
    const rows = list.filter((u) => !q || u.nombre.toLowerCase().includes(q) || String(u.clave) === q);
    unitsList.innerHTML = rows.length
      ? rows
          .map(
            (u) => `<label class="unit ${u.clave === sel.clave ? 'is-selected' : ''}">
              <input type="radio" name="unidad" value="${u.clave}" ${u.clave === sel.clave ? 'checked' : ''}>
              <span class="unit__name">${esc(u.nombre)}</span>
              <span class="unit__stats">${unitStats(u)}</span>
            </label>`
          )
          .join('')
      : '<p class="units__empty">Sin coincidencias.</p>';
  }

  function choose(clave, { fly = true } = {}) {
    const prev = sel.clave;
    sel.clave = clave;
    $('#cTerr-err', root).textContent = '';
    if (prev !== null && featureByClave.get(prev)) featureByClave.get(prev).setStyle(GEO_STYLE.base);
    if (fly) focusSelected();
    else {
      const layer = featureByClave.get(clave);
      if (layer) {
        layer.setStyle(STYLE_SELECTED);
        layer.bringToFront();
        if (outline) outline.bringToFront();
      }
    }
    renderUnits();
    renderTotals();
    info.textContent = selectionText();
    const checked = unitsList.querySelector('input:checked');
    if (checked) checked.closest('.unit').scrollIntoView({ block: 'nearest' });
  }

  async function setMetodo(tipo, { keepClave = false } = {}) {
    sel.tipo = tipo;
    if (!keepClave) sel.clave = tipo === 'estatal' ? sel.entidad : null;
    root.querySelectorAll('[data-metodo]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.metodo === tipo)));
    search.value = '';
    renderUnits();
    renderTotals();
    await showLayer();
    if (sel.clave === null && entityBounds) map.fitBounds(entityBounds, { padding: [16, 16] });
  }

  root.querySelector('.methods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metodo]');
    if (b && b.dataset.metodo !== sel.tipo) setMetodo(b.dataset.metodo);
  });
  root.querySelector('.methods').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const btns = [...root.querySelectorAll('[data-metodo]')];
    const i = btns.indexOf(document.activeElement);
    const next = btns[(i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : btns.length - 1)) % btns.length];
    next.focus();
    setMetodo(next.dataset.metodo);
  });
  unitsList.addEventListener('change', (e) => {
    if (e.target.name === 'unidad') choose(Number(e.target.value));
  });
  search.addEventListener('input', renderUnits);

  $('#cEntidad', root).addEventListener('change', async (e) => {
    sel.entidad = Number(e.target.value);
    sel.clave = null;
    await loadEntidad();
    await setMetodo(sel.tipo || null);
  });

  // Carga inicial
  (async () => {
    try {
      await loadEntidad();
      if (sel.tipo) await setMetodo(sel.tipo, { keepClave: true });
    } catch (err) {
      info.textContent = `No se pudo cargar el mapa: ${err.message}`;
    }
  })();

  // ---------- Guardar ----------
  const fieldIds = {
    name: 'cName',
    phone: 'cPhone',
    email: 'cEmail',
    candidato: 'cCandidato',
    partidos: 'cPartidos',
    partidoOtro: 'cOtro',
    username: 'cUser',
    password: 'cPass',
    territorio: 'cTerr',
  };
  const baseSetErrors = fieldErrorSetter(root, Object.fromEntries(Object.entries(fieldIds).filter(([k]) => !['partidos', 'territorio'].includes(k))));
  // Partidos y territorio no son <input>: su error se muestra sin aria-invalid
  const setErrors = (errs = {}) => {
    $('#cPartidos-err', root).textContent = errs.partidos || '';
    $('#cTerr-err', root).textContent = errs.territorio || '';
    baseSetErrors(errs);
    if (!Object.keys(errs).some((k) => !['partidos', 'territorio'].includes(k))) {
      if (errs.partidos) $('#cPartidos', root).scrollIntoView({ block: 'center', behavior: 'smooth' });
      else if (errs.territorio) $('#cTerr-err', root).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = {
      ...fd,
      partidos: [...sel.partidos],
      territorio: sel.tipo ? { entidad: sel.entidad, tipo: sel.tipo, clave: sel.clave } : null,
    };
    const label = editing ? 'Guardar cambios' : 'Guardar territorio y crear cuenta';
    const saved = await submitWith(form, label, 'Guardando…', setErrors, $('#cFormErr', root), () =>
      api(editing ? `/api/coordinadores/${id}` : '/api/coordinadores', { method: editing ? 'PUT' : 'POST', body })
    );
    if (!saved) return;
    if (body.password) {
      const t = saved.territorioResumen;
      showAccessDialog($('#doneDialog', root), {
        user: saved,
        password: body.password,
        wasEditing: editing,
        roleLabel: 'Coordinador de Promoción del Voto',
        subtitle: t ? `${t.tipo}: ${t.nombre}` : '',
        backLabel: 'Ir a Usuarios',
        backPath: '/usuarios',
      });
    }
    else {
      toast('Cambios guardados');
      navigate('/usuarios');
    }
  });

  // ---------- Resultado: acceso para enviar por WhatsApp ----------
  return () => {
    ro.disconnect();
    map.remove();
  };
}
