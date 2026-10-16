// Agenda: asambleas y recorridos.
// El CPV los crea (borrador → publicar), elige a quién van dirigidos (toda su red o algunas zonas) y quién
// los reporta. Al publicarse aparecen en el calendario de los destinatarios. Quien reporta envía, el día del
// evento, los resultados y la lista de asistencia (Excel con el mismo formato que las estructuras externas).
import { ICONS, $, esc, fmtNum, fmtSeccion, fmtDateTime, api, fieldErrorSetter, toast, navigate } from './lib.js';
import { baseMap } from './zonas.js';
import { aJpeg } from './material.js';

const TZ = 'America/Mexico_City';
const DIA_LARGO = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const MES = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const HORA = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const FECHA_HORA = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const HHMM = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const KEY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const diaKey = (iso) => KEY.format(new Date(iso));
const fechaDe = (key, fmt = DIA_LARGO) => fmt.format(new Date(`${key}T12:00:00Z`));
const icono = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  asamblea: icono('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  recorrido: icono('<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>'),
  pin: icono('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
  gps: icono('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>'),
  undo: icono('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  enviar: icono('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
  reloj: icono('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  ok: icono('<path d="M20 6 9 17l-5-5"/>'),
  red: icono('<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11l-6 6M12 11l6 6"/>'),
};
const TIPO = { asamblea: 'Asamblea', recorrido: 'Recorrido' };
// Identidad de cada tipo (siempre con su icono y nombre, nunca solo color)
const COLOR = { asamblea: '#2a78d6', recorrido: '#0d9488' };
const CHIP = { borrador: 'estatus--neutro', programado: 'estatus--programado', realizado: 'estatus--aprobado', cancelado: 'estatus--neutro' };
const chip = (e) => `<span class="estatus ${CHIP[e.estado]}">${esc(e.estadoTexto)}</span>`;
const cuando = (e) => (e.inicio ? `${esc(FECHA_HORA.format(new Date(e.inicio)))}${e.fin ? ` a ${esc(HORA.format(new Date(e.fin)))}` : ''}` : 'Sin fecha');

function tabs(rol, actual) {
  if (rol !== 'coord_promocion') return '';
  const t = (href, txt) => `<a class="tabs__tab" href="${href}" data-link ${href === actual ? 'aria-current="page"' : ''}>${txt}</a>`;
  return `<nav class="tabs ag-tabs" aria-label="Agenda">${t('/agenda', 'Calendario')}${t('/agenda/eventos', 'Asambleas y recorridos')}</nav>`;
}

function filaEvento(e, rol) {
  const extra = rol === 'coord_promocion' ? ` · Para ${esc(e.para)}${e.reporta ? ` · Reporta ${esc(e.reporta)}` : ''}` : e.reportaYo ? ' · Tú lo reportas' : '';
  return `<li><a class="ev-item ${e.turno ? 'is-turno' : ''}" href="/agenda/eventos/${e.id}" data-link>
      <span class="ev-item__ico ev-item__ico--${e.tipo}" aria-hidden="true">${I[e.tipo]}</span>
      <span class="ev-item__main">
        <span class="ev-item__top"><strong>${esc(e.lugar)}</strong>${chip(e)}</span>
        <span class="ev-item__sub">${TIPO[e.tipo]} · ${cuando(e)}${extra}</span>
        ${e.turno ? `<span class="ev-item__turno">Te toca: ${esc(e.turno)}</span>` : ''}
        ${e.reporteTardio ? '<span class="ev-item__tarde">Reporte tardío</span>' : ''}
      </span>
    </a></li>`;
}

// ===========================================================================
// Calendario del mes
// ===========================================================================
export async function viewAgenda(route, _p, state) {
  const q = new URLSearchParams(location.search);
  const d = await api(`/api/agenda?mes=${encodeURIComponent(q.get('mes') || '')}`);
  const rol = state.me.role.key;
  const [y, m] = d.mes.split('-').map(Number);
  const mesKey = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
  const prev = m === 1 ? mesKey(y - 1, 12) : mesKey(y, m - 1);
  const next = m === 12 ? mesKey(y + 1, 1) : mesKey(y, m + 1);
  const porDia = new Map();
  for (const e of d.eventos) {
    const k = diaKey(e.inicio);
    if (!porDia.has(k)) porDia.set(k, []);
    porDia.get(k).push(e);
  }
  // Cuadrícula de lunes a domingo
  const primero = new Date(Date.UTC(y, m - 1, 1));
  const desfase = (primero.getUTCDay() + 6) % 7;
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const celdas = [];
  for (let i = 0; i < desfase; i++) celdas.push('<div class="ag-dia is-fuera" aria-hidden="true"></div>');
  for (let dia = 1; dia <= diasMes; dia++) {
    const k = `${d.mes}-${String(dia).padStart(2, '0')}`;
    const evs = porDia.get(k) || [];
    celdas.push(`<div class="ag-dia ${k === d.hoy ? 'is-hoy' : ''} ${evs.length ? 'con-eventos' : ''}">
      <span class="ag-dia__n">${dia}</span>
      ${evs
        .map(
          (e) => `<a class="ag-ev ag-ev--${e.tipo} ${e.estado === 'realizado' ? 'is-hecho' : ''}" href="/agenda/eventos/${e.id}" data-link title="${esc(`${TIPO[e.tipo]} · ${e.lugar} · ${HORA.format(new Date(e.inicio))}`)}">
            <span class="ag-ev__ico">${I[e.tipo]}</span><span class="ag-ev__t">${esc(HORA.format(new Date(e.inicio)))} ${esc(e.lugar)}</span></a>`
        )
        .join('')}
    </div>`);
  }
  const dias = [...porDia.keys()].sort();
  const lista = dias.length
    ? dias
        .map(
          (k) => `<section class="ag-grupo" aria-label="${esc(fechaDe(k))}">
          <h3 class="ag-grupo__dia ${k === d.hoy ? 'is-hoy' : ''}">${esc(fechaDe(k))}${k === d.hoy ? ' · hoy' : ''}</h3>
          <ul class="ev-lista">${porDia.get(k).map((e) => filaEvento(e, rol)).join('')}</ul>
        </section>`
        )
        .join('')
    : `<div class="empty"><span aria-hidden="true">${ICONS.calendar}</span><strong>Sin eventos en ${esc(MES.format(primero))}</strong>
        <span>${rol === 'coord_promocion' ? 'Crea una asamblea o un recorrido y publícalo para que aparezca en la agenda de tu red.' : 'Cuando el CPV publique asambleas o recorridos para tu zona aparecerán aquí.'}</span></div>`;
  const porReportar = d.porReportar.length
    ? `<section class="ev-grupo is-turno" aria-labelledby="agPR"><h3 id="agPR">Por reportar <span class="muted">${fmtNum(d.porReportar.length)}</span></h3>
        <ul class="ev-lista">${d.porReportar.map((e) => filaEvento(e, rol)).join('')}</ul></section>`
    : '';

  return `
    <div class="ag">
      ${tabs(rol, '/agenda')}
      ${porReportar}
      <div class="ag-mesnav">
        <a class="icon-btn icon-btn--always" href="/agenda?mes=${prev}" data-link aria-label="Mes anterior">${ICONS.back}</a>
        <h2 class="ag-mes">${esc(MES.format(primero))}</h2>
        <a class="icon-btn icon-btn--always ag-sig" href="/agenda?mes=${next}" data-link aria-label="Mes siguiente">${ICONS.back}</a>
        ${d.mes !== d.hoy.slice(0, 7) ? `<a class="btn btn--secondary btn--sm" href="/agenda" data-link>Hoy</a>` : ''}
        <ul class="ag-leyenda" aria-label="Tipos de evento">
          <li><span class="ag-ley ag-ley--asamblea">${I.asamblea}</span>Asamblea</li>
          <li><span class="ag-ley ag-ley--recorrido">${I.recorrido}</span>Recorrido</li>
        </ul>
      </div>
      <div class="card ag-cal">
        <div class="ag-sem" aria-hidden="true">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((x) => `<span>${x}</span>`).join('')}</div>
        <div class="ag-grid">${celdas.join('')}</div>
      </div>
      <div class="ag-listado">${lista}</div>
    </div>`;
}

// ===========================================================================
// Lista del CPV: borradores, publicados, realizados y cancelados
// ===========================================================================
export async function viewEventos(route, _p, state) {
  const lista = await api('/api/eventos');
  const rol = state.me.role.key;
  const grupos = [
    { t: 'Por reportar', f: (e) => e.estado === 'programado' && e.inicio && new Date(e.inicio) <= new Date() },
    { t: 'Borradores', f: (e) => e.estado === 'borrador' },
    { t: 'Publicados', f: (e) => e.estado === 'programado', orden: true },
    { t: 'Realizados', f: (e) => e.estado === 'realizado' },
    { t: 'Cancelados', f: (e) => e.estado === 'cancelado', cerrado: true },
  ];
  const usados = new Set();
  const secciones = grupos
    .map((g) => {
      const items = lista.filter((e) => !usados.has(e.id) && g.f(e));
      items.forEach((e) => usados.add(e.id));
      if (!items.length) return '';
      if (g.orden) items.sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
      const ul = `<ul class="ev-lista">${items.map((e) => filaEvento(e, rol)).join('')}</ul>`;
      return g.cerrado
        ? `<details class="ev-grupo"><summary><h3>${g.t} <span class="muted">${fmtNum(items.length)}</span></h3></summary>${ul}</details>`
        : `<section class="ev-grupo ${g.t === 'Por reportar' ? 'is-turno' : ''}"><h3>${g.t} <span class="muted">${fmtNum(items.length)}</span></h3>${ul}</section>`;
    })
    .join('');
  const ayuda = 'Crea asambleas y recorridos, elige a quién van dirigidos y quién los reportará. Al publicarlos aparecen en la agenda de los destinatarios.';
  return `
    <div class="ag">
      ${tabs(rol, '/agenda/eventos')}
      <p class="muted ag-ayuda">${esc(ayuda)}</p>
      <div class="ev-proponer">
        <a class="btn" href="/agenda/nueva/asamblea" data-link>${I.asamblea}<span>Nueva asamblea</span></a>
        <a class="btn btn--secondary" href="/agenda/nueva/recorrido" data-link>${I.recorrido}<span>Nuevo recorrido</span></a>
      </div>
      ${secciones || `<div class="empty"><span aria-hidden="true">${ICONS.calendar}</span><strong>Aún no hay asambleas ni recorridos</strong><span>${esc(ayuda)}</span></div>`}
    </div>`;
}

// ===========================================================================
// Crear y editar (CPV): mapa con pin o ruta por calles, fecha, destinatarios y quién reporta
// ===========================================================================
export async function viewFormEvento(route, params) {
  const editando = Boolean(params[0]);
  const [e, ctx] = await Promise.all([editando ? api(`/api/eventos/${params[0]}`) : null, api('/api/eventos/contexto')]);
  const tipo = editando ? e.tipo : location.pathname.endsWith('/recorrido') ? 'recorrido' : 'asamblea';
  if (editando && !e.puede.editar) return `<div class="empty"><strong>Este evento ya no se puede modificar</strong><span>Está ${esc(e.estadoTexto.toLowerCase())}.</span></div>`;
  route.data = { e, ctx, tipo, editando };
  const v = e || { necesidades: [], asistentes: '', notas: '', lugar: '', alcance: 'red', zonas: [], reportaId: '' };
  const hoy = KEY.format(new Date());
  const otras = (v.necesidades || []).filter((n) => !ctx.necesidades.includes(n));
  const volver = editando ? `/agenda/eventos/${e.id}` : '/agenda/eventos';
  const publicado = editando && e.estado === 'programado';
  const fecha = v.inicio ? diaKey(v.inicio) : '';
  const hIni = v.inicio ? HHMM.format(new Date(v.inicio)) : '';
  const hFin = v.fin ? HHMM.format(new Date(v.fin)) : '';
  const op = (id, txt) => `<option value="${id}" ${v.reportaId === id ? 'selected' : ''}>${esc(txt)}</option>`;
  const titulo = editando ? `Editar ${tipo === 'asamblea' ? 'asamblea' : 'recorrido'}` : tipo === 'asamblea' ? 'Nueva asamblea' : 'Nuevo recorrido';
  return `
    <form class="ev-form" id="evForm" novalidate>
      <a class="back-link" href="${volver}" data-link>${ICONS.back}<span>${editando ? 'Volver al evento' : 'Asambleas y recorridos'}</span></a>
      <div class="page-head"><h2>${titulo}</h2>
        <p>${tipo === 'asamblea' ? 'Encuentro multitudinario en el que el candidato habla con los asistentes.' : 'Recorrido por la comunidad para saludar y platicar del proyecto.'}${
          publicado ? ' Ya está publicado: si cambias la fecha, el lugar o los destinatarios, se avisará a la red.' : ' Guárdalo como borrador o publícalo para que aparezca en la agenda de los destinatarios.'
        }</p></div>

      <section class="card form-card">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${I.pin}</span><h3>${tipo === 'asamblea' ? 'Lugar' : 'Ruta'}</h3></header>
        <div class="field">
          <label for="evLugar">${tipo === 'asamblea' ? 'Lugar de la asamblea' : 'Comunidad o colonia'} <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="evLugar" maxlength="160" value="${esc(v.lugar)}" placeholder="${tipo === 'asamblea' ? 'ej. Cancha de la colonia Centro, junto al mercado' : 'ej. Colonia Gil y Sáenz'}" required>
          <p class="field__error" id="evLugar-err"></p>
        </div>
        ${
          tipo === 'asamblea'
            ? `<div class="ev-map-bar">
                <p class="field__help" id="evPinTxt">Toca el mapa para poner el pin, o usa tu ubicación si estás en el lugar. Puedes arrastrar el pin para afinarlo.</p>
                <button class="btn btn--secondary btn--sm" type="button" id="evGps">${I.gps}<span>Usar mi ubicación</span></button>
              </div>`
            : `<div class="ev-map-bar ev-map-bar--ruta">
                <p class="field__help" id="evRutaTxt">Toca el mapa para marcar el inicio y luego cada punto del recorrido; la ruta sigue las calles.</p>
                <div class="ev-ruta-acc">
                  <label class="ev-switch"><input type="checkbox" id="evCalles" checked> Seguir calles</label>
                  <button class="btn btn--secondary btn--sm" type="button" id="evDeshacer" disabled>${I.undo}<span>Deshacer</span></button>
                  <button class="btn btn--secondary btn--sm" type="button" id="evBorrar" disabled>${ICONS.trash}<span>Borrar</span></button>
                </div>
              </div>`
        }
        <div class="ev-map" id="evMap" role="application" aria-label="${tipo === 'asamblea' ? 'Mapa para marcar el lugar' : 'Mapa para trazar la ruta'}"></div>
        <p class="field__error" id="evMapa-err"></p>
        ${tipo === 'recorrido' ? '<p class="ev-km" id="evKm" aria-live="polite"></p>' : ''}
      </section>

      <section class="card form-card">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.calendar}</span><h3>Fecha y hora</h3></header>
        <div class="field-row field-row--3">
          <div class="field"><label for="evFecha">Fecha <span class="req" aria-hidden="true">*</span></label>
            <input class="input" type="date" id="evFecha" value="${esc(fecha)}" ${publicado ? '' : `min="${hoy}"`}><p class="field__error" id="evFecha-err"></p></div>
          <div class="field"><label for="evIni">Hora de inicio <span class="req" aria-hidden="true">*</span></label>
            <input class="input" type="time" id="evIni" value="${esc(hIni)}"><p class="field__error" id="evIni-err"></p></div>
          <div class="field"><label for="evFin">Hora de término <span class="muted">(opcional)</span></label>
            <input class="input" type="time" id="evFin" value="${esc(hFin)}"><p class="field__error" id="evFin-err"></p></div>
        </div>
        <div class="field">
          <label for="evAsis">${tipo === 'asamblea' ? 'Asistentes esperados' : 'Personas que acompañarán al candidato'} <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="evAsis" inputmode="numeric" value="${esc(v.asistentes)}" placeholder="${tipo === 'asamblea' ? 'ej. 300' : 'ej. 15'}">
          <p class="field__error" id="evAsis-err"></p>
        </div>
      </section>

      <section class="card form-card">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${I.red}</span><h3>Destinatarios y reporte</h3></header>
        <fieldset class="field ev-alcance"><legend>¿En la agenda de quién aparecerá? <span class="req" aria-hidden="true">*</span></legend>
          <label class="ev-alc__op"><input type="radio" name="alcance" value="red" ${v.alcance !== 'zonas' ? 'checked' : ''}><span><strong>Toda mi red</strong><small>Todos los Coordinadores de Zona, Responsables de Sección y Promotores Territoriales</small></span></label>
          <label class="ev-alc__op"><input type="radio" name="alcance" value="zonas" ${v.alcance === 'zonas' ? 'checked' : ''}><span><strong>Coordinadores específicos</strong><small>Solo las zonas que elijas, con sus responsables y promotores</small></span></label>
          <div class="ev-zonas" id="evZonas" ${v.alcance === 'zonas' ? '' : 'hidden'}>
            ${
              ctx.zonas.length
                ? ctx.zonas
                    .map(
                      (z) => `<label class="ev-nec__op"><input type="checkbox" name="zona" value="${z.id}" ${(v.zonas || []).includes(z.id) ? 'checked' : ''}><span>${esc(z.codigo || z.zona)} · ${esc(z.nombre)}</span></label>`
                    )
                    .join('')
                : '<p class="muted">Aún no tienes Coordinadores de Zona.</p>'
            }
          </div>
          <p class="field__error" id="evZonas-err"></p>
        </fieldset>
        <div class="field">
          <label for="evReporta">¿Quién reportará el evento? <span class="req" aria-hidden="true">*</span></label>
          <select class="input" id="evReporta">
            <option value="">Elige a una persona</option>
            ${op(ctx.yo.id, `Yo (${ctx.yo.nombre})`)}
            ${ctx.zonas.length ? `<optgroup label="Coordinadores de Zona">${ctx.zonas.map((z) => op(z.id, `${z.nombre} · ${z.codigo || z.zona}`)).join('')}</optgroup>` : ''}
            ${ctx.zonas
              .filter((z) => z.responsables.length)
              .map((z) => `<optgroup label="Responsables · ${esc(z.codigo || z.zona)}">${z.responsables.map((r) => op(r.id, `${r.nombre}${r.seccion !== null ? ` · Sección ${fmtSeccion(r.seccion)}` : ''}`)).join('')}</optgroup>`)
              .join('')}
          </select>
          <p class="field__help">Esa persona enviará el día del evento los resultados, las fotos y la lista de asistencia.</p>
          <p class="field__error" id="evReporta-err"></p>
        </div>
      </section>

      <section class="card form-card">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.camera}</span><h3>Fotos del lugar <span class="muted">(hasta 5)</span></h3></header>
        <input type="file" id="evFotos" accept="image/*" multiple hidden>
        <div class="mat-previas ev-previas" id="evPrevias"></div>
        <button class="btn btn--secondary" type="button" id="evElegir">${ICONS.camera}<span>Tomar o elegir fotos</span></button>
        <p class="field__error" id="evFotos-err"></p>
      </section>

      <section class="card form-card">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.box}</span><h3>Necesidades técnicas</h3></header>
        <fieldset class="ev-nec"><legend class="sr-only">Necesidades técnicas</legend>
          ${ctx.necesidades.map((n, i) => `<label class="ev-nec__op"><input type="checkbox" name="nec" value="${esc(n)}" id="evNec${i}" ${(v.necesidades || []).includes(n) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}
        </fieldset>
        <div class="field">
          <label for="evOtras">Otras necesidades</label>
          <input class="input" id="evOtras" maxlength="300" value="${esc(otras.join(', '))}" placeholder="Sepáralas con comas">
        </div>
        <div class="field">
          <label for="evNotas">Notas</label>
          <textarea class="input" id="evNotas" rows="4" maxlength="2000" placeholder="Contexto, contactos del lugar, permisos, logística…">${esc(v.notas)}</textarea>
        </div>
      </section>

      <p class="form-error" id="evErr" role="alert"></p>
      <div class="ev-form__acc">
        <a class="btn btn--secondary" href="${volver}" data-link>Cancelar</a>
        ${
          publicado
            ? '<button class="btn" type="submit" data-modo="guardar">Guardar cambios</button>'
            : '<button class="btn btn--secondary" type="submit" data-modo="borrador">Guardar borrador</button><button class="btn" type="submit" data-modo="publicar">Publicar</button>'
        }
      </div>
    </form>`;
}

// Distancia del trazo (km)
function km(trazo) {
  let t = 0;
  const rad = (x) => (x * Math.PI) / 180;
  for (let i = 1; i < trazo.length; i++) {
    const [a1, o1] = trazo[i - 1];
    const [a2, o2] = trazo[i];
    const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
    t += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  return t;
}
const kmTxt = (v) => `${v.toLocaleString('es-MX', { maximumFractionDigits: v < 10 ? 2 : 1 })} km`;

// Marcadores circulares (sin imágenes externas)
const puntoIcono = (txt, color) => L.divIcon({ className: 'ev-punto', html: `<span style="background:${color}">${txt}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
const pinIcono = () => L.divIcon({ className: 'ev-pin', html: I.pin, iconSize: [36, 36], iconAnchor: [18, 34] });

// Contorno de la entidad como referencia (y para encuadrar el mapa)
async function dibujarEntidad(map, entidad) {
  if (!entidad) return null;
  try {
    const fc = await api(`/api/geo/states/${entidad}/layers/entidad`);
    const capa = L.geoJSON(fc, { style: { color: '#171717', weight: 1.5, dashArray: '6 6', fill: false }, interactive: false }).addTo(map);
    return capa.getBounds();
  } catch {
    return null;
  }
}

export function mountFormEvento(root, route) {
  const r = route.data;
  if (!r) return;
  const { e, ctx, tipo, editando } = r;
  const form = $('#evForm', root);
  const { map, destroy } = baseMap($('#evMap', root));
  map.setView([23.6, -102.5], 5);
  const setErrors = fieldErrorSetter(root, { lugar: 'evLugar', asistentes: 'evAsis', reportaId: 'evReporta' });
  const errMapa = $('#evMapa-err', root);
  let encuadrado = false;
  dibujarEntidad(map, ctx.entidad).then((b) => {
    if (!b || encuadrado) return;
    // El mapa ya tiene su tamaño final cuando llega la capa; se recalcula antes de encuadrar
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (!encuadrado) map.fitBounds(b, { padding: [12, 12] });
    });
  });

  // ---- Destinatarios
  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'alcance') $('#evZonas', root).hidden = ev.target.value !== 'zonas';
  });

  // ---- Asamblea: pin
  let pin = null;
  const ponerPin = (lat, lng, centrar = false) => {
    if (!pin) pin = L.marker([lat, lng], { draggable: true, icon: pinIcono(), keyboard: true, title: 'Lugar de la asamblea' }).addTo(map);
    else pin.setLatLng([lat, lng]);
    if (centrar) map.setView([lat, lng], Math.max(map.getZoom(), 17));
    errMapa.textContent = '';
    $('#evPinTxt', root).textContent = `Pin en ${lat.toFixed(5)}, ${lng.toFixed(5)}. Arrástralo para afinarlo.`;
  };
  // ---- Recorrido: puntos y tramos por calles
  const ruta = { puntos: [], tramos: [], calles: true, ocupado: false };
  let capaRuta = null;
  const trazo = () => ruta.tramos.flatMap((t, i) => (i ? t.slice(1) : t));
  const pintarRuta = () => {
    capaRuta?.remove();
    capaRuta = L.layerGroup().addTo(map);
    const t = trazo();
    if (t.length > 1) {
      L.polyline(t, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(capaRuta);
      L.polyline(t, { color: COLOR.recorrido, weight: 4.5 }).addTo(capaRuta);
    }
    ruta.puntos.forEach((p, i) => {
      const ult = i === ruta.puntos.length - 1;
      const txt = i === 0 ? 'A' : ult && ruta.puntos.length > 1 ? 'B' : String(i);
      L.marker(p, { icon: puntoIcono(txt, i === 0 ? '#16a34a' : ult ? '#171717' : COLOR.recorrido), interactive: false }).addTo(capaRuta);
    });
    $('#evKm', root).textContent = ruta.puntos.length
      ? `${ruta.puntos.length} ${ruta.puntos.length === 1 ? 'punto' : 'puntos'}${t.length > 1 ? ` · ${kmTxt(km(t))} de recorrido` : ' · toca el siguiente punto'}`
      : '';
    $('#evDeshacer', root).disabled = !ruta.puntos.length;
    $('#evBorrar', root).disabled = !ruta.puntos.length;
    if (ruta.puntos.length) errMapa.textContent = '';
  };
  const agregarPunto = async (lat, lng) => {
    if (ruta.ocupado) return;
    const p = [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
    if (ruta.puntos.length) {
      const prev = ruta.puntos.at(-1);
      let tramo = [prev, p];
      if (ruta.calles) {
        ruta.ocupado = true;
        $('#evRutaTxt', root).textContent = 'Buscando el camino por calles…';
        try {
          const res = await api(`/api/rutas?puntos=${prev.join(',')};${p.join(',')}`);
          tramo = [prev, ...res.trazo, p];
        } catch (err) {
          toast(err.message);
        } finally {
          ruta.ocupado = false;
          $('#evRutaTxt', root).textContent = 'Toca el mapa para agregar el siguiente punto. «Deshacer» quita el último.';
        }
      }
      ruta.tramos.push(tramo);
    }
    ruta.puntos.push(p);
    pintarRuta();
  };

  if (tipo === 'asamblea') {
    if (e?.lat) {
      ponerPin(e.lat, e.lng, true);
      encuadrado = true;
    }
    map.on('click', (ev) => ponerPin(ev.latlng.lat, ev.latlng.lng));
    $('#evGps', root).addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Este dispositivo no permite obtener la ubicación.');
      const b = $('#evGps', root);
      b.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          b.disabled = false;
          ponerPin(pos.coords.latitude, pos.coords.longitude, true);
          if (pos.coords.accuracy > 60) toast(`Ubicación aproximada (±${Math.round(pos.coords.accuracy)} m): revisa el pin.`);
        },
        () => {
          b.disabled = false;
          toast('No se pudo obtener tu ubicación. Revisa el permiso de ubicación o marca el lugar en el mapa.');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  } else {
    if (e?.ruta) {
      // Reparte el trazo guardado entre los puntos (cercanía), para que «Deshacer» funcione
      ruta.puntos = e.ruta.puntos;
      const t = e.ruta.trazo;
      let desde = 0;
      for (let i = 1; i < ruta.puntos.length; i++) {
        const [la, lo] = ruta.puntos[i];
        let mejor = desde;
        let dmin = Infinity;
        for (let j = desde; j < t.length; j++) {
          const dd = (t[j][0] - la) ** 2 + (t[j][1] - lo) ** 2;
          if (dd < dmin) {
            dmin = dd;
            mejor = j;
          }
        }
        ruta.tramos.push(t.slice(desde, mejor + 1));
        desde = mejor;
      }
      ruta.calles = e.ruta.calles !== false;
      $('#evCalles', root).checked = ruta.calles;
      pintarRuta();
      map.fitBounds(L.latLngBounds(e.ruta.trazo), { padding: [24, 24] });
      encuadrado = true;
    }
    map.on('click', (ev) => agregarPunto(ev.latlng.lat, ev.latlng.lng));
    $('#evCalles', root).addEventListener('change', (ev) => (ruta.calles = ev.target.checked));
    $('#evDeshacer', root).addEventListener('click', () => {
      ruta.puntos.pop();
      ruta.tramos.pop();
      pintarRuta();
    });
    let confirmar = false;
    $('#evBorrar', root).addEventListener('click', (ev) => {
      const b = ev.currentTarget;
      if (!confirmar) {
        confirmar = true;
        b.querySelector('span').textContent = '¿Borrar toda la ruta?';
        setTimeout(() => {
          confirmar = false;
          b.querySelector('span').textContent = 'Borrar';
        }, 3500);
        return;
      }
      confirmar = false;
      b.querySelector('span').textContent = 'Borrar';
      ruta.puntos = [];
      ruta.tramos = [];
      pintarRuta();
    });
  }

  // ---- Fotos del lugar (existentes al editar + nuevas)
  const existentes = editando ? [...e.fotosLugar] : [];
  const quitar = new Set();
  const nuevas = [];
  const previas = $('#evPrevias', root);
  const errFotos = $('#evFotos-err', root);
  const total = () => existentes.length - quitar.size + nuevas.length;
  const pintarFotos = () => {
    previas.innerHTML = [
      ...existentes
        .filter((id) => !quitar.has(id))
        .map((id) => `<figure><img src="/api/eventos/fotos/${id}" alt="Foto del lugar"><button class="icon-btn" type="button" data-quitar-existente="${id}" aria-label="Quitar foto">${ICONS.close}</button></figure>`),
      ...nuevas.map((f, i) => `<figure><img src="${f}" alt="Foto nueva ${i + 1}"><button class="icon-btn" type="button" data-quitar="${i}" aria-label="Quitar foto nueva ${i + 1}">${ICONS.close}</button></figure>`),
    ].join('');
    $('#evElegir', root).disabled = total() >= 5;
  };
  pintarFotos();
  $('#evElegir', root).addEventListener('click', () => $('#evFotos', root).click());
  $('#evFotos', root).addEventListener('change', async (ev) => {
    errFotos.textContent = '';
    for (const f of ev.target.files) {
      if (total() >= 5) {
        errFotos.textContent = 'Máximo 5 fotos del lugar.';
        break;
      }
      try {
        nuevas.push(await aJpeg(f));
      } catch {
        errFotos.textContent = 'Alguna foto no se pudo leer.';
      }
    }
    ev.target.value = '';
    pintarFotos();
  });
  previas.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-quitar], [data-quitar-existente]');
    if (!b) return;
    if (b.dataset.quitarExistente) quitar.add(b.dataset.quitarExistente);
    else nuevas.splice(Number(b.dataset.quitar), 1);
    pintarFotos();
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || form.querySelector('[type="submit"]:last-of-type');
    const modo = btn?.dataset.modo || 'guardar';
    const err = $('#evErr', root);
    err.textContent = '';
    setErrors();
    errMapa.textContent = '';
    for (const id of ['evFecha-err', 'evIni-err', 'evFin-err', 'evZonas-err']) $(`#${id}`, root).textContent = '';
    if (ruta.ocupado) return;
    const fecha = $('#evFecha', root).value;
    const hi = $('#evIni', root).value;
    const hf = $('#evFin', root).value;
    if ((hi || hf) && !fecha) return ($('#evFecha-err', root).textContent = 'Elige la fecha.');
    if (fecha && !hi) return ($('#evIni-err', root).textContent = 'Elige la hora de inicio.');
    const necesidades = [
      ...[...form.querySelectorAll('input[name="nec"]:checked')].map((x) => x.value),
      ...$('#evOtras', root)
        .value.split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ];
    const body = {
      tipo,
      lugar: $('#evLugar', root).value,
      inicio: fecha && hi ? `${fecha}T${hi}` : '',
      fin: fecha && hf ? `${fecha}T${hf}` : '',
      asistentes: $('#evAsis', root).value,
      necesidades,
      notas: $('#evNotas', root).value,
      alcance: form.querySelector('input[name="alcance"]:checked')?.value || 'red',
      zonas: [...form.querySelectorAll('input[name="zona"]:checked')].map((x) => x.value),
      reportaId: $('#evReporta', root).value,
      publicar: modo === 'publicar',
    };
    if (tipo === 'asamblea') {
      const p = pin?.getLatLng();
      body.lat = p?.lat;
      body.lng = p?.lng;
    } else body.ruta = ruta.puntos.length > 1 ? { puntos: ruta.puntos, trazo: trazo(), calles: ruta.calles } : null;
    if (editando) {
      body.fotosNuevas = nuevas;
      body.fotosQuitar = [...quitar].map(Number);
    } else body.fotos = nuevas;
    const botones = form.querySelectorAll('[type="submit"]');
    botones.forEach((b) => (b.disabled = true));
    const texto = btn.textContent;
    btn.textContent = modo === 'publicar' ? 'Publicando…' : 'Guardando…';
    try {
      const res = editando ? await api(`/api/eventos/${e.id}`, { method: 'PUT', body }) : await api('/api/eventos', { method: 'POST', body });
      toast(modo === 'publicar' ? 'Publicado: ya está en la agenda de los destinatarios' : editando && !res.cambios ? 'Sin cambios' : 'Guardado');
      navigate(`/agenda/eventos/${editando ? e.id : res.id}`);
    } catch (x) {
      const f = x.data?.fields || {};
      setErrors(f);
      if (f.ubicacion || f.ruta) errMapa.textContent = f.ubicacion || f.ruta;
      if (f.fotos) errFotos.textContent = f.fotos;
      if (f.inicio) $('#evIni-err', root).textContent = f.inicio;
      if (f.fin) $('#evFin-err', root).textContent = f.fin;
      if (f.zonas) $('#evZonas-err', root).textContent = f.zonas;
      err.textContent = navigator.onLine ? x.message : 'Sin conexión. Intenta de nuevo cuando tengas señal.';
    } finally {
      botones.forEach((b) => (b.disabled = false));
      btn.textContent = texto;
    }
  });
  return destroy;
}

