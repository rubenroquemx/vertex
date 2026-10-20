import {
  icon,
  ICONS,
  $,
  esc,
  initials,
  fmtDate,
  fmtPhone,
  fmtNum,
  fmtSeccion,
  fmtDateTime,
  avatarInner,
  api,
  fieldErrorSetter,
  submitWith,
  toast,
  uploadFile,
  GEO_STYLE,
  homeControl,
  abrirEnArea,
  navigate,
} from './lib.js';
import { viewCoordinador, mountCoordinador, I as CI, showAccessDialog, generatePassword, debounce } from './coordinador.js';
import { openDeleteFlow } from './eliminar.js';
import { viewZonas, mountZonas, viewZona, mountZona, baseMap, seccionesGeo } from './zonas.js';
import { viewEscritorioCPV, mountEscritorioCPV } from './escritorio-cpv.js';
import { viewResponsables, mountResponsables, viewResponsable, mountResponsable } from './responsables.js';
import { viewConfiguracionCPV, mountConfiguracionCPV } from './configuracion-cpv.js';
import { viewConfiguracionSA, mountConfiguracionSA } from './configuracion-sa.js';
import { viewMaterial, mountMaterial, viewEntregar, mountEntregar, viewOrden, mountOrden } from './material.js';
import { viewPanelSA, mountPanelSA } from './panel-sa.js';
import { viewBitacora, mountBitacora } from './bitacora.js';
import { viewEscritorioZona, mountEscritorioZona } from './escritorio-zona.js';
import { viewEscritorioSeccion, mountEscritorioSeccion } from './escritorio-seccion.js';
import { viewRevision, mountRevision } from './revision.js';
import { viewEscritorioPromotor } from './escritorio-promotor.js';
import { viewInforme, mountInforme } from './informe.js';
import { viewExternas, mountExternas, viewListaPersonas, mountListaPersonas } from './externas.js';
import { viewAgenda, mountAgenda, viewEventos, viewFormEvento, mountFormEvento, viewEvento, mountEvento, viewReporte, mountReporte } from './agenda.js';
import { viewPendientes, mountPendientes } from './pendientes.js';
import { viewDirectorio, mountDirectorio } from './directorio.js';
import { sesion, pendientes as pendientesLocales, iniciarSincronizacion, prepararSinConexion, borrarDatosLocales, esErrorDeRed } from './offline.js';
import { viewNotificaciones, mountNotificaciones, iniciarCampana, actualizarContador } from './notificaciones.js';
import { viewNuevoPromovido, mountNuevoPromovido, viewPromovidos, viewPromovido, mountPromovido } from './promovidos.js';

const state = { me: null, routes: new Map() };

// ---------------------------------------------------------------------------
// Dashboards: uno por nivel, independientes entre sí.
// Su contenido está pendiente de definir; no compartir elementos entre ellos.
// ---------------------------------------------------------------------------
const pendingDashboard = (me) => `
  <div class="page-head">
    <p>${esc(me.role.name)}</p>
  </div>
  <div class="empty">
    <span aria-hidden="true">${ICONS.dashboard}</span>
    <strong>Dashboard en definición</strong>
    <span>El contenido de este panel se definirá próximamente.</span>
  </div>`;

const DASHBOARDS = {
  superadmin: (me) => pendingDashboard(me),
  coord_promocion: (me) => pendingDashboard(me),
  coord_zona: (me) => pendingDashboard(me),
  resp_seccion: (me) => pendingDashboard(me),
  promotor: (me) => pendingDashboard(me),
};

// ---------------------------------------------------------------------------
// Menú por nivel
// ---------------------------------------------------------------------------
// Material electoral: CPV, Coordinador de Zona y Responsable de Sección (el Promotor no participa)
const MATERIAL = { path: '/material', title: 'Material electoral', icon: 'box', view: (r, p) => viewMaterial(r, p, state), mount: mountMaterial };
// Agenda de asambleas y recorridos: toda la estructura (el Promotor solo ve lo programado)
const AGENDA = { path: '/agenda', title: 'Agenda', icon: 'calendar', view: (r, p) => viewAgenda(r, p, state), mount: mountAgenda };
// Estructuras externas: listas de otras estructuras para cotejar (solo CPV y super administrador)
// `dock: false`: no va en la barra inferior del celular (tarea de computadora); sí en el menú lateral
// Directorio: todas las personas de la estructura del CPV, filtrables por nivel
const DIRECTORIO = { path: '/directorio', title: 'Directorio', icon: 'directorio', view: viewDirectorio, mount: mountDirectorio };
const EXTERNAS = { path: '/estructuras-externas', title: 'Estructuras externas', icon: 'users', dock: false, view: (r, p) => viewExternas(r, p, state), mount: mountExternas };