// ===========================================================================
// Ficha del evento: datos, mapa, acciones del CPV, reporte, asistencia e historial
// ===========================================================================
const HIST = {
  creado: 'Guardó el borrador',
  publicado: 'Publicó',
  editado: 'Editó',
  cancelado: 'Canceló',
  reportado: 'Reportó',
  asistencia: 'Actualizó la lista de asistencia',
  // Eventos anteriores al cambio de flujo
  propuesto: 'Propuso',
  pasado: 'Pasó al CPV',
  reenviado: 'Reenvió con ajustes',
  ajustes: 'Pidió ajustes',
  rechazado: 'Rechazó',
  programado: 'Programó',
  reprogramado: 'Reprogramó',
};
const minutos = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export async function viewEvento(route, params) {
  const e = await api(`/api/eventos/${params[0]}`);
  const hist = e.puede.historial ? await api(`/api/eventos/${e.id}/historial`).catch(() => []) : [];
  route.evento = e;
  const p = e.puede;
  const dato = (label, value) => `<div><dt>${label}</dt><dd>${value || '—'}</dd></div>`;

  // Acciones según quién mira y en qué estado está
  const botones = [];
  if (p.publicar) botones.push(`<button class="btn btn--aprobar" type="button" data-publicar>${I.enviar}<span>Publicar</span></button>`);
  if (p.reportar) botones.push(`<a class="btn btn--aprobar" href="/agenda/eventos/${e.id}/reporte" data-link>${I.ok}<span>Reportar evento</span></a>`);
  if (p.editar) botones.push(`<a class="btn btn--secondary" href="/agenda/eventos/${e.id}/editar" data-link>${ICONS.edit}<span>Editar</span></a>`);
  if (p.cancelar) botones.push(`<button class="btn btn--secondary" type="button" data-abrir="cancelar">${ICONS.close}<span>Cancelar evento</span></button>`);
  if (p.eliminar) botones.push(`<button class="btn btn--secondary" type="button" data-eliminar>${ICONS.trash}<span>Eliminar borrador</span></button>`);
  const guia =
    e.estado === 'borrador'
      ? 'Borrador: solo tú lo ves. Publícalo para que aparezca en la agenda de los destinatarios.'
      : e.estado === 'programado'
        ? p.reportar
          ? 'Hoy es el día: al terminar, reporta los resultados con la lista de asistencia.'
          : e.reportaYo && e.reportarDesde
            ? `Tú lo reportas. Podrás hacerlo a partir del ${fechaDe(e.reportarDesde)}.`
            : e.rol === 'cpv'
              ? `Publicado.${e.reporta ? ` Lo reportará ${e.reporta}.` : ''}`
              : ''
        : '';
  const acciones =
    botones.length || guia
      ? `<section class="card ev-acc" aria-labelledby="evAccT">
          <h3 id="evAccT">${esc(guia)}</h3>
          ${botones.length ? `<div class="ev-acc__btns" id="evBtns">${botones.join('')}</div>` : ''}
          <form class="ev-acc__form" id="evAccForm" hidden novalidate>
            <div class="field"><label for="evMotivo">Motivo de la cancelación</label>
              <textarea class="input" id="evMotivo" rows="3" maxlength="1000"></textarea>
              <p class="field__help">Se avisará a todos los destinatarios.</p>
              <p class="field__error" id="evMotivo-err"></p></div>
            <div class="ev-acc__confirm">
              <button class="btn btn--secondary" type="button" data-cerrar>Volver</button>
              <button class="btn btn--destructive" type="submit">Cancelar evento</button>
            </div>
          </form>
          <p class="form-error" id="evAccErr" role="alert"></p>
        </section>`
      : '';

  const r = e.reporte;
  const reporte = r
    ? `<section class="card form-card ev-reporte" aria-labelledby="evRepT">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${I.ok}</span><h3 id="evRepT">Reporte</h3>
          ${e.reporteTardio ? '<span class="estatus estatus--observaciones">Reporte tardío</span>' : '<span class="estatus estatus--aprobado">A tiempo</span>'}</header>
        <div class="ev-metricas">
          <div><span>${e.tipo === 'asamblea' ? 'Asistentes' : 'Acompañantes'}</span><strong>${fmtNum(r.asistentes)}</strong></div>
          ${
            e.tipo === 'asamblea'
              ? `<div><span>Duración</span><strong>${esc(minutos(r.duracionMin))}</strong></div>`
              : `<div><span>Casas visitadas</span><strong>${fmtNum(r.casas)}</strong></div>
                 <div><span>Kilómetros</span><strong>${esc(kmTxt(r.km))}</strong></div>
                 <div><span>Tiempo</span><strong>${esc(minutos(r.tiempoMin))}</strong></div>
                 <div><span>Casas por hora</span><strong>${(r.casasHora ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 1 })}</strong></div>`
          }
        </div>
        ${r.observaciones ? `<p class="ev-reporte__obs">${esc(r.observaciones).replace(/\n/g, '<br>')}</p>` : ''}
        ${e.fotosTestimonio.length ? `<h4 class="ev-sub">Fotos de testimonio</h4><div class="mat-galeria">${e.fotosTestimonio.map((id) => `<a href="/api/eventos/fotos/${id}" target="_blank" rel="noopener"><img src="/api/eventos/fotos/${id}" alt="Foto de testimonio" loading="lazy"></a>`).join('')}</div>` : ''}
        <p class="muted ev-reporte__pie">Reportado el ${esc(fmtDateTime(e.reportadoAt))}${e.reporta ? ` por ${esc(e.reporta)}` : ''}.</p>
      </section>`
    : '';

  // Lista de asistencia: cotejo contra la estructura del CPV y sus estructuras paralelas
  const as = e.asistencia;
  const asistencia = as
    ? `<section class="card form-card ev-asis" aria-labelledby="evAsT">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.users}</span><h3 id="evAsT">Lista de asistencia</h3>
          <a class="btn btn--secondary btn--sm" href="/api/eventos/${e.id}/asistencia.xlsx" download>Descargar</a></header>
        <div class="ev-metricas">
          <div><span>Personas en la lista</span><strong>${fmtNum(as.cotejo.total)}</strong></div>
          <div><span>De nuestra estructura</span><strong>${fmtNum(as.cotejo.nuestra)}</strong></div>
          <div><span>De estructuras paralelas</span><strong>${fmtNum(as.cotejo.paralelas)}</strong></div>
          <div><span>En ambas</span><strong>${fmtNum(as.cotejo.ambas)}</strong></div>
          <div><span>Sin estructura</span><strong>${fmtNum(as.cotejo.sinEstructura)}</strong></div>
        </div>
        <p class="muted ev-reporte__pie">Archivo «${esc(as.archivo)}» · ${esc(fmtDateTime(as.at))} por ${esc(as.por)}${
          as.errores ? ` · ${fmtNum(as.errores)} ${as.errores === 1 ? 'fila' : 'filas'} sin clave ni CURP válida (no se tomaron)` : ''
        }. Las personas sin estructura pasan a «Ciudadanos sin promover».</p>
        ${
          p.corregirLista
            ? `<div class="ev-asis__acc">
                <input type="file" id="evLista" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
                <button class="btn btn--secondary btn--sm" type="button" id="evListaBtn">${ICONS.upload}<span>Actualizar lista</span></button>
                <span class="field__help">La nueva lista reemplaza a la anterior y queda en el historial.</span>
              </div>
              <p class="field__error" id="evLista-err"></p>`
            : ''
        }
      </section>`
    : '';

  const comoLlegar = e.lat ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}` : e.ruta ? `https://www.google.com/maps/search/?api=1&query=${e.ruta.puntos[0][0]},${e.ruta.puntos[0][1]}` : null;
  const cambios = (h) =>
    h.cambios?.length
      ? `<ul class="hist__cambios">${h.cambios.map((c) => `<li><span>${esc(c.campo)}:</span> ${c.antes ? `<s>${esc(c.antes)}</s> → ` : ''}<strong>${esc(c.despues || '(vacío)')}</strong></li>`).join('')}</ul>`
      : '';
  const hayMapa = e.lat || e.ruta;

  return `
    <div class="promo-ficha ev-ficha">
      <a class="back-link" href="${e.rol === 'cpv' ? '/agenda/eventos' : '/agenda'}" data-link>${ICONS.back}<span>${e.rol === 'cpv' ? 'Asambleas y recorridos' : 'Agenda'}</span></a>
      <div class="page-head">
        <p class="ev-tipo ev-tipo--${e.tipo}">${I[e.tipo]}<span>${TIPO[e.tipo]} · ${esc(e.folio)}</span></p>
        <h2>${esc(e.lugar)}</h2>
        <p>${chip(e)} Para ${esc(e.para)}${e.reporta ? ` · Reporta ${esc(e.reporta)}` : ''}</p>
      </div>
      ${
        e.inicio
          ? `<div class="ev-cuando">${I.reloj}<div><strong>${esc(FECHA_HORA.format(new Date(e.inicio)))}${e.fin ? ` a ${esc(HORA.format(new Date(e.fin)))}` : ''}</strong>
             <span>${e.estado === 'borrador' ? 'Fecha del borrador (aún no publicado)' : `Convoca ${esc(e.cpv)}`}</span></div></div>`
          : ''
      }
      ${acciones}
      ${reporte}
      ${asistencia}
      <div class="ev-ficha__grid">
        ${
          hayMapa
            ? `<section class="card form-card" aria-labelledby="evMapT">
            <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${I.pin}</span><h3 id="evMapT">${e.tipo === 'asamblea' ? 'Ubicación' : `Ruta${e.ruta ? ` · ${esc(kmTxt(e.ruta.km))}` : ''}`}</h3>
              ${comoLlegar ? `<a class="btn btn--secondary btn--sm" href="${comoLlegar}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}</header>
            <div class="ev-map ev-map--ver" id="evMapVer"></div>
          </section>`
            : ''
        }
        <section class="card form-card" aria-labelledby="evDatT">
          <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.calendar}</span><h3 id="evDatT">Datos del evento</h3></header>
          <dl class="ficha__grid">
            ${dato(e.tipo === 'asamblea' ? 'Asistentes esperados' : 'Acompañantes del candidato', fmtNum(e.asistentes))}
            ${dato('Destinatarios', esc(e.para))}
            ${dato('Reporta', esc(e.reporta || ''))}
            ${dato('Convoca', esc(e.cpv))}
          </dl>
          <h4 class="ev-sub">Necesidades técnicas</h4>
          ${e.necesidades.length ? `<ul class="ev-tags">${e.necesidades.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="muted">Ninguna.</p>'}
          ${e.notas ? `<h4 class="ev-sub">Notas</h4><p class="ev-notas">${esc(e.notas).replace(/\n/g, '<br>')}</p>` : ''}
          ${e.fotosLugar.length ? `<h4 class="ev-sub">Fotos del lugar</h4><div class="mat-galeria">${e.fotosLugar.map((id) => `<a href="/api/eventos/fotos/${id}" target="_blank" rel="noopener"><img src="/api/eventos/fotos/${id}" alt="Foto del lugar" loading="lazy"></a>`).join('')}</div>` : ''}
        </section>
        ${
          hist.length
            ? `<section class="card form-card" aria-labelledby="evHisT">
            <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.bitacora}</span><h3 id="evHisT">Historial</h3></header>
            <ol class="hist">${hist
              .map(
                (h) => `<li class="hist__item"><div class="hist__head"><strong>${esc(h.autor)} · ${esc(HIST[h.accion] || h.accion)}</strong><time datetime="${h.at}">${esc(fmtDateTime(h.at))}</time></div>
                ${h.detalle && !['creado', 'propuesto'].includes(h.accion) ? `<p class="hist__det">${esc(h.detalle)}</p>` : ''}${cambios(h)}</li>`
              )
              .join('')}</ol>
          </section>`
            : ''
        }
      </div>
    </div>`;
}