function buildMenu(me) {
  const key = me.role.key;
  // El CPV tiene su propio escritorio; los demás niveles conservan su panel (en definición)
  const inicio =
    key === 'coord_promocion'
      ? { path: '/', title: 'Panel', icon: 'dashboard', view: viewEscritorioCPV, mount: mountEscritorioCPV }
      : key === 'resp_seccion'
        ? { path: '/', title: 'Panel', icon: 'dashboard', view: viewEscritorioSeccion, mount: mountEscritorioSeccion }
        : key === 'superadmin'
          ? { path: '/', title: 'Panel', icon: 'dashboard', view: viewPanelSA, mount: mountPanelSA }
          : key === 'coord_zona'
            ? { path: '/', title: 'Panel', icon: 'dashboard', view: viewEscritorioZona, mount: mountEscritorioZona }
            : key === 'promotor'
              ? { path: '/', title: 'Panel', icon: 'dashboard', view: viewEscritorioPromotor }
        : { path: '/', title: 'Panel', icon: 'dashboard', view: () => DASHBOARDS[key](me) };
  const groups = [{ label: 'General', items: [inicio] }];

  if (key === 'superadmin') {
    groups[0].items.push({ path: '/usuarios', title: 'Usuarios', icon: 'users', view: viewEstructura, mount: mountEstructura });
  } else if (key === 'coord_promocion') {
    groups.push({
      label: 'Estructura',
      items: [
        {
          path: '/zonas',
          title: 'Zonas',
          icon: 'map',
          view: (r, p) => viewZonas(r, p, state),
          mount: (root, r, p) => mountZonas(root, r, p, state, { enterGodMode, openDeleteFlow }),
        },
        EXTERNAS,
      ],
    });
    groups.push({ label: 'Operación', items: [AGENDA, DIRECTORIO, MATERIAL] });
    groups.push({
      label: 'Sistema',
      items: [{ path: '/configuracion', title: 'Configuración', icon: 'settings', view: viewConfiguracionCPV, mount: mountConfiguracionCPV }],
    });
  } else if (key === 'coord_zona') {
    groups.push({
      label: 'Estructura',
      items: [
        {
          path: '/responsables',
          title: 'Responsables',
          icon: 'users',
          view: (r, p) => viewResponsables(r, p, state),
          mount: (root, r, p) => mountResponsables(root, r, p, state, { enterGodMode, openDeleteFlow }),
        },
      ],
    });
    groups.push({ label: 'Operación', items: [AGENDA, MATERIAL] });
  } else if (key === 'resp_seccion') {
    // Sin separador de sección: va junto al Panel
    groups[0].items.push(
      { path: '/estructura', title: 'Promotores territoriales', icon: 'tree', view: viewEstructura, mount: mountEstructura },
      // `fab`: en celulares va como botón + al centro de la barra inferior
      { path: '/estructura/nuevo', title: 'Nuevo promotor', icon: 'plus', fab: true, view: viewEstructura, mount: mountEstructura },
      // Bandeja para aprobar o rechazar lo que capturan sus promotores
      { path: '/promovidos', title: 'Promovidos', icon: 'check', view: viewRevision, mount: mountRevision },
      MATERIAL,
      AGENDA
    );
  } else if (me.childRole) {
    groups.push({
      label: 'Estructura',
      items: [
        {
          path: '/estructura',
          title: 'Mi estructura',
          icon: 'tree',
          view: viewEstructura,
          mount: mountEstructura,
        },
      ],
    });
  }

  if (key === 'promotor') {
    groups.push({
      label: 'Captura',
      items: [
        // `fab`: en celulares va como botón + al centro de la barra inferior
        { path: '/promovidos/nuevo', title: 'Nuevo promovido', icon: 'plus', fab: true, view: viewNuevoPromovido, mount: mountNuevoPromovido },
        { path: '/promovidos', title: 'Promovidos', icon: 'users', view: viewPromovidos },
        AGENDA,
      ],
    });
  }

  if (key === 'superadmin') {
    groups.push(
      {
        label: 'Datos',
        items: [{ path: '/bases-de-datos', title: 'Bases de datos', icon: 'database', view: viewBasesDatos, mount: mountBasesDatos }, EXTERNAS],
      },
      {
        label: 'Sistema',
        items: [
          { path: '/configuracion', title: 'Configuración', icon: 'settings', view: viewConfiguracionSA, mount: mountConfiguracionSA },
          { path: '/bitacora', title: 'Bitácora', icon: 'bitacora', view: viewBitacora, mount: mountBitacora },
        ],
      }
    );
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------
function placeholder(desc) {
  return (route) => `
    <div class="page-head">
      <p>${desc}</p>
    </div>
    <div class="empty">
      <span aria-hidden="true">${ICONS[route.icon]}</span>
      <strong>Módulo en construcción</strong>
      <span>Esta sección estará disponible próximamente.</span>
    </div>`;
}

// ---------- Estructura: cuentas de la rama + alta del nivel inferior ----------
async function viewEstructura(route) {
  const { me } = state;
  const isSA = me.role.key === 'superadmin';
  const [list, partidos] = await Promise.all([api('/api/users'), isSA ? api('/api/catalogos/partidos') : Promise.resolve([])]);
  route.data = list;
  route.partidos = partidos;
  currentPartidos = partidos;
  const child = me.childRole;
  // Responsable de Sección: lista de sus promotores con su avance (como la de promovidos)
  const esRS = me.role.key === 'resp_seccion';
  if (esRS) route.avance = await api('/api/panel/seccion/promotores');

  return `
    ${esRS ? '' : `<div class="page-head page-head--actions">
      <div>
        <p>${esc(child.plural)} ${isSA ? 'registrados en el sistema' : 'que dependen de ti'}.${
          me.godMode || isSA ? ' Para ver los niveles inferiores, entra a la cuenta de cada uno.' : ''
        }</p>
      </div>
      <button class="btn" type="button" data-action="new">${ICONS.plus}<span>Nuevo ${esc(child.name)}</span></button>
    </div>`}

    <div class="toolbar">
      <label class="field--inline">
        <span class="sr-only">Buscar por nombre</span>
        <span class="field__icon" aria-hidden="true">${ICONS.search}</span>
        <input class="input input--icon" type="search" id="fSearch" placeholder="Buscar por nombre" autocomplete="off">
      </label>
      <span class="toolbar__count" id="fCount" aria-live="polite"></span>
      ${esRS ? `<button class="btn toolbar__new" type="button" data-action="new">${ICONS.plus}<span>Nuevo ${esc(child.name)}</span></button>` : ''}
    </div>

    <div class="${esRS ? 'prom-avance' : 'table-wrap'}" id="usersTable"></div>

    <dialog class="dialog" id="newUserDialog" aria-labelledby="newUserTitle">
      <form class="dialog__body" id="newUserForm" novalidate>
        <div class="dialog__head">
          <h3 class="sr-only" id="newUserTitle">Nuevo ${esc(child.name)}</h3>
          <button class="icon-btn icon-btn--always" type="button" data-action="close" aria-label="Cerrar">${ICONS.close}</button>
        </div>
        <p class="dialog__meta">Dependerá de: <strong>${esc(me.user.name)}</strong></p>
        <div class="field">
          <label for="nuName">Nombre completo <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="nuName" name="name" required autocomplete="off" maxlength="120" placeholder="ej. María López Hernández">
          <p class="field__error" id="nuName-err"></p>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="nuUser">Usuario de acceso <span class="req" aria-hidden="true">*</span></label>
            <div class="input-icon input-icon--text"><span aria-hidden="true">@</span>
              <input class="input mono" id="nuUser" name="username" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" required></div>
            <p class="field__help">Te sugerimos uno a partir del nombre; puedes cambiarlo.</p>
            <p class="field__ok" id="nuUser-ok" aria-live="polite"></p>
            <p class="field__error" id="nuUser-err"></p>
          </div>
          <div class="field">
            <div class="label-row">
              <label for="nuPass">Contraseña <span class="req" aria-hidden="true">*</span></label>
              <button type="button" class="link-btn" data-action="gen-pass">Generar segura</button>
            </div>
            <div class="input-icon input-icon--action"><span aria-hidden="true">${CI.lock}</span>
              <input class="input mono" id="nuPass" name="password" type="text" autocomplete="new-password" spellcheck="false" required>
              <button type="button" class="input-action" data-action="show-pass" aria-label="Ocultar contraseña" aria-pressed="true">${CI.eyeOff}</button>
            </div>
            <p class="field__help">Mínimo 8 caracteres, con letras y números.</p>
            <p class="field__error" id="nuPass-err"></p>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="nuPhone">Teléfono / WhatsApp <span class="req" aria-hidden="true">*</span></label>
            <div class="input-icon"><span aria-hidden="true">${CI.phone}</span>
              <input class="input" id="nuPhone" name="phone" type="tel" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="10 dígitos" required></div>
            <p class="field__error" id="nuPhone-err"></p>
          </div>
          <div class="field">
            <label for="nuEmail">Correo electrónico</label>
            <div class="input-icon"><span aria-hidden="true">${CI.mail}</span>
              <input class="input" id="nuEmail" name="email" type="email" autocomplete="off" placeholder="opcional"></div>
            <p class="field__error" id="nuEmail-err"></p>
          </div>
        </div>
        <p class="form-error" id="nuFormErr" role="alert"></p>
        <div class="dialog__actions">
          <button class="btn btn--secondary" type="button" data-action="close">Cancelar</button>
          <button class="btn" type="submit">Crear cuenta</button>
        </div>
      </form>
    </dialog>`;
}

// ---------- Tarjetas de Coordinadores de Promoción del Voto (Super admin) ----------
let currentPartidos = [];
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// "Distrito 4 Local, Tabasco", "Municipio de Centro, Tabasco", "Estatal, Tabasco"
function candidaturaTexto(t) {
  if (!t) return 'Sin territorio asignado';
  const ent = titleCase(t.entidad);
  const n = (t.nombre.match(/\d+/) || [''])[0];
  if (t.tipo === 'Estatal') return `Estatal, ${ent}`;
  if (t.tipo === 'Municipio') return `Municipio de ${titleCase(t.nombre)}, ${ent}`;
  if (t.tipo === 'Distrito local') return `Distrito ${n} Local, ${ent}`;
  if (t.tipo === 'Distrito federal') return `Distrito ${n} Federal, ${ent}`;
  return `${t.nombre}, ${ent}`;
}

const partidosDe = (u, catalogo) =>
  (u.partidos || []).map((k) => {
    const p = catalogo.find((x) => x.key === k);
    return { name: k === 'OTRO' ? u.partidoOtro || 'Otro' : p?.name || k, color: p?.color || '#a3a3a3' };
  });


function dialogo(id) {
  let dlg = $(`#${id}`);
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = id;
    dlg.className = 'dialog dialog--wide';
    view.append(dlg);
  }
  return dlg;
}

// Ficha del Coordinador de Promoción del Voto: datos (izquierda) + mapa del territorio (derecha)
async function viewFichaCpv(route, params) {
  const [u, catalogo] = await Promise.all([api(`/api/coordinadores/${params[0]}`), api('/api/catalogos/partidos')]);
  route.cpv = u;
  currentPartidos = catalogo;
  const t = u.territorioResumen;
  const parts = partidosDe(u, catalogo);
  const dato = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const canDelete = Boolean(state.me.canDelete);
  return `
    <div class="split">
      <div class="split__form ficha">
        <a class="back-link" href="/usuarios" data-link>${ICONS.back}<span>Usuarios</span></a>
        <p class="cpv-card__label">Candidato</p>
        <h2 class="ficha__title">${esc(u.candidato || 'Sin candidato')}</h2>
        <p class="ficha__sub">${esc(candidaturaTexto(t))}</p>
        ${parts.length ? `<div class="ficha__parties">${parts.map((p) => `<span class="cpv-party"><span class="cpv-party__dot" style="background:${p.color}" aria-hidden="true"></span>${esc(p.name)}</span>`).join('')}${parts.length > 1 ? '<span class="badge">Coalición</span>' : ''}</div>` : ''}

        <section class="ficha__sec" aria-label="Territorio">
          <h4>Territorio</h4>
          <dl class="ficha__grid">
            ${dato('Entidad', esc(t ? titleCase(t.entidad) : '—'))}
            ${dato('Asignación', esc(t ? (t.tipo === 'Estatal' ? 'Toda la entidad' : t.tipo === 'Municipio' ? `Municipio de ${titleCase(t.nombre)}` : titleCase(t.nombre)) : '—'))}
            ${dato('Secciones', t ? fmtNum(t.secciones) : '—')}
            ${dato('Electores', t && t.electores !== null ? fmtNum(t.electores) : '—')}
            ${dato('Zonas creadas', fmtNum(u.zonas || 0))}
          </dl>
          <ul class="ficha__zonas" id="fZonasList" hidden></ul>
        </section>

        <section class="ficha__sec" aria-label="Titular">
          <h4>Titular</h4>
          <div class="ficha__holder">
            <span class="avatar ficha__avatar" aria-hidden="true">${avatarInner(u)}</span>
            <div><strong>${esc(u.name)}</strong><span class="muted-block">Coordinador de Promoción del Voto</span></div>
          </div>
          <dl class="ficha__grid">
            ${dato('Teléfono', u.phone ? `<a href="tel:+52${esc(u.phone)}">${esc(fmtPhone(u.phone))}</a>` : '—')}
            ${dato('Correo', u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : '—')}
            ${dato('Usuario', u.username ? `<span class="mono">@${esc(u.username)}</span>` : 'Sin acceso')}
            ${dato('Alta', fmtDate(u.createdAt))}
          </dl>
        </section>

        <div class="ficha__actions">
          <div class="cpv-card__group">
            ${u.phone ? `<a class="icon-btn cpv-card__act" href="tel:+52${esc(u.phone)}" title="Llamar" aria-label="Llamar a ${esc(u.name)}">${CI.phone}</a>
            <a class="icon-btn cpv-card__act" href="https://wa.me/52${esc(u.phone)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp con ${esc(u.name)}">${CI.whatsapp}</a>` : ''}
            <button class="icon-btn cpv-card__act" type="button" data-f="acceso" title="Compartir acceso (genera contraseña nueva)" aria-label="Compartir acceso">${CI.copy}</button>
            ${canDelete ? `<button class="icon-btn cpv-card__act" type="button" data-f="delete" data-danger title="Eliminar ${esc(u.name)} y su rama" aria-label="Eliminar ${esc(u.name)} y su rama">${ICONS.trash}</button>` : ''}
          </div>
          <div class="cpv-card__group">
            <a class="btn btn--secondary btn--sm" href="/usuarios/${u.id}/editar" data-link>${ICONS.edit}<span>Editar</span></a>
            <button class="btn btn--sm" type="button" data-f="god">${ICONS.eye}<span>Entrar a la cuenta</span></button>
          </div>
        </div>
      </div>

      <aside class="split__map" aria-label="Mapa del territorio">
        <div class="map map--split" id="fMap"></div>
        <p class="map-card__info" id="fMapInfo" aria-live="polite">${t ? 'Cargando mapa…' : 'Sin territorio asignado.'}</p>
      </aside>
    </div>`;
}

function mountFichaCpv(root, route) {
  const u = route.cpv;
  root.onclick = (e) => {
    const btn = e.target.closest('[data-f]');
    const a = btn?.dataset.f;
    if (a === 'acceso') compartirAccesoCpv(u);
    if (a === 'delete') openDeleteFlow(u, state.me, () => navigate('/usuarios'));
    if (a === 'god') {
      btn.disabled = true;
      enterGodMode(u.id).catch((err) => {
        btn.disabled = false;
        toast(err.message);
      });
    }
  };

  const mapEl = $('#fMap', root);
  const info = $('#fMapInfo', root);
  const { map, destroy } = baseMap(mapEl);
  let vivo = true;
  if (u.territorio) {
    mapEl.classList.add('is-busy');
    api(`/api/coordinadores/${u.id}/mapa`)
      .then(async (m) => {
        const [ent, secc] = await Promise.all([api(`/api/geo/states/${m.entidad}/layers/entidad`), seccionesGeo(m.entidad, m.secciones)]);
        if (!vivo) return;
        const zonaDe = new Map();
        for (const z of m.zonas) for (const s of z.secciones) zonaDe.set(s, z);
        L.geoJSON(ent, { style: GEO_STYLE.outline }).addTo(map);
        const capa = L.geoJSON(secc, {
          style: (f) => {
            const z = zonaDe.get(f.properties.seccion);
            return z
              ? { color: z.color, weight: 0.8, opacity: 0.9, fillColor: z.color, fillOpacity: 0.45 }
              : { color: '#0a0a0a', weight: 0.8, opacity: 0.8, fillColor: '#171717', fillOpacity: 0.2 };
          },
          onEachFeature(f, layer) {
            const z = zonaDe.get(f.properties.seccion);
            layer.bindTooltip(esc(`Sección ${fmtSeccion(f.properties.seccion)}${z ? ` · ${z.nombre}` : ''}`), { sticky: true, direction: 'top', className: 'map-tip' });
          },
        }).addTo(map);
        const bounds = capa.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [16, 16] });
          homeControl(() => map.fitBounds(bounds, { padding: [16, 16] })).addTo(map);
        }
        const libres = m.secciones.length - zonaDe.size;
        info.textContent = m.zonas.length
          ? `${fmtNum(m.secciones.length)} secciones · ${fmtNum(m.zonas.length)} ${m.zonas.length === 1 ? 'zona' : 'zonas'} · ${fmtNum(libres)} sin zona`
          : `${fmtNum(m.secciones.length)} secciones · aún sin zonas`;
        const lista = $('#fZonasList', root);
        if (m.zonas.length) {
          lista.innerHTML = m.zonas
            .map((z) => `<li><span class="ficha__swatch" style="background:${z.color}" aria-hidden="true"></span><span>${esc(z.nombre)}</span><span class="muted">${fmtNum(z.secciones.length)} secc.</span></li>`)
            .join('');
          lista.hidden = false;
        }
      })
      .catch((err) => {
        if (vivo) info.textContent = `No se pudo cargar el mapa: ${err.message}`;
      })
      .finally(() => mapEl.classList.remove('is-busy'));
  } else {
    map.setView([23.6, -102.5], 5);
  }
  return () => {
    vivo = false;
    destroy();
  };
}

// Compartir acceso: confirma, genera contraseña nueva y muestra el mensaje para el cliente
function compartirAccesoCpv(u) {
  const dlg = dialogo('cpvAcceso');
  dlg.setAttribute('aria-labelledby', 'accTitle');
  dlg.onclose = null;
  dlg.innerHTML = `
    <div class="dialog__body">
      <div class="dialog__head"><h3 id="accTitle">Compartir acceso</h3>
        <button class="icon-btn icon-btn--always" type="button" data-a="close" aria-label="Cerrar">${ICONS.close}</button></div>
      <p>Para compartir el acceso de <strong>${esc(u.name)}</strong> se generará una <strong>contraseña nueva</strong>.</p>
      <div class="notice">${ICONS.alert}<div>La contraseña actual dejará de funcionar y se cerrarán sus sesiones abiertas. Por seguridad, las contraseñas se guardan cifradas y no se pueden recuperar.</div></div>
      <p class="form-error" id="accErr" role="alert"></p>
      <div class="dialog__actions">
        <button class="btn btn--secondary" type="button" data-a="close">Cancelar</button>
        <button class="btn" type="button" data-a="go">Generar y compartir</button>
      </div>
    </div>`;
  dlg.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') return dlg.close();
    if (a !== 'go') return;
    const btn = e.target.closest('[data-a]');
    btn.disabled = true;
    btn.textContent = 'Generando…';
    try {
      const r = await api(`/api/coordinadores/${u.id}/acceso`, { method: 'POST' });
      dlg.onclick = null;
      dlg.close();
      showAccessDialog(dlg, {
        user: r.user,
        password: r.password,
        wasEditing: true,
        roleLabel: 'Coordinador de Promoción del Voto',
        subtitle: candidaturaTexto(r.user.territorioResumen),
        backLabel: 'Listo',
        backPath: location.pathname,
      });
    } catch (err) {
      $('#accErr', dlg).textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Generar y compartir';
    }
  };
  abrirEnArea(dlg);
}

function renderCpvCards(root, list, catalogo) {
  const q = $('#fSearch', root).value.trim().toLowerCase();
  const rows = list.filter((u) => !q || [u.name, u.candidato, candidaturaTexto(u.territorioResumen)].some((x) => String(x || '').toLowerCase().includes(q)));
  $('#fCount', root).textContent = `${rows.length} de ${list.length} coordinadores`;
  const canDelete = Boolean(state.me.canDelete);
  const icon = (action, u, glyph, label, extra = '') =>
    `<button class="icon-btn cpv-card__act" type="button" data-action="${action}" data-id="${u.id}" data-role="${u.role}" title="${label}" aria-label="${label}"${extra}>${glyph}</button>`;

  $('#usersTable', root).innerHTML = rows.length
    ? `<ul class="cpv-grid">${rows
        .map((u) => {
          const parts = partidosDe(u, catalogo);
          const tel = u.phone ? `+52${u.phone}` : '';
          return `<li class="cpv-card" data-card="${u.id}">
            <div class="cpv-card__body">
              <p class="cpv-card__label">Candidato</p>
              <h3 class="cpv-card__cand"><button type="button" class="cpv-card__open" data-action="view" data-id="${u.id}">${esc(u.candidato || 'Sin candidato')}</button></h3>
              <p class="cpv-card__cdt">
                <span>${esc(candidaturaTexto(u.territorioResumen))}</span>
                ${parts.length ? `<span class="cpv-card__sep" aria-hidden="true">·</span><span class="cpv-card__parties">${parts.map((p) => `<span class="cpv-party"><span class="cpv-party__dot" style="background:${p.color}" aria-hidden="true"></span>${esc(p.name)}</span>`).join('')}</span>` : ''}
              </p>
            </div>
            <div class="cpv-card__holder">
              <span class="avatar" aria-hidden="true">${avatarInner(u)}</span>
              <div><span class="cpv-card__label">Titular</span><strong>${esc(u.name)}</strong></div>
            </div>
            <div class="cpv-card__actions">
              <div class="cpv-card__group" aria-label="Contacto">
                ${
                  u.phone
                    ? `<a class="icon-btn cpv-card__act" href="tel:${tel}" title="Llamar a ${esc(u.name)}" aria-label="Llamar a ${esc(u.name)}">${CI.phone}</a>
                       <a class="icon-btn cpv-card__act" href="https://wa.me/52${u.phone}" target="_blank" rel="noopener" title="WhatsApp con ${esc(u.name)}" aria-label="WhatsApp con ${esc(u.name)}">${CI.whatsapp}</a>`
                    : `<span class="icon-btn cpv-card__act is-off" title="Sin teléfono" aria-label="Sin teléfono">${CI.phone}</span><span class="icon-btn cpv-card__act is-off" title="Sin teléfono" aria-label="Sin teléfono">${CI.whatsapp}</span>`
                }
                ${icon('acceso', u, CI.copy, 'Compartir acceso (genera contraseña nueva)')}
              </div>
              <div class="cpv-card__group" aria-label="Administración">
                ${icon('edit', u, ICONS.edit, `Editar ${esc(u.name)}`)}
                ${icon('god', u, ICONS.eye, `Entrar a la cuenta de ${esc(u.name)} (modo dios)`)}
                ${canDelete ? icon('delete', u, ICONS.trash, `Eliminar ${esc(u.name)} y su rama`, ' data-danger') : ''}
              </div>
            </div>
          </li>`;
        })
        .join('')}</ul>`
    : `<div class="empty">
        <span aria-hidden="true">${ICONS.users}</span>
        <strong>${list.length ? 'Sin resultados' : 'Aún no hay coordinadores'}</strong>
        <span>${list.length ? 'Prueba con otro nombre, candidato o distrito.' : 'Da de alta el primer Coordinador de Promoción del Voto.'}</span>
      </div>`;
}

// Color del avance hacia la meta: de rojo a verde conforme se acerca
// Texto de las iniciales: oscuro sobre los tonos claros (contraste AA)
const textoSobre = (bg) => (['#f59e0b', '#65a30d', '#ea580c'].includes(bg) ? '#1c1917' : '#ffffff');
function colorAvance(pct) {
  if (pct >= 1) return '#15803d';
  if (pct >= 0.75) return '#65a30d';
  if (pct >= 0.5) return '#f59e0b';
  if (pct >= 0.25) return '#ea580c';
  return '#dc2626';
}
const inicialesDe = (name) => {
  const p = String(name || '').trim().split(/\s+/);
  return `${p[0]?.[0] || '?'}${p[1]?.[0] || ''}`.toUpperCase();
};

const LOTE_PROMOTORES = 30;
let scrollPromotores = null;
function renderPromotoresAvance(root, list, avance) {
  const q = $('#fSearch', root).value.trim().toLowerCase();
  const rows = list.filter((u) => !q || u.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  $('#fCount', root).textContent = `${rows.length} de ${list.length} ${list.length === 1 ? 'promotor' : 'promotores'}`;
  const canGod = Boolean(state.me.godMode);
  const meta = avance?.meta || 0;
  const fila = (u) => {
          const a = avance?.porPromotor?.[u.id] || { capturados: 0, aprobados: 0 };
          const pct = meta ? a.capturados / meta : 0;
          const tel = String(u.phone || '').replace(/\D/g, '').slice(-10);
          return `<li class="promo-fila">
            <div class="promo-item">
              <span class="promo-ini" style="background:${colorAvance(pct)};color:${textoSobre(colorAvance(pct))}" aria-hidden="true">${esc(inicialesDe(u.name))}</span>
              <span class="promo-item__txt">
                <strong>${esc(u.name)}</strong>
                <span class="promo-item__mod">${fmtNum(a.capturados)} de ${fmtNum(meta)} promovidos · ${fmtNum(Math.min(999, Math.round(pct * 100)))}%${a.aprobados ? ` · ${fmtNum(a.aprobados)} ${a.aprobados === 1 ? 'aprobado' : 'aprobados'}` : ''}</span>
              </span>
            </div>
            <span class="promo-contacto">${
              tel
                ? `<a class="icon-btn promo-contacto__btn" href="tel:+52${tel}" title="Llamar" aria-label="Llamar a ${esc(u.name)}">${CI.phone}</a>
                   <a class="icon-btn promo-contacto__btn" href="https://wa.me/52${tel}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp con ${esc(u.name)}">${CI.whatsapp}</a>`
                : `<span class="icon-btn promo-contacto__btn is-off" title="Sin teléfono" aria-label="Sin teléfono">${CI.phone}</span>
                   <span class="icon-btn promo-contacto__btn is-off" title="Sin teléfono" aria-label="Sin teléfono">${CI.whatsapp}</span>`
            }${
              canGod
                ? `<button class="icon-btn promo-contacto__btn" type="button" data-action="god" data-id="${u.id}" data-role="${u.role}" title="Entrar a la cuenta de ${esc(u.name)}" aria-label="Entrar a la cuenta de ${esc(u.name)} (modo dios)">${ICONS.eye}</button>`
                : ''
            }</span>
          </li>`;
  };
  scrollPromotores?.disconnect();
  const box = $('#usersTable', root);
  if (!rows.length) {
    box.innerHTML = `<div class="empty">
        <span aria-hidden="true">${ICONS.users}</span>
        <strong>${list.length ? 'Sin resultados' : 'Aún no tienes Promotores Territoriales'}</strong>
        <span>${list.length ? 'Prueba con otro nombre.' : 'Toca el botón + para dar de alta el primero.'}</span>
      </div>`;
    return;
  }
  // Scroll infinito: se pintan por lotes conforme el usuario baja
  box.innerHTML = '<ul class="promo-list"></ul><div class="scroll-centinela" aria-hidden="true"></div>';
  const ul = $('.promo-list', box);
  const centinela = $('.scroll-centinela', box);
  let pintados = 0;
  const masFilas = () => {
    ul.insertAdjacentHTML('beforeend', rows.slice(pintados, pintados + LOTE_PROMOTORES).map(fila).join(''));
    pintados = Math.min(rows.length, pintados + LOTE_PROMOTORES);
    if (pintados >= rows.length) {
      scrollPromotores?.disconnect();
      centinela.remove();
    }
  };
  masFilas();
  if (pintados < rows.length) {
    scrollPromotores = new IntersectionObserver((e) => e[0].isIntersecting && masFilas(), { rootMargin: '400px' });
    scrollPromotores.observe(centinela);
  }
}

function renderUsersTable(root, list, avance) {
  if (state.me.role.key === 'superadmin') return renderCpvCards(root, list, currentPartidos);
  if (state.me.role.key === 'resp_seccion') return renderPromotoresAvance(root, list, avance);
  const q = $('#fSearch', root).value.trim().toLowerCase();
  const rows = list.filter((u) => !q || u.name.toLowerCase().includes(q));
  $('#fCount', root).textContent = `${rows.length} de ${list.length} cuentas`;
  // Modo dios: el super administrador entra a las cuentas, y desde ellas sigue bajando de nivel
  const canGod = state.me.role.key === 'superadmin' || Boolean(state.me.godMode);
  const canEdit = state.me.role.key === 'superadmin';
  const canDelete = Boolean(state.me.canDelete);

  $('#usersTable', root).innerHTML = rows.length
    ? `<table class="table table--personas">
        <thead><tr><th scope="col">Nombre</th><th scope="col">Usuario</th><th scope="col">Teléfono</th><th scope="col">Alta</th>${canGod || canDelete ? '<th scope="col"><span class="sr-only">Acciones</span></th>' : ''}</tr></thead>
        <tbody>
          ${rows
            .map(
              (u) => `<tr>
                <td><div class="cell-user"><span class="avatar" aria-hidden="true">${avatarInner(u)}</span><span>${esc(u.name)}${u.email ? `<small>${esc(u.email)}</small>` : ''}</span></div></td>
                <td class="mono">${u.username ? esc(u.username) : '<span class="muted">Sin acceso</span>'}</td>
                <td class="num" data-label="Teléfono">${esc(fmtPhone(u.phone))}</td>
                <td class="num" data-label="Alta">${fmtDate(u.createdAt)}</td>
                ${canGod || canDelete ? `<td class="cell-action">${canEdit && u.role === 'coord_promocion' ? `<button class="icon-btn icon-btn--table" type="button" data-action="edit" data-id="${u.id}" title="Editar ${esc(u.name)}" aria-label="Editar ${esc(u.name)}">${ICONS.edit}</button>` : ''}${canGod ? `<button class="icon-btn icon-btn--table" type="button" data-action="god" data-id="${u.id}" data-role="${u.role}" title="Entrar a la cuenta de ${esc(u.name)}" aria-label="Entrar a la cuenta de ${esc(u.name)} (modo dios)">${ICONS.eye}</button>` : ''}${canDelete ? `<button class="icon-btn icon-btn--table icon-btn--danger" type="button" data-action="delete" data-id="${u.id}" title="Eliminar ${esc(u.name)}" aria-label="Eliminar ${esc(u.name)} y su rama">${ICONS.trash}</button>` : ''}</td>` : ''}
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`
    : `<div class="empty">
        <span aria-hidden="true">${ICONS.users}</span>
        <strong>${list.length ? 'Sin resultados' : 'Aún no hay cuentas en tu estructura'}</strong>
        <span>${list.length ? 'Prueba con otro nombre.' : `Da de alta tu primer ${esc(state.me.childRole.name)}.`}</span>
      </div>`;
}

function mountEstructura(root, route) {
  const dialog = $('#newUserDialog', root);
  const form = $('#newUserForm', root);
  const formErr = $('#nuFormErr', root);
  const refresh = () => renderUsersTable(root, route.data, route.avance);
  refresh();

  $('#fSearch', root).addEventListener('input', refresh);

  const fields = { name: 'nuName', username: 'nuUser', password: 'nuPass', phone: 'nuPhone', email: 'nuEmail' };
  const setErrors = fieldErrorSetter(root, fields);

  // Usuario sugerido a partir del nombre (editable) y verificación de disponibilidad
  const userInput = $('#nuUser', root);
  const userOk = $('#nuUser-ok', root);
  const passInput = $('#nuPass', root);
  let userTouched = false;
  const checkUser = debounce(async () => {
    const u = userInput.value.trim().toLowerCase();
    userOk.textContent = '';
    if (!u) return;
    const r = await api(`/api/usernames/check?username=${encodeURIComponent(u)}`).catch(() => null);
    if (!r || userInput.value.trim().toLowerCase() !== u) return;
    $('#nuUser-err', root).textContent = r.error || '';
    userOk.textContent = r.available ? 'Disponible' : '';
  }, 350);
  $('#nuName', root).addEventListener(
    'input',
    debounce(async () => {
      if (userTouched) return;
      const name = $('#nuName', root).value.trim();
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
  const setShowPass = (on) => {
    const btn = $('[data-action="show-pass"]', root);
    passInput.type = on ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Ocultar contraseña' : 'Mostrar contraseña');
    btn.innerHTML = on ? CI.eyeOff : CI.eye;
  };

  // render() limpia view.onclick en cada navegación
  root.onclick = (e) => {
    // Clic en cualquier parte de una tarjeta (fuera de sus botones) abre la ficha
    const card = e.target.closest('[data-card]');
    if (card && !e.target.closest('button, a')) {
      card.querySelector('[data-action="view"]').click();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'new' && state.me.childRole.key === 'coord_promocion') {
      history.pushState(null, '', '/usuarios/nuevo');
      render();
      return;
    }
    if (action === 'acceso') {
      compartirAccesoCpv(route.data.find((x) => x.id === e.target.closest('[data-action]').dataset.id));
      return;
    }
    if (action === 'view') {
      navigate(`/usuarios/${e.target.closest('[data-action]').dataset.id}`);
      return;
    }
    if (action === 'delete') {
      const id = e.target.closest('[data-action]').dataset.id;
      const target = route.data.find((u) => u.id === id);
      if (target) {
        openDeleteFlow(target, state.me, () => {
          route.data = route.data.filter((u) => u.id !== id);
          refresh();
        });
      }
      return;
    }
    if (action === 'edit') {
      history.pushState(null, '', `/usuarios/${e.target.closest('[data-action]').dataset.id}/editar`);
      render();
      return;
    }
    if (action === 'gen-pass') {
      passInput.value = generatePassword();
      setShowPass(true);
      $('#nuPass-err', root).textContent = '';
      return;
    }
    if (action === 'show-pass') {
      setShowPass(passInput.type === 'password');
      return;
    }
    if (action === 'new') {
      form.reset();
      setErrors();
      formErr.textContent = '';
      userTouched = false;
      userOk.textContent = '';
      passInput.value = generatePassword();
      setShowPass(true);
      abrirEnArea(dialog);
      $('#nuName', root).focus();
    }
    if (action === 'close') dialog.close();
    if (action === 'god') {
      const btn = e.target.closest('[data-action]');
      btn.disabled = true;
      enterGodMode(btn.dataset.id).catch((err) => {
        btn.disabled = false;
        toast(err.message);
      });
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    const created = await submitWith(form, 'Crear cuenta', 'Creando…', setErrors, formErr, () =>
      api('/api/users', { method: 'POST', body })
    );
    if (created) {
      route.data.unshift(created);
      creado = true;
      dialog.close();
      refresh();
      // Acceso listo para enviar por WhatsApp (la contraseña se muestra solo esta vez)
      showAccessDialog(dialogo('nuAcceso'), {
        user: created,
        password: body.password,
        wasEditing: false,
        roleLabel: state.me.childRole.name,
        backLabel: 'Listo',
        backPath: desdeBoton ? '/estructura' : location.pathname,
      });
    }
  });

  // Botón + de la barra inferior (Responsable de Sección): abre el alta directamente;
  // al cancelar regresa a la lista
  const desdeBoton = route.path === '/estructura/nuevo';
  let creado = false;
  if (desdeBoton) {
    $('[data-action="new"]', root).click();
    // render() enfoca el área de trabajo al terminar; el foco va al primer campo después
    setTimeout(() => $('#nuName', root)?.focus(), 0);
    dialog.addEventListener('close', () => {
      if (!creado) navigate('/estructura');
    }, { once: true });
  }
}

// ---------- Bases de datos cartográficas (Super administrador) ----------
const MAX_ZIP_MB = 500;

// Tarjeta de carga de archivo con arrastrar y soltar + barra de progreso
const uploaderHtml = (id, { title, icon: ic, accept, text, help, note }) => `
  <section class="card upload" aria-labelledby="${id}Title">
    <h3 class="card__title" id="${id}Title">${title}</h3>
    <label class="dropzone" id="${id}Zone">
      <input type="file" accept="${accept}" class="sr-only" id="${id}Input">
      <span class="dropzone__icon" aria-hidden="true">${ic}</span>
      <span class="dropzone__text">${text}</span>
      <span class="field__help">${help}</span>
    </label>
    <div class="upload__status" id="${id}Status" hidden>
      <div class="upload__row">
        <span class="upload__file" id="${id}File"></span>
        <span class="upload__phase" id="${id}Phase" aria-live="polite"></span>
      </div>
      <div class="progress" role="progressbar" aria-labelledby="${id}Phase" aria-valuemin="0" aria-valuemax="100" id="${id}Bar"><span></span></div>
    </div>
    <p class="form-error" id="${id}Err" role="alert"></p>
    <p class="field__help upload__note">${note}</p>
  </section>`;

function mountUploader(root, id, { url, contentType, ext, extLabel, processing, onDone }) {
  const input = $(`#${id}Input`, root);
  const zone = $(`#${id}Zone`, root);
  const status = $(`#${id}Status`, root);
  const bar = $(`#${id}Bar`, root);
  const phase = $(`#${id}Phase`, root);
  const err = $(`#${id}Err`, root);
  let busy = false;

  const setProgress = (pct, text) => {
    bar.firstElementChild.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    phase.textContent = text;
  };

  async function handle(file) {
    if (!file || busy) return;
    err.textContent = '';
    if (!ext.test(file.name)) return (err.textContent = `Selecciona un archivo ${extLabel}.`);
    if (file.size > MAX_ZIP_MB * 1024 * 1024) return (err.textContent = `El archivo supera ${MAX_ZIP_MB} MB.`);

    busy = true;
    zone.classList.add('is-disabled');
    status.hidden = false;
    bar.classList.remove('is-indeterminate');
    $(`#${id}File`, root).textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    setProgress(0, 'Subiendo… 0%');
    try {
      const res = await uploadFile(url, file, contentType, (p) => {
        if (p < 1) setProgress(p * 100, `Subiendo… ${Math.round(p * 100)}%`);
        else {
          setProgress(100, processing);
          bar.classList.add('is-indeterminate');
        }
      });
      status.hidden = true;
      await onDone(res);
    } catch (e) {
      status.hidden = true;
      err.textContent = e.message;
    } finally {
      busy = false;
      zone.classList.remove('is-disabled');
      input.value = '';
    }
  }

  input.addEventListener('change', () => handle(input.files[0]));
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    handle(e.dataTransfer.files[0]);
  });
}