// Cuerpo para publicar un borrador desde la ficha (mismos datos que tiene guardados)
function cuerpoDe(e) {
  const fecha = e.inicio ? diaKey(e.inicio) : '';
  return {
    lugar: e.lugar,
    lat: e.lat,
    lng: e.lng,
    ruta: e.ruta,
    inicio: e.inicio ? `${fecha}T${HHMM.format(new Date(e.inicio))}` : '',
    fin: e.fin ? `${fecha}T${HHMM.format(new Date(e.fin))}` : '',
    asistentes: e.asistentes,
    necesidades: e.necesidades,
    notas: e.notas,
    alcance: e.alcance,
    zonas: e.zonas,
    reportaId: e.reportaId,
    publicar: true,
  };
}

export function mountEvento(root, route) {
  const e = route.evento;
  if (!e) return;
  const limpieza = [];
  // Mapa de solo lectura
  if ($('#evMapVer', root)) {
    const { map, destroy } = baseMap($('#evMapVer', root));
    limpieza.push(destroy);
    if (e.tipo === 'asamblea' && e.lat) {
      L.marker([e.lat, e.lng], { icon: pinIcono(), interactive: false }).addTo(map);
      map.setView([e.lat, e.lng], 17);
    } else if (e.ruta) {
      L.polyline(e.ruta.trazo, { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(map);
      L.polyline(e.ruta.trazo, { color: COLOR.recorrido, weight: 4.5 }).addTo(map);
      L.marker(e.ruta.puntos[0], { icon: puntoIcono('A', '#16a34a'), interactive: false }).addTo(map);
      L.marker(e.ruta.puntos.at(-1), { icon: puntoIcono('B', '#171717'), interactive: false }).addTo(map);
      map.fitBounds(L.latLngBounds(e.ruta.trazo), { padding: [24, 24] });
    }
  }

  // ---- Corregir la lista de asistencia (reemplaza la anterior)
  const listaBtn = $('#evListaBtn', root);
  if (listaBtn) {
    const input = $('#evLista', root);
    listaBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      const err = $('#evLista-err', root);
      err.textContent = '';
      if (!/\.xlsx$/i.test(f.name)) return (err.textContent = 'La lista debe ser un archivo de Excel (.xlsx).');
      listaBtn.disabled = true;
      listaBtn.querySelector('span').textContent = 'Subiendo…';
      try {
        const res = await fetch(`/api/eventos/${e.id}/asistencia`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-File-Name': encodeURIComponent(f.name) },
          body: f,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || 'No se pudo actualizar la lista.');
        toast(`Lista actualizada: ${fmtNum(j.asistentes)} asistentes${j.errores ? ` (${fmtNum(j.errores)} filas con error)` : ''}`);
        navigate(location.pathname);
      } catch (x) {
        err.textContent = navigator.onLine ? x.message : 'Sin conexión. Intenta de nuevo.';
        listaBtn.disabled = false;
        listaBtn.querySelector('span').textContent = 'Actualizar lista';
      }
    });
  }

  // ---- Acciones del CPV: publicar, cancelar (con motivo) y eliminar borrador (doble toque)
  const btns = $('#evBtns', root);
  const accForm = $('#evAccForm', root);
  const accErr = $('#evAccErr', root);
  let confirmarEliminar = false;
  if (btns) {
    btns.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-publicar], [data-abrir], [data-eliminar]');
      if (!b) return;
      accErr.textContent = '';
      if (b.dataset.abrir) {
        accForm.hidden = false;
        btns.hidden = true;
        $('#evMotivo', root).focus();
        return;
      }
      if (b.hasAttribute('data-eliminar') && !confirmarEliminar) {
        confirmarEliminar = true;
        b.querySelector('span').textContent = '¿Eliminar el borrador? Toca de nuevo';
        setTimeout(() => {
          confirmarEliminar = false;
          b.querySelector('span').textContent = 'Eliminar borrador';
        }, 4000);
        return;
      }
      b.disabled = true;
      try {
        if (b.hasAttribute('data-publicar')) {
          await api(`/api/eventos/${e.id}`, { method: 'PUT', body: cuerpoDe(e) });
          toast('Publicado: ya está en la agenda de los destinatarios');
          navigate(location.pathname);
        } else {
          await api(`/api/eventos/${e.id}/cancelar`, { method: 'POST', body: {} });
          toast('Borrador eliminado');
          navigate('/agenda/eventos');
        }
      } catch (err) {
        const falta = Object.values(err.data?.fields || {});
        accErr.textContent = falta.length ? `Para publicar falta: ${falta.join(' ')} Usa «Editar» para completarlo.` : err.message;
        b.disabled = false;
      }
    });
    accForm?.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-cerrar]')) return;
      accForm.hidden = true;
      btns.hidden = false;
      accErr.textContent = '';
    });
    accForm?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const ok = accForm.querySelector('[type="submit"]');
      ok.disabled = true;
      $('#evMotivo-err', root).textContent = '';
      try {
        await api(`/api/eventos/${e.id}/cancelar`, { method: 'POST', body: { motivo: $('#evMotivo', root).value } });
        toast('Evento cancelado; se avisó a los destinatarios');
        navigate(location.pathname);
      } catch (err) {
        $('#evMotivo-err', root).textContent = err.data?.fields?.motivo || '';
        accErr.textContent = err.message;
        ok.disabled = false;
      }
    });
  }
  return () => limpieza.forEach((f) => f());
}