const fmtCorte = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

async function viewBasesDatos(route) {
  const [states, pad] = await Promise.all([api('/api/geo/states'), api('/api/padron')]);
  route.data = { states, pad };
  return `
    <div class="page-head">
      <p>Cartografía electoral y padrón del INE. Se cruzan por la clave de sección.</p>
    </div>

    <div class="uploads">
      ${uploaderHtml('geo', {
        title: 'Cartografía electoral',
        icon: ICONS.fileZip,
        accept: '.zip,application/zip',
        text: '<strong>Arrastra aquí el .zip</strong> o haz clic para seleccionarlo',
        help: `Shapefile con las capas ENTIDAD, DISTRITO_FEDERAL, DISTRITO_LOCAL, MUNICIPIO y SECCION. Máximo ${MAX_ZIP_MB} MB.`,
        note: 'Si la entidad ya estaba cargada, sus mapas y catálogo se reemplazan.',
      })}
      ${uploaderHtml('pad', {
        title: 'Padrón electoral / lista nominal',
        icon: ICONS.users,
        accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        text: '<strong>Arrastra aquí el Excel (.xlsx)</strong> o haz clic para seleccionarlo',
        help: 'Archivo de datos abiertos del INE por sección. Se omiten los residentes en el extranjero.',
        note: 'Las entidades incluidas en el archivo reemplazan su padrón anterior.',
      })}
    </div>

    <section aria-labelledby="stTitle">
      <h3 class="section-title" id="stTitle">Cartografía por entidad</h3>
      <div class="table-wrap" id="statesTable"></div>
    </section>

    <section aria-labelledby="padTitle">
      <h3 class="section-title" id="padTitle">Padrón por entidad <span class="section-title__meta" id="padMeta"></span></h3>
      <div class="table-wrap" id="padTable"></div>
    </section>`;
}

function renderStatesTable(root, list) {
  $('#statesTable', root).innerHTML = list.length
    ? `<table class="table table--wrap-head">
        <thead><tr>
          <th scope="col">Clave</th><th scope="col">Entidad</th>
          <th scope="col" class="num">Dist. federales</th><th scope="col" class="num">Dist. locales</th>
          <th scope="col" class="num">Municipios</th><th scope="col" class="num">Secciones</th>
          <th scope="col" class="num">Lista nominal</th>
          <th scope="col">Cargado</th><th scope="col"><span class="sr-only">Acciones</span></th>
        </tr></thead>
        <tbody>
          ${list
            .map(
              (s) => `<tr>
                <td class="num">${String(s.clave).padStart(2, '0')}</td>
                <td><strong>${esc(s.nombre)}</strong>${s.warnings.length ? ` <span class="badge badge--warn" title="${esc(s.warnings.join(' '))}">${s.warnings.length} aviso${s.warnings.length > 1 ? 's' : ''}</span>` : ''}</td>
                <td class="num num--r">${fmtNum(s.counts.distritosFederales)}</td>
                <td class="num num--r">${fmtNum(s.counts.distritosLocales)}</td>
                <td class="num num--r">${fmtNum(s.counts.municipios)}</td>
                <td class="num num--r">${fmtNum(s.counts.secciones)}</td>
                <td class="num num--r">${s.padron ? fmtNum(s.padron.ln) : '<span class="muted">Sin padrón</span>'}</td>
                <td>${fmtDateTime(s.importedAt)}<small class="muted-block">${esc(s.importedBy)}</small></td>
                <td><a class="btn btn--secondary btn--sm" href="/bases-de-datos/${s.clave}" data-link>Ver mapa</a></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`
    : `<div class="empty">
        <span aria-hidden="true">${ICONS.database}</span>
        <strong>Aún no hay entidades cargadas</strong>
        <span>Carga el .zip de la cartografía de un estado para comenzar.</span>
      </div>`;
}

function cruceBadge(s) {
  if (!s.cartografia) return '<span class="muted">Sin cartografía</span>';
  const c = s.cruce;
  if (!c.onlyPadron.length && !c.onlyMap.length) return `<span class="badge badge--ok">${fmtNum(c.matched)} coinciden</span>`;
  const parts = [];
  if (c.onlyPadron.length) parts.push(`${c.onlyPadron.length} sin mapa`);
  if (c.onlyMap.length) parts.push(`${c.onlyMap.length} sin padrón`);
  const detail = [
    c.onlyPadron.length ? `Secciones del padrón que no están en el mapa: ${c.onlyPadron.slice(0, 30).join(', ')}${c.onlyPadron.length > 30 ? '…' : ''}.` : '',
    c.onlyMap.length ? `Secciones del mapa sin padrón: ${c.onlyMap.slice(0, 30).join(', ')}${c.onlyMap.length > 30 ? '…' : ''}.` : '',
  ].join(' ');
  return `<span class="badge badge--warn" title="${esc(detail)}">${parts.join(' · ')}</span>`;
}

function renderPadronTable(root, pad) {
  const last = pad.lastImport;
  $('#padMeta', root).textContent = last ? `· Corte ${fmtCorte(last.corte)} · ${last.fileName}` : '';
  // Primero las entidades con cartografía (las que se usan para asignar territorio)
  const list = [...pad.states].sort((a, b) => Number(b.cartografia) - Number(a.cartografia) || a.clave - b.clave);
  $('#padTable', root).innerHTML = list.length
    ? `<table class="table table--wrap-head">
        <thead><tr>
          <th scope="col">Clave</th><th scope="col">Entidad</th>
          <th scope="col" class="num">Secciones</th><th scope="col" class="num">Lista nominal</th><th scope="col" class="num">Padrón</th>
          <th scope="col">Cruce con el mapa</th><th scope="col">Corte</th>
        </tr></thead>
        <tbody>
          ${list
            .map(
              (s) => `<tr>
                <td class="num">${String(s.clave).padStart(2, '0')}</td>
                <td><strong>${esc(s.nombre)}</strong></td>
                <td class="num num--r">${fmtNum(s.secciones)}</td>
                <td class="num num--r">${fmtNum(s.ln)}</td>
                <td class="num num--r">${s.padron !== null ? fmtNum(s.padron) : '—'}</td>
                <td>${cruceBadge(s)}</td>
                <td>${fmtCorte(s.corte)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`
    : `<div class="empty">
        <span aria-hidden="true">${ICONS.users}</span>
        <strong>Aún no hay padrón cargado</strong>
        <span>Carga el Excel del INE para ver los electores por sección.</span>
      </div>`;
}

function mountBasesDatos(root, route) {
  renderStatesTable(root, route.data.states);
  renderPadronTable(root, route.data.pad);
  const refresh = async () => {
    const [states, pad] = await Promise.all([api('/api/geo/states'), api('/api/padron')]);
    route.data = { states, pad };
    renderStatesTable(root, states);
    renderPadronTable(root, pad);
  };
  mountUploader(root, 'geo', {
    url: '/api/geo/imports',
    contentType: 'application/zip',
    ext: /\.zip$/i,
    extLabel: '.zip',
    processing: 'Procesando cartografía…',
    onDone: async (res) => {
      await refresh();
      toast(`Cartografía cargada: ${res.states.map((s) => s.nombre).join(', ')}`);
    },
  });
  mountUploader(root, 'pad', {
    url: '/api/padron/imports',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: /\.xlsx$/i,
    extLabel: 'Excel (.xlsx)',
    processing: 'Leyendo padrón… puede tardar unos segundos',
    onDone: async (res) => {
      await refresh();
      toast(`Padrón cargado: ${res.states} entidades · ${fmtNum(res.totals.ln)} electores`);
    },
  });
}

// ---------- Detalle de entidad: mapa + catálogo ----------
const MAP_LAYERS = [
  { key: 'seccion', name: 'Secciones', label: (p, c) => `Sección ${fmtSeccion(p.seccion)} · ${c.munName(p.municipio)} · DF ${p.distrito_federal} · DL ${p.distrito_local}` },
  { key: 'municipio', name: 'Municipios', label: (p) => `Municipio ${p.municipio} · ${p.nombre || ''}` },
  { key: 'distrito_local', name: 'Distritos locales', label: (p) => `Distrito local ${p.distrito_local}` },
  { key: 'distrito_federal', name: 'Distritos federales', label: (p) => `Distrito federal ${p.distrito_federal}` },
];

async function viewEntidadGeo(route, [clave]) {
  const { meta, catalog } = await api(`/api/geo/states/${clave}`);
  route.data = { meta, catalog };
  const layers = MAP_LAYERS.filter((l) => meta.layers[l.key]);

  const secPorMun = new Map();
  for (const s of catalog.secciones) {
    const m = secPorMun.get(s.municipio) || { n: 0, df: new Set(), dl: new Set() };
    m.n += 1;
    m.df.add(s.distritoFederal);
    m.dl.add(s.distritoLocal);
    secPorMun.set(s.municipio, m);
  }
  const list = (set) => [...set].filter((v) => v !== null).sort((a, b) => a - b).join(', ');

  return `
    <a class="back-link" href="/bases-de-datos" data-link>${ICONS.back}<span>Bases de datos</span></a>
    <div class="page-head page-head--actions">
      <div>
        <h2>${esc(meta.nombre)} <span class="badge">Entidad ${String(meta.clave).padStart(2, '0')}</span></h2>
        <p>Cargado el ${fmtDateTime(meta.importedAt)} por ${esc(meta.importedBy)} · ${esc(meta.fileName)} · Proyección de origen: ${esc(meta.crs)}</p>
      </div>
      <button class="btn btn--secondary btn--danger" type="button" data-action="delete">${ICONS.trash}<span>Eliminar entidad</span></button>
    </div>

    ${
      meta.warnings.length
        ? `<div class="notice" role="status">${ICONS.alert}<div><strong>Avisos de la importación</strong><ul>${meta.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div></div>`
        : ''
    }

    <div class="kpis">
      ${[
        ['Distritos federales', meta.counts.distritosFederales],
        ['Distritos locales', meta.counts.distritosLocales],
        ['Municipios', meta.counts.municipios],
        ['Secciones', meta.counts.secciones],
      ]
        .map(([l, v]) => `<div class="kpi"><span class="kpi__value">${fmtNum(v)}</span><span class="kpi__label">${l}</span></div>`)
        .join('')}
    </div>

    <section class="card map-card" aria-labelledby="mapTitle">
      <div class="map-card__head">
        <h3 class="card__title" id="mapTitle">Mapa</h3>
        <div class="segmented" role="radiogroup" aria-label="Capa del mapa">
          ${layers
            .map(
              (l, i) =>
                `<button type="button" role="radio" aria-checked="${i === 0}" data-layer="${l.key}">${l.name}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="map" id="map" aria-label="Mapa de ${esc(meta.nombre)} sobre OpenStreetMap"></div>
      <p class="map-card__info" id="mapInfo" aria-live="polite">Cargando mapa…</p>
    </section>

    <section aria-labelledby="catTitle">
      <h3 class="section-title" id="catTitle">Catálogo por municipio</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th scope="col">Clave</th><th scope="col">Municipio</th><th scope="col" class="num">Secciones</th><th scope="col">Distritos federales</th><th scope="col">Distritos locales</th></tr></thead>
          <tbody>
            ${catalog.municipios
              .map((m) => {
                const d = secPorMun.get(m.clave) || { n: 0, df: new Set(), dl: new Set() };
                return `<tr><td class="num">${m.clave}</td><td>${esc(m.nombre || '—')}</td><td class="num num--r">${fmtNum(d.n)}</td><td>${list(d.df) || '—'}</td><td>${list(d.dl) || '—'}</td></tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <dialog class="dialog" id="delDialog" aria-labelledby="delTitle">
      <div class="dialog__body">
        <div class="dialog__head"><h3 id="delTitle">¿Eliminar ${esc(meta.nombre)}?</h3></div>
        <p>Se borrarán los mapas y el catálogo territorial de esta entidad. Podrás volver a cargarla después.</p>
        <p class="form-error" id="delErr" role="alert"></p>
        <div class="dialog__actions">
          <button class="btn btn--secondary" type="button" data-action="cancel">Cancelar</button>
          <button class="btn btn--destructive" type="button" data-action="confirm-delete">Eliminar</button>
        </div>
      </div>
    </dialog>`;
}

function mountEntidadGeo(root, route) {
  const { meta, catalog } = route.data;
  const mapEl = $('#map', root);
  const info = $('#mapInfo', root);
  const cache = new Map();
  const munNames = new Map(catalog.municipios.map((m) => [m.clave, m.nombre]));
  const ctx = { munName: (c) => munNames.get(c) || `Municipio ${c}` };

  // bbox = [oeste, sur, este, norte]; Leaflet usa [lat, lon]
  const bounds = L.latLngBounds([meta.bbox[1], meta.bbox[0]], [meta.bbox[3], meta.bbox[2]]);
  mapEl.innerHTML = '';
  const map = L.map(mapEl, {
    preferCanvas: true, // miles de polígonos: canvas es mucho más fluido que SVG
    zoomControl: false,
    scrollWheelZoom: false,
    zoomSnap: 0.5,
    minZoom: 5,
    maxZoom: 18,
    maxBounds: bounds.pad(1.5),
  });
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
  const fitAll = () => map.fitBounds(bounds, { padding: [16, 16] });
  homeControl(fitAll).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  fitAll();

  // La rueda del mouse solo hace zoom después de hacer clic en el mapa, para no atrapar el scroll de la página
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());

  let current = null;
  let outline = null;

  async function getLayer(key) {
    if (!cache.has(key)) cache.set(key, await api(`/api/geo/states/${meta.clave}/layers/${key}`));
    return cache.get(key);
  }

  async function show(key) {
    const def = MAP_LAYERS.find((l) => l.key === key);
    root.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.layer === key)));
    mapEl.classList.add('is-busy');
    try {
      const fc = await getLayer(key);
      if (!outline && meta.layers.entidad) {
        outline = L.geoJSON(await getLayer('entidad'), { style: GEO_STYLE.outline }).addTo(map);
      }
      if (current) map.removeLayer(current);
      const summary = `${fmtNum(fc.features.length)} ${def.name.toLowerCase()}. Haz clic en una para acercarte.`;
      current = L.geoJSON(fc, {
        style: GEO_STYLE.base,
        onEachFeature(feature, layer) {
          const label = def.label(feature.properties, ctx);
          layer.bindTooltip(esc(label), { sticky: true, direction: 'top', className: 'map-tip' });
          layer.on({
            mouseover: () => {
              layer.setStyle(GEO_STYLE.hover);
              info.textContent = label;
            },
            mouseout: () => {
              current.resetStyle(layer);
              info.textContent = summary;
            },
            click: () => map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 16 }),
          });
        },
      }).addTo(map);
      if (outline) outline.bringToFront();
      info.textContent = summary;
    } catch (e) {
      info.textContent = `No se pudo cargar la capa: ${e.message}`;
    } finally {
      mapEl.classList.remove('is-busy');
    }
  }

  const delDialog = $('#delDialog', root);
  root.onclick = async (e) => {
    const btn = e.target.closest('[data-layer], [data-action]');
    if (!btn) return;
    if (btn.dataset.layer) return show(btn.dataset.layer);
    const action = btn.dataset.action;
    if (action === 'delete') abrirEnArea(delDialog);
    if (action === 'cancel') delDialog.close();
    if (action === 'confirm-delete') {
      btn.disabled = true;
      try {
        await api(`/api/geo/states/${meta.clave}`, { method: 'DELETE' });
        delDialog.close();
        toast(`${meta.nombre} eliminada`);
        history.pushState(null, '', '/bases-de-datos');
        render();
      } catch (err) {
        $('#delErr', root).textContent = err.message;
        btn.disabled = false;
      }
    }
  };

  // Teclado en el selector de capas (patrón radiogroup)
  $('.segmented', root).addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const btns = [...root.querySelectorAll('[data-layer]')];
    const i = btns.indexOf(document.activeElement);
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
    next.focus();
    show(next.dataset.layer);
  });

  show(MAP_LAYERS.find((l) => meta.layers[l.key]).key);

  // Al salir de la vista se libera el mapa (listeners de ventana, tiles)
  return () => map.remove();
}

// ---------- Mi perfil (todos los niveles) ----------
function viewPerfil() {
  const u = state.me.user;
  const hasPw = u.hasPassword;
  return `
    <div class="page-head">
      <p>Administra tu información personal y tu contraseña.</p>
    </div>

    <div class="profile">
      <section class="card profile__photo" aria-labelledby="phTitle">
        <h3 class="card__title" id="phTitle">Foto de perfil</h3>
        <div class="profile__avatar" id="pfAvatar">${avatarInner(u)}</div>
        <p class="field__help profile__hint">Usa una selfie reciente, de frente y con buena luz.</p>
        <div class="profile__photo-actions">
          <label class="btn">
            ${ICONS.camera}<span>Tomar selfie</span>
            <input type="file" accept="image/*" capture="user" class="sr-only" id="pfSelfie">
          </label>
          <label class="btn btn--secondary">
            ${ICONS.upload}<span>Subir foto</span>
            <input type="file" accept="image/*" class="sr-only" id="pfUpload">
          </label>
          <button class="btn btn--secondary btn--danger" type="button" id="pfRemove" ${u.avatarUrl ? '' : 'hidden'}>${ICONS.trash}<span>Quitar foto</span></button>
        </div>
        <p class="form-error" id="pfPhotoErr" role="alert"></p>
      </section>

      <section class="card" aria-labelledby="pdTitle">
        <h3 class="card__title" id="pdTitle">Datos personales</h3>
        <form id="pfForm" novalidate>
          <div class="field">
            <label for="pfName">Nombre <span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="pfName" name="name" required maxlength="120" autocomplete="name" value="${esc(u.name)}">
            <p class="field__error" id="pfName-err"></p>
          </div>
          <div class="field">
            <label for="pfAbout">Acerca de mí</label>
            <textarea class="input textarea" id="pfAbout" name="about" rows="4" maxlength="500" aria-describedby="pfAbout-help">${esc(u.about)}</textarea>
            <p class="field__help" id="pfAbout-help"><span id="pfAboutCount">${u.about.length}</span>/500 caracteres.</p>
            <p class="field__error" id="pfAbout-err"></p>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="pfPhone">Teléfono</label>
              <input class="input" id="pfPhone" name="phone" type="tel" inputmode="numeric" maxlength="14" autocomplete="tel" value="${esc(u.phone)}" aria-describedby="pfPhone-help">
              <p class="field__help" id="pfPhone-help">10 dígitos.</p>
              <p class="field__error" id="pfPhone-err"></p>
            </div>
            <div class="field">
              <label for="pfEmail">Correo electrónico</label>
              <input class="input" id="pfEmail" name="email" type="email" autocomplete="email" value="${esc(u.email)}">
              <p class="field__error" id="pfEmail-err"></p>
            </div>
          </div>
          <p class="form-error" id="pfFormErr" role="alert"></p>
          <div class="form-actions"><button class="btn" type="submit">Guardar cambios</button></div>
        </form>
      </section>

      ${
        state.me.godMode
          ? `<section class="card" aria-labelledby="pwTitle">
              <h3 class="card__title" id="pwTitle">Contraseña</h3>
              <p class="field__help">En modo dios no es posible cambiar la contraseña de otro usuario.</p>
            </section>`
          : `      <section class="card" aria-labelledby="pwTitle">
        <h3 class="card__title" id="pwTitle">${hasPw ? 'Cambiar contraseña' : 'Crear contraseña'}</h3>
        <form id="pwForm" novalidate>
          <input type="text" name="username" autocomplete="username" value="${esc(u.email || u.name)}" hidden>
          ${
            hasPw
              ? `<div class="field">
                  <label for="pwCurrent">Contraseña actual</label>
                  <input class="input" id="pwCurrent" name="current" type="password" autocomplete="current-password">
                  <p class="field__error" id="pwCurrent-err"></p>
                </div>`
              : ''
          }
          <div class="field-row">
            <div class="field">
              <label for="pwNext">Nueva contraseña</label>
              <input class="input" id="pwNext" name="next" type="password" autocomplete="new-password" aria-describedby="pwNext-help">
              <p class="field__help" id="pwNext-help">Mínimo 8 caracteres, con letras y números.</p>
              <p class="field__error" id="pwNext-err"></p>
            </div>
            <div class="field">
              <label for="pwConfirm">Confirmar nueva contraseña</label>
              <input class="input" id="pwConfirm" name="confirm" type="password" autocomplete="new-password">
              <p class="field__error" id="pwConfirm-err"></p>
            </div>
          </div>
          <p class="form-error" id="pwFormErr" role="alert"></p>
          <div class="form-actions"><button class="btn" type="submit">${hasPw ? 'Cambiar contraseña' : 'Crear contraseña'}</button></div>
        </form>
      </section>`
      }
      <section class="card pref" aria-labelledby="prefT">
        <h3 class="card__title" id="prefT">Preferencias</h3>
        <div class="field">
          <label for="prefTema">Apariencia</label>
          <select class="input" id="prefTema">
            <option value="claro">Clara</option>
            <option value="oscuro">Oscura</option>
            <option value="sistema">Igual que mi teléfono o computadora</option>
          </select>
        </div>
        <div class="field" id="prefPushBox">
          <label>Notificaciones en este dispositivo</label>
          <p class="field__help" id="prefPushTxt">Recibe avisos aunque la app esté cerrada.</p>
          <button class="btn btn--secondary" type="button" id="prefPush" hidden>Activar notificaciones</button>
        </div>
        <div class="pref__salir"><button class="btn btn--destructive" type="button" id="prefSalir">${ICONS.logout}<span>Cerrar sesión</span></button></div>
      </section>
    </div>`;
}

// Recorta al centro en cuadrado, reduce a 512 px y comprime a JPEG
async function prepareAvatar(file) {
  if (!file.type.startsWith('image/')) throw new Error('El archivo debe ser una imagen.');
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(512, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas
    .getContext('2d')
    .drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function mountPerfil(root) {
  // Preferencias: apariencia y cierre de sesión
  const tema = $('#prefTema', root);
  if (tema) {
    tema.value = leerTema();
    tema.addEventListener('change', () => aplicarTema(tema.value, true));
  }
  $('#prefSalir', root)?.addEventListener('click', () => logoutBtn.click());
  montarPush(root);
  const setMe = (user) => {
    state.me.user = { ...state.me.user, ...user };
    renderUser(state.me);
  };

  // --- Foto ---
  const photoErr = $('#pfPhotoErr', root);
  const avatarBox = $('#pfAvatar', root);
  const removeBtn = $('#pfRemove', root);
  const showAvatar = () => {
    avatarBox.innerHTML = avatarInner(state.me.user);
    removeBtn.hidden = !state.me.user.avatarUrl;
  };

  const onPhoto = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    photoErr.textContent = '';
    avatarBox.classList.add('is-busy');
    try {
      const image = await prepareAvatar(file);
      setMe(await api('/api/me/avatar', { method: 'PUT', body: { image } }));
      showAvatar();
      toast('Foto actualizada');
    } catch (err) {
      photoErr.textContent = navigator.onLine ? err.message : 'Sin conexión. Intenta de nuevo cuando estés en línea.';
    } finally {
      avatarBox.classList.remove('is-busy');
    }
  };
  $('#pfSelfie', root).addEventListener('change', onPhoto);
  $('#pfUpload', root).addEventListener('change', onPhoto);

  removeBtn.addEventListener('click', async () => {
    photoErr.textContent = '';
    try {
      setMe(await api('/api/me/avatar', { method: 'DELETE' }));
      showAvatar();
      toast('Foto eliminada');
    } catch (err) {
      photoErr.textContent = err.message;
    }
  });

  // --- Datos personales ---
  const pfForm = $('#pfForm', root);
  const about = $('#pfAbout', root);
  about.addEventListener('input', () => ($('#pfAboutCount', root).textContent = about.value.length));
  const pfErrors = fieldErrorSetter(root, { name: 'pfName', about: 'pfAbout', phone: 'pfPhone', email: 'pfEmail' });
  pfForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(pfForm));
    const user = await submitWith(pfForm, 'Guardar cambios', 'Guardando…', pfErrors, $('#pfFormErr', root), () =>
      api('/api/me', { method: 'PATCH', body })
    );
    if (user) {
      setMe(user);
      showAvatar();
      toast('Perfil actualizado');
    }
  });

  // --- Contraseña (no disponible en modo dios) ---
  const pwForm = $('#pwForm', root);
  if (!pwForm) return;
  const pwFields = { next: 'pwNext', confirm: 'pwConfirm' };
  if (state.me.user.hasPassword) pwFields.current = 'pwCurrent';
  const pwErrors = fieldErrorSetter(root, pwFields);
  const pwLabel = state.me.user.hasPassword ? 'Cambiar contraseña' : 'Crear contraseña';
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(pwForm));
    const ok = await submitWith(pwForm, pwLabel, 'Guardando…', pwErrors, $('#pwFormErr', root), () =>
      api('/api/me/password', { method: 'PUT', body })
    );
    if (ok) {
      const firstTime = !state.me.user.hasPassword;
      state.me.user.hasPassword = true;
      toast(firstTime ? 'Contraseña creada' : 'Contraseña actualizada');
      if (firstTime) render();
      else pwForm.reset();
    }
  });
}