// ===========================================================================
// Reporte (la persona designada por el CPV)
// ===========================================================================
export async function viewReporte(route, params) {
  const e = await api(`/api/eventos/${params[0]}`);
  route.evento = e;
  if (!e.puede.reportar) {
    return `<div class="empty"><strong>Este evento no se puede reportar</strong><span>${
      e.estado === 'realizado'
        ? 'Ya fue reportado.'
        : !e.reportaYo
          ? 'Lo reporta otra persona.'
          : e.estado === 'programado'
            ? `Podrás reportarlo a partir del ${esc(fechaDe(e.reportarDesde))}.`
            : 'Solo se reportan eventos publicados.'
    }</span><a class="btn btn--secondary" href="/agenda/eventos/${e.id}" data-link>Volver al evento</a></div>`;
  }
  const tarde = KEY.format(new Date()) > e.reportarDesde;
  const tiempo = (id, label) => `
    <fieldset class="field ev-tiempo"><legend>${label} <span class="req" aria-hidden="true">*</span></legend>
      <div class="ev-tiempo__in"><input class="input" id="${id}H" inputmode="numeric" placeholder="0" aria-label="Horas"><span>h</span>
      <input class="input" id="${id}M" inputmode="numeric" placeholder="0" aria-label="Minutos"><span>min</span></div>
      <p class="field__error" id="${id}-err"></p></fieldset>`;
  return `
    <form class="ev-form" id="repForm" novalidate>
      <a class="back-link" href="/agenda/eventos/${e.id}" data-link>${ICONS.back}<span>Volver al evento</span></a>
      <div class="page-head"><h2>Reporte: ${esc(e.lugar)}</h2>
        <p>${TIPO[e.tipo]} del ${esc(FECHA_HORA.format(new Date(e.inicio)))}.</p></div>
      ${tarde ? `<div class="notice notice--danger">${ICONS.alert}<div>El evento fue el ${esc(fechaDe(e.reportarDesde))}: este reporte quedará marcado como <strong>tardío</strong> y se avisará al CPV.</div></div>` : ''}
      <section class="card form-card">
        <div class="field-row">
          <div class="field"><label for="repAsis">${e.tipo === 'asamblea' ? 'Cantidad de asistentes' : 'Personas que acompañaron al candidato'} <span class="req" aria-hidden="true">*</span></label>
            <input class="input" id="repAsis" inputmode="numeric" required><p class="field__error" id="repAsis-err"></p></div>
          ${
            e.tipo === 'asamblea'
              ? tiempo('repDur', 'Duración del evento')
              : `<div class="field"><label for="repCasas">Casas visitadas <span class="req" aria-hidden="true">*</span></label>
                  <input class="input" id="repCasas" inputmode="numeric" required><p class="field__error" id="repCasas-err"></p></div>`
          }
        </div>
        ${
          e.tipo === 'recorrido'
            ? `<div class="field-row">
                <div class="field"><label for="repKm">Kilómetros recorridos <span class="req" aria-hidden="true">*</span></label>
                  <input class="input" id="repKm" inputmode="decimal" value="${e.ruta ? String(e.ruta.km) : ''}" required>
                  <p class="field__help">${e.ruta ? `Prellenado con la ruta trazada (${esc(kmTxt(e.ruta.km))}); corrígelo si cambió.` : 'Distancia aproximada del recorrido.'}</p><p class="field__error" id="repKm-err"></p></div>
                ${tiempo('repTiempo', 'Tiempo de recorrido')}
              </div>
              <p class="ev-promedio" id="repProm" aria-live="polite">Promedio: — casas por hora</p>`
            : `<div class="field"><span class="field__label">Fotos de testimonio <span class="req" aria-hidden="true">*</span> <span class="muted">(1 a 10)</span></span>
                <input type="file" id="repFotos" accept="image/*" multiple hidden>
                <div class="mat-previas" id="repPrevias"></div>
                <button class="btn btn--secondary" type="button" id="repElegir">${ICONS.camera}<span>Tomar o elegir fotos</span></button>
                <p class="field__error" id="repFotos-err"></p></div>`
        }
        <div class="field"><label for="repObs">Observaciones</label>
          <textarea class="input" id="repObs" rows="4" maxlength="2000" placeholder="¿Cómo estuvo? Peticiones de la gente, incidentes, compromisos…"></textarea></div>
      </section>
      <section class="card form-card">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.users}</span><h3>Lista de asistencia <span class="req" aria-hidden="true">*</span></h3>
          <a class="btn btn--secondary btn--sm" href="/api/listas/plantilla" download>Descargar plantilla</a></header>
        <div class="field">
          <label for="repLista">Excel (.xlsx) con las personas que asistieron</label>
          <input class="input" type="file" id="repLista" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
          <p class="field__help">Mismo formato que las estructuras externas: CLAVE_ELECTOR, CURP, APELLIDO_PATERNO, APELLIDO_MATERNO, NOMBRES, TELEFONO, SECCION. Cada persona necesita su clave de elector o su CURP. Podrás corregir la lista después.</p>
          <p class="field__error" id="repLista-err"></p>
        </div>
      </section>
      <p class="form-error" id="repErr" role="alert"></p>
      <div class="ev-form__acc">
        <a class="btn btn--secondary" href="/agenda/eventos/${e.id}" data-link>Cancelar</a>
        <button class="btn" type="submit">Enviar reporte</button>
      </div>
    </form>`;
}