// ---------------------------------------------------------------------------
// Sidebar + router (History API)
// ---------------------------------------------------------------------------
const nav = $('#nav');
const view = $('#view');
const sidebar = $('#sidebar');
const backdrop = $('#backdrop');
const menuBtn = $('#menuBtn');
let renderSeq = 0;

function renderNav(menu) {
  nav.innerHTML = menu
    .map(
      (g) => `
    <div class="nav__group">
      <div class="nav__label">${g.label}</div>
      ${g.items.map((r) => `<a class="nav__link" href="${r.path}" data-link title="${r.title}">${ICONS[r.icon]}<span>${r.title}</span></a>`).join('')}
    </div>`
    )
    .join('');
}

// Celulares: barra fija inferior solo con los íconos de las funciones
// Etiquetas cortas de la barra inferior (celular)
const CORTO = {
  '/': 'Panel',
  '/estructura': 'Promotores',
  '/promovidos': 'Promovidos',
  '/material': 'Material',
  '/agenda': 'Agenda',
  '/directorio': 'Directorio',
  '/estructuras-externas': 'Externas',
  '/zonas': 'Zonas',
  '/responsables': 'Responsables',
  '/usuarios': 'Usuarios',
  '/bases-de-datos': 'Bases',
  '/configuracion': 'Ajustes',
  '/bitacora': 'Bitácora',
};
const corto = (r) => CORTO[r.path] || r.title.split(' ')[0];

function renderDock(menuCompleto) {
  const menu = menuCompleto.map((g) => ({ ...g, items: g.items.filter((r) => r.dock !== false) })).filter((g) => g.items.length);
  const items = menu.flatMap((g) => g.items);
  const fab = items.find((r) => r.fab);
  if (fab) {
    // Botón de acción principal al centro, con las demás funciones a los lados
    const resto = items.filter((r) => r !== fab);
    const mitad = Math.ceil(resto.length / 2);
    const link = (r) => `<a class="dock__link" href="${r.path}" data-link title="${esc(r.title)}" aria-label="${esc(r.title)}">${ICONS[r.icon]}<span class="dock__label" aria-hidden="true">${esc(corto(r))}</span></a>`;
    $('#dock').classList.add('has-fab');
    $('#dock').innerHTML = [
      ...resto.slice(0, mitad).map(link),
      `<a class="dock__fab" href="${fab.path}" data-link title="${esc(fab.title)}" aria-label="${esc(fab.title)}">${ICONS[fab.icon]}</a>`,
      ...resto.slice(mitad).map(link),
    ].join('');
    return;
  }
  $('#dock').classList.remove('has-fab');
  // Con más de 5 accesos la barra se compacta para caber en el ancho del celular
  $('#dock').classList.toggle('dock--compacto', items.length > 5);
  $('#dock').innerHTML = menu
    .map(
      (g) => `<div class="dock__group" role="group" aria-label="${esc(g.label)}">${g.items
        .map((r) => `<a class="dock__link" href="${r.path}" data-link title="${esc(r.title)}" aria-label="${esc(r.title)}">${ICONS[r.icon]}<span class="dock__label" aria-hidden="true">${esc(corto(r))}</span></a>`)
        .join('')}</div>`
    )
    .join('<span class="dock__sep" aria-hidden="true"></span>');
}

// Barra inferior tipo «isla dinámica»: mientras hay actividad en el área de trabajo
// (desplazamiento) se encoge a una cápsula con la sección actual; al detenerse se expande.
const ISLA_ESPERA = 700;
let islaLista = false;
function montarIsla() {
  const dock = $('#dock');
  if (!dock) return;
  if (!$('.dock__isla', dock)) {
    dock.insertAdjacentHTML('beforeend', '<button class="dock__isla" type="button" aria-label="Mostrar el menú" tabindex="-1"><span class="dock__isla-in"></span></button>');
  }
  if (islaLista) return;
  islaLista = true;
  const movil = matchMedia('(max-width: 767px)');
  let timer = 0;
  let ultimoY = scrollY;
  const expandir = () => {
    clearTimeout(timer);
    dock.classList.remove('is-isla');
    $('.dock__isla', dock)?.setAttribute('tabindex', '-1');
  };
  const encoger = () => {
    const isla = $('.dock__isla', dock);
    if (!isla || dock.contains(document.activeElement)) return;
    if (!dock.classList.contains('is-isla')) {
      const actual = $('[aria-current="page"]', dock);
      $('.dock__isla-in', isla).innerHTML = actual
        ? `${actual.querySelector('svg')?.outerHTML || ''}<span>${esc(actual.getAttribute('aria-label') || '')}</span>`
        : `<span>${esc($('#pageTitle')?.textContent || 'Menú')}</span>`;
      isla.setAttribute('tabindex', '0');
      dock.classList.add('is-isla');
    }
    clearTimeout(timer);
    timer = setTimeout(expandir, ISLA_ESPERA);
  };
  addEventListener('scroll', () => {
    if (!movil.matches) return;
    const y = scrollY;
    const delta = Math.abs(y - ultimoY);
    ultimoY = y;
    // Rebotes del navegador y desplazamientos mínimos no cuentan como actividad
    if (delta < 4 || y < 8) return;
    encoger();
  }, { passive: true });
  dock.addEventListener('click', (ev) => {
    if (ev.target.closest('.dock__isla')) expandir();
  });
  movil.addEventListener('change', expandir);
}

const NOT_AVAILABLE = {
  title: 'No disponible',
  view: () => `<div class="empty"><strong>Página no disponible</strong><span>La página no existe o no está disponible para tu nivel.</span></div>`,
};

async function render() {
  const seq = ++renderSeq;
  let route = state.routes.get(location.pathname);
  let params = [];
  if (!route) {
    for (const r of state.patternRoutes || []) {
      const m = r.pattern.exec(location.pathname);
      if (m) {
        route = r;
        params = m.slice(1);
        break;
      }
    }
  }
  route = route || NOT_AVAILABLE;
  $('#pageTitle').textContent = route.title;
  document.title = `${route.title} · VERTEX`;
  if (location.pathname !== '/notificaciones') actualizarContador();
  const links = [...document.querySelectorAll('.nav__link, .user, .dock__link, .dock__fab, #topUser, #topNotif')];
  // Si un enlace coincide exacto (p. ej. /promovidos/nuevo), su sección padre no se marca
  const exacto = new Set(links.filter((a) => a.getAttribute('href') === location.pathname).map((a) => a.getAttribute('href')));
  links.forEach((a) => {
    const href = a.getAttribute('href');
    const active = href === location.pathname || (!exacto.size && href !== '/' && location.pathname.startsWith(`${href}/`));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  let out = route.view(route, params);
  let ok = true;
  if (out instanceof Promise) {
    view.innerHTML = `<div class="skel" role="status" aria-label="Cargando">
        <div class="skel__b skel__hero"></div>
        <div class="skel__fila"><div class="skel__b"></div><div class="skel__b"></div><div class="skel__b"></div></div>
        <div class="skel__b skel__alto"></div><span class="sr-only">Cargando…</span></div>`;
    try {
      out = await out;
    } catch (err) {
      ok = false;
      out = `<div class="empty"><strong>No se pudo cargar la información</strong><span>${esc(navigator.onLine ? err.message : 'Sin conexión.')}</span></div>`;
    }
  }
  if (seq !== renderSeq) return;
  if (state.cleanup) {
    state.cleanup();
    state.cleanup = null;
  }
  view.onclick = null;
  view.innerHTML = out;
  if (ok && route.mount) state.cleanup = route.mount(view, route, params) || null;
  etiquetarTablas(view);
  if (ok && location.pathname === '/') mostrarBienvenida();
  view.focus({ preventScroll: true });
}

// Tablas que en celular se muestran como tarjetas: cada celda lleva el nombre de su columna
function etiquetarTablas(root) {
  for (const t of root.querySelectorAll('table.table--cards')) {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => !td.dataset.label && heads[i] && (td.dataset.label = heads[i]));
  }
}

// Bienvenida (primera vez por cuenta): lo esencial de cada nivel, en el área de trabajo
const BIENVENIDA = {
  promotor: ['Toca el botón + para capturar a una persona.', 'Encuadra la INE dentro del marco: se guarda solo lo que queda dentro.', 'Sin internet también puedes capturar: se guarda en tu teléfono y se envía solo.', 'Si tu Responsable deja observaciones, las verás en «Tienes que corregir».'],
  resp_seccion: ['Da de alta a tus Promotores Territoriales con el botón +.', 'En «Promovidos» revisa que los datos coincidan con la INE y aprueba o rechaza (en computadora: teclas A y R).', 'Cuando recibas material, sube mínimo 5 fotos de evidencia por orden.', 'Llama o escribe por WhatsApp a los promotores con menor avance.'],
  coord_zona: ['Da de alta a un Responsable de Sección por cada sección de tu zona.', 'Revisa «Requiere tu atención»: secciones sin responsable y revisiones atrasadas.', 'Reparte el material que recibas entre tus responsables.'],
  coord_promocion: ['Divide tu territorio en zonas y asigna a sus coordinadores.', 'Ajusta tu factor de conversión en «Configuración».', 'Da de alta tu inventario de material y entrégalo a tus zonas.', 'Compara tu ritmo de captura contra el ritmo necesario para llegar a la meta.'],
  superadmin: ['Da de alta a los Coordinadores de Promoción del Voto.', 'Publica el aviso de privacidad en «Configuración › General» antes de capturar datos reales.', 'Consulta quién hizo qué en la «Bitácora».'],
};
function mostrarBienvenida() {
  const pasos = BIENVENIDA[state.me?.role?.key];
  const clave = `vx:bienvenida:${state.me?.user?.id}`;
  let vista = false;
  try {
    vista = localStorage.getItem(clave) === '1';
  } catch {}
  if (!pasos || vista || $('#bienvenida', view)) return;
  view.insertAdjacentHTML(
    'afterbegin',
    `<section class="card bienvenida" id="bienvenida" aria-labelledby="bienT">
      <div><h3 id="bienT">Bienvenido a VERTEX, ${esc(state.me.user.name.split(' ')[0])}</h3>
      <ol>${pasos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol></div>
      <button class="btn btn--secondary btn--sm" type="button" id="bienOk">Entendido</button>
    </section>`
  );
  $('#bienOk', view).addEventListener('click', () => {
    try {
      localStorage.setItem(clave, '1');
    } catch {}
    $('#bienvenida', view)?.remove();
  });
}

// Escritorio: el sidebar se contrae a solo íconos (preferencia recordada).
// Móvil/tableta: el sidebar es un panel deslizable.
const mobileMq = window.matchMedia('(max-width: 1023px)');
const COLLAPSE_KEY = 'vx.sidebarCollapsed';
const layout = $('.layout');

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function syncMenuBtn() {
  const expanded = mobileMq.matches ? sidebar.classList.contains('is-open') : !layout.classList.contains('is-collapsed');
  menuBtn.setAttribute('aria-expanded', String(expanded));
  menuBtn.setAttribute('aria-label', mobileMq.matches ? (expanded ? 'Cerrar menú' : 'Abrir menú') : expanded ? 'Contraer menú' : 'Expandir menú');
}

function setCollapsed(collapsed) {
  layout.classList.toggle('is-collapsed', collapsed);
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch {}
  syncMenuBtn();
}

function setSidebar(open) {
  sidebar.classList.toggle('is-open', open);
  backdrop.hidden = !open;
  syncMenuBtn();
}

layout.classList.toggle('is-collapsed', readCollapsed());
mobileMq.addEventListener('change', () => {
  setSidebar(false);
  syncMenuBtn();
});
syncMenuBtn();

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  if (a.getAttribute('href') !== location.pathname) history.pushState(null, '', a.href);
  render();
  setSidebar(false);
});

window.addEventListener('popstate', render);
window.addEventListener('vx:navigate', (e) => {
  if (e.detail !== location.pathname) history.pushState(null, '', e.detail);
  render();
});
menuBtn.addEventListener('click', () => {
  if (mobileMq.matches) setSidebar(!sidebar.classList.contains('is-open'));
  else setCollapsed(!layout.classList.contains('is-collapsed'));
});
backdrop.addEventListener('click', () => setSidebar(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setSidebar(false));

// ---------------------------------------------------------------------------
// Usuario en sesión + selector de usuario (solo desarrollo)
// ---------------------------------------------------------------------------
function renderUser(me) {
  $('#userAvatar').innerHTML = avatarInner(me.user);
  $('#topUserAvatar').innerHTML = avatarInner(me.user);
  $('#topUser').title = `Mi perfil · ${me.user.name}`;
  $('#userName').textContent = me.user.name;
  $('#userRole').textContent = me.role.name;
}

// ---------------------------------------------------------------------------
// Modo dios (super administrador)
// ---------------------------------------------------------------------------
// Al cambiar de cuenta (entrar, regresar a un nivel superior o salir) siempre se abre el panel
// de esa cuenta, con los datos recién cargados, sin importar la sección en la que estabas
async function enterGodMode(userId) {
  await api('/api/god-mode', { method: 'POST', body: { userId } });
  location.href = '/';
}

async function exitGodMode() {
  await api('/api/god-mode', { method: 'DELETE' });
  location.href = '/';
}

function renderGodBanner(me) {
  const banner = $('#godBanner');
  if (!me.godMode) {
    banner.hidden = true;
    return;
  }
  // Ruta: Super admin › CPV › Coordinador de zona › … (cada nivel superior permite regresar a él)
  const chain = me.godMode.chain || [];
  banner.innerHTML = `
    <nav class="god-banner__text" aria-label="Ruta de navegación en modo dios">
      <ol class="god-path">
        ${chain
          .map((u, i) =>
            i === chain.length - 1
              ? `<li aria-current="page" title="${esc(u.name)} · ${esc(u.roleName)}"><strong>${esc(u.name)}</strong></li>`
              : `<li><button type="button" class="god-path__link" data-god="${u.role === 'superadmin' ? 'exit' : u.id}" data-role="${u.role}" title="Regresar a ${esc(u.name)} · ${esc(u.roleName)}">${esc(u.name)}</button></li>`
          )
          .join('')}
      </ol>
    </nav>
    <button class="icon-btn god-banner__exit" type="button" data-god="exit" title="Salir del modo dios" aria-label="Salir del modo dios">${ICONS.logout}</button>`;
  banner.hidden = false;
  banner.onclick = (e) => {
    const target = e.target.closest('[data-god]');
    if (!target) return;
    banner.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const go = target.dataset.god === 'exit' ? exitGodMode() : enterGodMode(target.dataset.god);
    go.catch((err) => {
      banner.querySelectorAll('button').forEach((b) => (b.disabled = false));
      toast(err.message);
    });
  };
}

async function setupDevSwitcher(me) {
  if (!me.dev) return;
  const all = await api('/api/dev/users');
  const byRole = new Map();
  for (const u of all) {
    if (!byRole.has(u.roleName)) byRole.set(u.roleName, []);
    byRole.get(u.roleName).push(u);
  }
  const select = $('#devUser');
  select.innerHTML = [...byRole]
    .map(
      ([role, list]) =>
        `<optgroup label="${esc(role)}">${list
          .map((u) => `<option value="${u.id}"${u.id === me.user.id ? ' selected' : ''}>${esc(u.name)}</option>`)
          .join('')}</optgroup>`
    )
    .join('');
  $('#devSwitch').hidden = false;
  select.addEventListener('change', async () => {
    await api('/api/dev/session', { method: 'POST', body: { userId: select.value } });
    location.href = '/';
  });
}

// ---------------------------------------------------------------------------
// Inicio y cierre de sesión
// ---------------------------------------------------------------------------
// ---------- Restablecer contraseña con código por WhatsApp ----------
function mostrarRecuperacion(usuarioInicial = '') {
  const form = $('#loginForm');
  const dev = $('.login__dev');
  const box = $('#recBox');
  const titulo = $('.login__title');
  const sub = $('.login__sub');
  const volver = (msg) => {
    box.hidden = true;
    box.innerHTML = '';
    form.hidden = false;
    if (dev) dev.hidden = false;
    titulo.textContent = 'Inicia sesión';
    sub.textContent = 'Sistema de estructura territorial electoral';
    if (msg) {
      $('#lgErr').textContent = '';
      toast(msg);
    }
    $('#lgUser').focus();
  };
  form.hidden = true;
  if (dev) dev.hidden = true;
  box.hidden = false;
  titulo.textContent = 'Restablecer contraseña';

  // Paso 1: usuario → se envía el código por WhatsApp
  const paso1 = () => {
    sub.textContent = 'Te enviaremos un código por WhatsApp al teléfono registrado en tu cuenta.';
    box.innerHTML = `
      <form id="recForm1" novalidate>
        <div class="field">
          <label for="recUser">Usuario</label>
          <input class="input" id="recUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(usuarioInicial)}" required>
          <p class="field__error" id="recUser-err"></p>
        </div>
        <p class="form-error" id="recErr" role="alert"></p>
        <button class="btn login__submit" type="submit">Enviar código</button>
        <button type="button" class="link-btn login__forgot" data-volver>Volver a iniciar sesión</button>
      </form>`;
    $('#recUser').focus();
    $('#recForm1').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type="submit"]');
      const username = $('#recUser').value.trim().toLowerCase();
      $('#recErr').textContent = '';
      $('#recUser-err').textContent = '';
      if (!username) {
        $('#recUser-err').textContent = 'Escribe tu usuario.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Enviando…';
      try {
        const r = await api('/api/auth/recuperar', { method: 'POST', body: { username } });
        usuarioInicial = username;
        paso2(r.mensaje);
      } catch (err) {
        $('#recErr').textContent = navigator.onLine ? err.message : 'Sin conexión. Intenta de nuevo cuando estés en línea.';
        btn.disabled = false;
        btn.textContent = 'Enviar código';
      }
    });
  };

  // Paso 2: código + contraseña nueva
  const paso2 = (mensaje) => {
    sub.textContent = mensaje;
    box.innerHTML = `
      <form id="recForm2" novalidate>
        <div class="field">
          <label for="recCode">Código de 6 dígitos</label>
          <input class="input rec-code" id="recCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required>
          <p class="field__error" id="recCode-err"></p>
        </div>
        <div class="field">
          <label for="recPass">Contraseña nueva</label>
          <input class="input" id="recPass" name="password" type="password" autocomplete="new-password" aria-describedby="recPass-help" required>
          <p class="field__help" id="recPass-help">Mínimo 8 caracteres, con letras y números.</p>
          <p class="field__error" id="recPass-err"></p>
        </div>
        <div class="field">
          <label for="recConfirm">Confirmar contraseña nueva</label>
          <input class="input" id="recConfirm" name="confirm" type="password" autocomplete="new-password" required>
          <p class="field__error" id="recConfirm-err"></p>
        </div>
        <p class="form-error" id="recErr" role="alert"></p>
        <button class="btn login__submit" type="submit">Cambiar contraseña</button>
        <div class="login__links">
          <button type="button" class="link-btn" data-reenviar>Enviar otro código</button>
          <button type="button" class="link-btn" data-volver>Volver</button>
        </div>
      </form>`;
    const code = $('#recCode');
    code.focus();
    code.addEventListener('input', () => (code.value = code.value.replace(/\D/g, '').slice(0, 6)));
    const setErrors = fieldErrorSetter(box, { code: 'recCode', password: 'recPass', confirm: 'recConfirm' });
    $('#recForm2').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type="submit"]');
      setErrors();
      $('#recErr').textContent = '';
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        await api('/api/auth/restablecer', {
          method: 'POST',
          body: { username: usuarioInicial, code: code.value, password: $('#recPass').value, confirm: $('#recConfirm').value },
        });
        $('#lgUser').value = usuarioInicial;
        $('#lgPass').value = '';
        volver('Contraseña actualizada. Ya puedes iniciar sesión.');
      } catch (err) {
        if (err.data?.fields) setErrors(err.data.fields);
        else $('#recErr').textContent = navigator.onLine ? err.message : 'Sin conexión.';
        btn.disabled = false;
        btn.textContent = 'Cambiar contraseña';
      }
    });
  };

  box.onclick = (e) => {
    if (e.target.closest('[data-volver]')) volver();
    if (e.target.closest('[data-reenviar]')) paso1();
  };
  paso1();
}

// Sesión vencida mientras se usa la app: al inicio de sesión, con aviso (una sola vez)
let sesionVencida = false;
window.addEventListener('vx:sesion-vencida', async () => {
  if (sesionVencida || !state.me || state.sinConexion) return;
  sesionVencida = true;
  localStorage.removeItem(ME_LOCAL);
  await showLogin('Tu sesión venció. Vuelve a iniciar sesión para continuar.');
});