export function mountReporte(root, route) {
  const e = route.evento;
  const form = $('#repForm', root);
  if (!form) return;
  const n = (id) => Number(($(`#${id}`, root)?.value || '').replace(/[,\s]/g, '')) || 0;
  const mins = (id) => n(`${id}H`) * 60 + n(`${id}M`);
  const fotos = [];
  if (e.tipo === 'recorrido') {
    const prom = () => {
      const t = mins('repTiempo');
      const c = n('repCasas');
      $('#repProm', root).innerHTML = t && c ? `Promedio: <strong>${(c / (t / 60)).toLocaleString('es-MX', { maximumFractionDigits: 1 })}</strong> casas por hora` : 'Promedio: — casas por hora';
    };
    form.addEventListener('input', prom);
  } else {
    const previas = $('#repPrevias', root);
    const err = $('#repFotos-err', root);
    const pintar = () => {
      previas.innerHTML = fotos.map((f, i) => `<figure><img src="${f}" alt="Foto ${i + 1}"><button class="icon-btn" type="button" data-quitar="${i}" aria-label="Quitar foto ${i + 1}">${ICONS.close}</button></figure>`).join('');
      $('#repElegir', root).disabled = fotos.length >= 10;
    };
    $('#repElegir', root).addEventListener('click', () => $('#repFotos', root).click());
    $('#repFotos', root).addEventListener('change', async (ev) => {
      err.textContent = '';
      for (const f of ev.target.files) {
        if (fotos.length >= 10) {
          err.textContent = 'Máximo 10 fotos.';
          break;
        }
        try {
          fotos.push(await aJpeg(f));
        } catch {
          err.textContent = 'Alguna foto no se pudo leer.';
        }
      }
      ev.target.value = '';
      pintar();
    });
    previas.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-quitar]');
      if (!b) return;
      fotos.splice(Number(b.dataset.quitar), 1);
      pintar();
    });
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const errs = {
      asistentes: 'repAsis-err',
      duracionMin: 'repDur-err',
      casas: 'repCasas-err',
      km: 'repKm-err',
      tiempoMin: 'repTiempo-err',
      fotos: 'repFotos-err',
      lista: 'repLista-err',
    };
    for (const id of Object.values(errs)) $(`#${id}`, root) && ($(`#${id}`, root).textContent = '');
    $('#repErr', root).textContent = '';
    const body = { asistentes: $('#repAsis', root).value, observaciones: $('#repObs', root).value };
    if (e.tipo === 'asamblea') {
      body.duracionMin = mins('repDur');
      body.fotos = fotos;
    } else {
      body.casas = $('#repCasas', root).value;
      body.km = $('#repKm', root).value;
      body.tiempoMin = mins('repTiempo');
    }
    // Lista de asistencia (obligatoria): viaja como data URL dentro del reporte
    const archivo = $('#repLista', root).files[0];
    if (!archivo) {
      $('#repLista-err', root).textContent = 'Sube la lista de asistencia (Excel con la plantilla).';
      $('#repLista', root).focus();
      return;
    }
    if (!/\.xlsx$/i.test(archivo.name)) {
      $('#repLista-err', root).textContent = 'La lista debe ser un archivo de Excel (.xlsx).';
      return;
    }
    body.listaNombre = archivo.name;
    body.lista = await new Promise((ok, fail) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = fail;
      fr.readAsDataURL(archivo);
    });
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const r = await api(`/api/eventos/${e.id}/reporte`, { method: 'POST', body });
      toast(`${r.tardio ? 'Reporte enviado (tardío)' : 'Reporte enviado'} · lista de ${fmtNum(r.lista.asistentes)} asistentes${r.lista.errores ? ` (${fmtNum(r.lista.errores)} filas con error)` : ''}`);
      navigate(`/agenda/eventos/${e.id}`);
    } catch (x) {
      const f = x.data?.fields || {};
      for (const [k, id] of Object.entries(errs)) if (f[k] && $(`#${id}`, root)) $(`#${id}`, root).textContent = f[k];
      $('#repErr', root).textContent = navigator.onLine ? x.message : 'Sin conexión. Intenta de nuevo cuando tengas señal.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar reporte';
    }
  });
}