async function showLogin(aviso = '') {
  const [devUsers, recup] = await Promise.all([
    api('/api/dev/users').catch(() => null),
    api('/api/auth/recuperar/disponible').catch(() => ({ disponible: false })),
  ]);
  $('.layout').hidden = true;
  const box = $('#login');
  box.hidden = false;
  box.innerHTML = `
    <main class="login__card">
      <img src="/brand/logo-claro.svg" alt="VERTEX" class="login__logo" width="220" height="50">
      <h1 class="login__title">Inicia sesión</h1>
      <p class="login__sub">Sistema de estructura territorial electoral</p>
      ${aviso ? `<p class="login__aviso" role="alert">${esc(aviso)}</p>` : ''}
      <form id="loginForm" novalidate>
        <div class="field">
          <label for="lgUser">Usuario</label>
          <input class="input" id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        </div>
        <div class="field">
          <label for="lgPass">Contraseña</label>
          <div class="input-icon input-icon--action input-icon--none">
            <input class="input" id="lgPass" name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="input-action" id="lgShow" aria-label="Mostrar contraseña" aria-pressed="false">${ICONS.eye}</button>
          </div>
        </div>
        <p class="form-error" id="lgErr" role="alert"></p>
        <button class="btn login__submit" type="submit">Entrar</button>
        ${recup.disponible ? '<button type="button" class="link-btn login__forgot" id="lgForgot">¿Olvidaste tu contraseña?</button>' : ''}
      </form>
      <div id="recBox" hidden></div>
      ${
        devUsers?.length
          ? `<div class="login__dev">
              <label for="lgDev">Modo desarrollo: entrar como</label>
              <div class="login__dev-row">
                <select class="input" id="lgDev">${devUsers.map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.roleName)}</option>`).join('')}</select>
                <button class="btn btn--secondary" type="button" id="lgDevGo">Entrar</button>
              </div>
            </div>`
          : ''
      }
    </main>
    <footer class="login__footer">Creado por <a href="https://www.instagram.com/rubenroqueguzman/" target="_blank" rel="noopener noreferrer">Rubén Roque</a></footer>`;
  const form = $('#loginForm');
  const err = $('#lgErr');
  $('#lgUser').focus();
  $('#lgShow').addEventListener('click', (e) => {
    const p = $('#lgPass');
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const body = Object.fromEntries(new FormData(form));
    err.textContent = '';
    if (!body.username || !body.password) {
      err.textContent = 'Escribe tu usuario y contraseña.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      await api('/api/auth/login', { method: 'POST', body });
      location.reload();
    } catch (ex) {
      err.textContent = navigator.onLine ? ex.message : 'Sin conexión. Intenta de nuevo cuando estés en línea.';
      btn.disabled = false;
      btn.textContent = 'Entrar';
      $('#lgPass').select();
    }
  });
  $('#lgForgot')?.addEventListener('click', () => mostrarRecuperacion($('#lgUser').value));
  $('#lgDevGo')?.addEventListener('click', async () => {
    await api('/api/dev/session', { method: 'POST', body: { userId: $('#lgDev').value } });
    location.reload();
  });
}

const logoutBtn = $('#logoutBtn');
logoutBtn.innerHTML = `${ICONS.logout}<span>Cerrar sesión</span>`;
$('#topLogout').innerHTML = ICONS.logout;
$('#topLogout').addEventListener('click', () => logoutBtn.click());
logoutBtn.addEventListener('click', async () => {
  // Con promovidos guardados en el teléfono sin enviar, primero se avisa (se borrarían)
  if (state.me?.role?.key === 'promotor' && (await pendientesLocales.todos(sesion.userId)).length) {
    navigate('/pendientes?salir');
    return;
  }
  logoutBtn.disabled = true;
  await borrarDatosLocales();
  localStorage.removeItem(ME_LOCAL);
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/entrar';
});

// ---------- Apariencia (clara / oscura / la del sistema) ----------
const TEMA_KEY = 'vx:tema';
function leerTema() {
  try {
    // Clara por defecto: el modo oscuro solo se activa si el usuario lo elige
    return localStorage.getItem(TEMA_KEY) || 'claro';
  } catch {
    return 'claro';
  }
}
const oscuroMq = window.matchMedia('(prefers-color-scheme: dark)');
function aplicarTema(t = leerTema(), guardar = false) {
  if (guardar) {
    try {
      localStorage.setItem(TEMA_KEY, t);
    } catch {}
  }
  const oscuro = t === 'oscuro' || (t === 'sistema' && oscuroMq.matches);
  document.documentElement.dataset.theme = oscuro ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#0d0d0d' : '#1c1c1e');
}
oscuroMq.addEventListener('change', () => leerTema() === 'sistema' && aplicarTema());
aplicarTema();

// ---------- Notificaciones push (en Mi perfil, por dispositivo) ----------
const b64aBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
async function montarPush(root) {
  const btn = $('#prefPush', root);
  const txt = $('#prefPushTxt', root);
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    txt.textContent = /iphone|ipad/i.test(navigator.userAgent)
      ? 'En iPhone, primero instala VERTEX en tu pantalla de inicio (Compartir › Agregar a inicio) y ábrela desde ahí.'
      : 'Este navegador no permite notificaciones.';
    return;
  }
  if (state.me?.godMode) {
    txt.textContent = 'En modo dios no se activan notificaciones de otra cuenta.';
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const pintar = async () => {
    const sub = await reg.pushManager.getSubscription();
    btn.hidden = false;
    if (Notification.permission === 'denied') {
      txt.textContent = 'Las notificaciones están bloqueadas para esta app. Actívalas en la configuración del navegador.';
      btn.hidden = true;
    } else if (sub) {
      txt.textContent = 'Activadas en este dispositivo.';
      btn.textContent = 'Desactivar en este dispositivo';
      btn.dataset.estado = 'on';
    } else {
      txt.textContent = 'Recibe avisos aunque la app esté cerrada (observaciones, aprobaciones, material…).';
      btn.textContent = 'Activar notificaciones';
      btn.dataset.estado = 'off';
    }
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (btn.dataset.estado === 'on') {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api('/api/push/suscribir', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
          await sub.unsubscribe();
        }
        toast('Notificaciones desactivadas en este dispositivo');
      } else {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('No diste permiso para mostrar notificaciones.');
        const { clave } = await api('/api/push/clave');
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(clave) });
        await api('/api/push/suscribir', { method: 'POST', body: { subscription: sub.toJSON() } });
        toast('Notificaciones activadas en este dispositivo');
      }
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      pintar();
    }
  });
  pintar();
}
// Al tocar una notificación con la app abierta, se navega a su pantalla
navigator.serviceWorker?.addEventListener('message', (e) => e.data?.tipo === 'abrir' && navigate(e.data.url));

// Última sesión conocida: permite abrir la app sin internet (solo para capturar)
const ME_LOCAL = 'vx:me';
const leerMe = () => {
  try {
    return JSON.parse(localStorage.getItem(ME_LOCAL) || 'null');
  } catch {
    return null;
  }
};

async function boot() {
  try {
    state.me = await api('/api/me');
    // /entrar es la puerta de inicio de sesión desde la página informativa: con sesión, al panel
    if (location.pathname === '/entrar') history.replaceState(null, '', '/');
    try {
      localStorage.setItem(ME_LOCAL, JSON.stringify(state.me));
    } catch {}
  } catch (err) {
    // Sin internet: el Promotor Territorial entra con su última sesión para capturar sin conexión
    const guardado = esErrorDeRed(err) ? leerMe() : null;
    if (guardado?.role?.key === 'promotor') {
      state.me = guardado;
      state.sinConexion = true;
    } else if (err.status === 401) {
      localStorage.removeItem(ME_LOCAL);
      await showLogin();
      $('#boot').hidden = true;
    } else {
      // Sin sesión confirmada no se muestra el panel: el error se queda en la pantalla de carga
      $('#boot').classList.add('is-error');
      $('#bootMsg').innerHTML = `<strong>No se pudo conectar</strong><br>${esc(navigator.onLine ? err.message : 'Sin conexión. Revisa tu internet.')}
        <br><button class="btn btn--sm" type="button" id="bootRetry">Reintentar</button>`;
      $('#bootRetry').addEventListener('click', () => location.reload());
    }
    if (!state.sinConexion) return;
  }
  if (state.me.eleccion) {
    ELECCION = { fecha: new Date(state.me.eleccion.fecha), texto: state.me.eleccion.texto };
    renderCountdown();
  }
  // Sesión válida: ahora sí se muestra el panel
  $('#boot').hidden = true;
  $('.layout').hidden = false;

  const menu = buildMenu(state.me);
  state.routes = new Map(menu.flatMap((g) => g.items).map((r) => [r.path, r]));
  // Perfil personal: disponible para todos los niveles desde la sección de usuario
  state.routes.set('/perfil', { path: '/perfil', title: 'Mi perfil', view: viewPerfil, mount: mountPerfil });
  // Notificaciones: todos los niveles, desde la campana de la barra superior
  state.routes.set('/notificaciones', { path: '/notificaciones', title: 'Notificaciones', view: viewNotificaciones, mount: mountNotificaciones });
  // Informe por periodo con FODA: todos los niveles, desde el botón de su panel
  state.routes.set('/informe', { path: '/informe', title: 'Informe', view: viewInforme, mount: mountInforme });
  // Rutas con parámetros
  state.patternRoutes = [];
  if (state.me.role.key === 'coord_zona') {
    state.routes.set('/responsables/nuevo', { path: '/responsables/nuevo', title: 'Nuevo responsable', view: viewResponsable, mount: mountResponsable });
    state.patternRoutes.push({ pattern: /^\/responsables\/([0-9a-f-]{36})\/editar$/, title: 'Editar responsable', view: viewResponsable, mount: mountResponsable });
  }
  if (state.me.role.key === 'promotor') {
  }
  if (state.me.role.key !== 'superadmin') {
    // Ficha del promovido (la rama del promotor hasta el CPV) y su edición (promotor y responsable)
    state.patternRoutes.push({ pattern: /^\/promovidos\/([0-9a-f-]{36})$/, title: 'Promovido', view: (r, p) => viewPromovido(r, p, state), mount: mountPromovido });
    state.patternRoutes.push({ pattern: /^\/promovidos\/([0-9a-f-]{36})\/editar$/, title: 'Editar promovido', view: viewNuevoPromovido, mount: mountNuevoPromovido });
  }
  if (['coord_promocion', 'coord_zona', 'resp_seccion'].includes(state.me.role.key)) {
    state.routes.set('/material/entregar', { path: '/material/entregar', title: 'Nueva orden de entrega', view: (r, p) => viewEntregar(r, p, state), mount: mountEntregar });
    state.patternRoutes.push({ pattern: /^\/material\/ordenes\/([0-9a-f-]{36})$/, title: 'Orden de entrega', view: viewOrden, mount: mountOrden });
  }
  // Asambleas y recorridos: el CPV los crea y edita; la ficha la ven los destinatarios; el reporte, quien lo tenga asignado
  if (state.me.role.key !== 'superadmin') {
    state.patternRoutes.push({ pattern: /^\/agenda\/eventos\/([0-9a-f-]{36})$/, title: 'Asamblea o recorrido', view: viewEvento, mount: mountEvento });
  }
  if (state.me.role.key === 'coord_promocion') {
    state.routes.set('/agenda/eventos', { path: '/agenda/eventos', title: 'Asambleas y recorridos', view: (r, p) => viewEventos(r, p, state) });
    state.routes.set('/agenda/nueva/asamblea', { path: '/agenda/nueva/asamblea', title: 'Nueva asamblea', view: viewFormEvento, mount: mountFormEvento });
    state.routes.set('/agenda/nueva/recorrido', { path: '/agenda/nueva/recorrido', title: 'Nuevo recorrido', view: viewFormEvento, mount: mountFormEvento });
    state.patternRoutes.push({ pattern: /^\/agenda\/eventos\/([0-9a-f-]{36})\/editar$/, title: 'Editar evento', view: viewFormEvento, mount: mountFormEvento });
  }
  if (['coord_promocion', 'coord_zona', 'resp_seccion'].includes(state.me.role.key)) {
    state.patternRoutes.push({ pattern: /^\/agenda\/eventos\/([0-9a-f-]{36})\/reporte$/, title: 'Reportar evento', view: viewReporte, mount: mountReporte });
  }
  // Listas de estructuras externas y de ciudadanos sin promover (CPV y super administrador)
  if (['coord_promocion', 'superadmin'].includes(state.me.role.key)) {
    state.routes.set('/estructuras-externas/sin-promover', { path: '/estructuras-externas/sin-promover', title: 'Ciudadanos sin promover', view: viewListaPersonas, mount: mountListaPersonas });
    state.patternRoutes.push({ pattern: /^\/estructuras-externas\/([0-9a-f-]{36})$/, title: 'Estructura externa', view: viewListaPersonas, mount: mountListaPersonas });
  }
  if (state.me.role.key === 'coord_promocion') {
    state.routes.set('/zonas/nueva', { path: '/zonas/nueva', title: 'Nueva zona', view: viewZona, mount: mountZona });
    state.patternRoutes.push({ pattern: /^\/zonas\/([0-9a-f-]{36})\/editar$/, title: 'Editar zona', view: viewZona, mount: mountZona });
  }
  if (state.me.role.key === 'superadmin') {
    state.routes.set('/usuarios/nuevo', { path: '/usuarios/nuevo', title: 'Nuevo coordinador', view: viewCoordinador, mount: mountCoordinador });
    state.patternRoutes.push({ pattern: /^\/usuarios\/([0-9a-f-]{36})$/, title: 'Coordinador de Promoción del Voto', view: viewFichaCpv, mount: mountFichaCpv });
    state.patternRoutes.push({
      pattern: /^\/usuarios\/([0-9a-f-]{36})\/editar$/,
      title: 'Editar coordinador',
      view: viewCoordinador,
      mount: mountCoordinador,
    });
    state.patternRoutes.push({
      pattern: /^\/bases-de-datos\/(\d{1,2})$/,
      title: 'Bases de datos',
      view: viewEntidadGeo,
      mount: mountEntidadGeo,
    });
  }
  renderNav(menu);
  renderDock(menu);
  montarIsla();
  if (!state.campana) {
    state.campana = true;
    iniciarCampana();
  }
  // Promotor Territorial: captura sin internet (pendientes en el teléfono y envío automático)
  if (state.me.role.key === 'promotor') {
    sesion.userId = state.me.user.id;
    state.routes.set('/pendientes', { path: '/pendientes', title: 'Por enviar', view: viewPendientes, mount: mountPendientes });
    const chip = $('#topPend');
    const pintarPendientes = async () => {
      const n = (await pendientesLocales.todos(sesion.userId)).length;
      chip.hidden = !n;
      chip.innerHTML = `${ICONS.upload}<span>${fmtNum(n)}</span>`;
      chip.title = chip.ariaLabel = `${fmtNum(n)} ${n === 1 ? 'promovido por enviar' : 'promovidos por enviar'}`;
    };
    window.addEventListener('vx:pendientes', pintarPendientes);
    pintarPendientes();
    iniciarSincronizacion(sesion.userId, (r) => {
      if (r.enviados) toast(`${fmtNum(r.enviados)} ${r.enviados === 1 ? 'promovido capturado sin internet se envió' : 'promovidos capturados sin internet se enviaron'}`);
      if (r.errores) toast(`${fmtNum(r.errores)} ${r.errores === 1 ? 'promovido no se pudo enviar' : 'promovidos no se pudieron enviar'}: revísalos en «Por enviar»`);
    });
    if (!state.sinConexion) prepararSinConexion(api);
  }
  renderUser(state.me);
  renderGodBanner(state.me);
  render();
  setupDevSwitcher(state.me).catch(() => {});
}

boot();

// ---------------------------------------------------------------------------
// Cuenta regresiva a la jornada electoral (apertura de casillas, hora del centro)
// ---------------------------------------------------------------------------
// La fecha llega del servidor en /api/me (única fuente: src/eleccion.js)
let ELECCION = null;
// Reloj minimalista: el minutero gira lento y el horario apenas avanza
const RELOJ = `<svg class="reloj" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9"/><line class="reloj__hora" x1="12" y1="12" x2="12" y2="8.5"/><line class="reloj__min" x1="12" y1="12" x2="12" y2="6"/></svg>`;

function renderCountdown() {
  if (!ELECCION) return;
  const el = $('#countdown');
  const ms = ELECCION.fecha - Date.now();
  if (ms <= 0) {
    const fin = new Date(ELECCION.fecha.getTime() + 10 * 3600 * 1000); // cierre de casillas 18:00
    el.innerHTML = Date.now() < fin
      ? `<span class="countdown__days">¡Hoy!</span><span class="countdown__label">Jornada electoral</span>`
      : `<span class="countdown__label">Jornada electoral concluida</span><span class="countdown__date">${ELECCION.texto}</span>`;
    el.title = `Jornada electoral: ${ELECCION.texto}`;
    return;
  }
  const dias = Math.floor(ms / 86400000);
  const horas = Math.floor((ms % 86400000) / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  el.innerHTML = `
    <span class="countdown__label">Faltan para la elección</span>
    <span class="countdown__main">${RELOJ}<span class="countdown__days">${fmtNum(dias)}</span><span class="countdown__unit">${dias === 1 ? 'día' : 'días'}</span></span>
    <span class="countdown__time">${String(horas).padStart(2, '0')} h ${String(min).padStart(2, '0')} min</span>
    <span class="countdown__date">${ELECCION.texto}</span>`;
  el.title = `Faltan ${fmtNum(dias)} días para la elección del ${ELECCION.texto}`;
  el.setAttribute('aria-label', el.title);
  const mini = $('#countdownMini');
  mini.innerHTML = `${RELOJ}<strong>${fmtNum(dias)}</strong> ${dias === 1 ? 'día' : 'días'}`;
  mini.title = el.title;
  mini.setAttribute('aria-label', el.title);
}
renderCountdown();
setInterval(renderCountdown, 30000);

// ---------------------------------------------------------------------------
// Estado de conexión
// ---------------------------------------------------------------------------
const netStatus = $('#netStatus');
function updateNet() {
  netStatus.dataset.online = String(navigator.onLine);
  netStatus.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
  let barra = $('#offlineBar');
  if (!barra) {
    barra = document.createElement('div');
    barra.id = 'offlineBar';
    barra.className = 'offline-bar';
    barra.setAttribute('role', 'status');
    document.body.prepend(barra);
  }
  barra.hidden = navigator.onLine;
  barra.textContent =
    state.me?.role?.key === 'promotor'
      ? 'Sin conexión · lo que captures se guarda en tu teléfono y se envía solo al volver la señal'
      : 'Sin conexión · los datos pueden no estar actualizados';
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
updateNet();

// ---------------------------------------------------------------------------
// PWA: service worker + instalación
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  // Si ya había una versión controlando la página y llega una nueva, se recarga una sola vez
  // para que el celular y la PWA instalada muestren los últimos cambios.
  const teniaControlador = Boolean(navigator.serviceWorker.controller);
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!teniaControlador || recargando) return;
    recargando = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // Al volver a la app (p. ej. PWA en segundo plano) se busca una versión nueva
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.error('SW error:', err));
  });
}

let deferredPrompt = null;
const installBtn = $('#installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => (installBtn.hidden = true));
