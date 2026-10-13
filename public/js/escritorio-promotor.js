// Panel del Promotor Territorial (pensado para el celular): su meta, lo que debe corregir,
// su actividad de 14 días, su lugar en la sección, su Responsable y sus capturas recientes.
import { ICONS, esc, fmtNum, fmtSeccion, fmtDateTime, api } from './lib.js';
import { I } from './coordinador.js';
import { pendientes, sesion, esErrorDeRed } from './offline.js';

const ESTADO = {
  validado: { t: 'Aprobado', c: '#16a34a' },
  en_revision: { t: 'En revisión', c: '#f59e0b' },
  rechazado: { t: 'Rechazado', c: '#dc2626' },
};
const DIA = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

function hace(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 3600) return `Hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `Hace ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'día' : 'días'}`;
  return fmtDateTime(iso);
}

// Anillo de avance (un solo valor: lo capturado contra la meta)
function anillo(valor, meta) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, meta ? valor / meta : 0);
  return `<svg class="ep-anillo" viewBox="0 0 120 120" role="img" aria-label="${fmtNum(valor)} de ${fmtNum(meta)} promovidos">
    <circle cx="60" cy="60" r="${r}" class="ep-anillo__fondo"/>
    <circle cx="60" cy="60" r="${r}" class="ep-anillo__valor${p >= 1 ? ' is-meta' : ''}" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" class="ep-anillo__num">${fmtNum(valor)}</text>
    <text x="60" y="78" text-anchor="middle" class="ep-anillo__de">de ${fmtNum(meta)}</text>
  </svg>`;
}

// Barras de 14 días (cada barra con su valor al tocar o pasar el mouse)
function actividad(serie) {
  const max = Math.max(...serie.conteo, 1);
  return `<ol class="ep-barras" aria-label="Promovidos capturados por día, últimos 14 días">
    ${serie.dias
      .map((d, i) => {
        const v = serie.conteo[i];
        const fecha = DIA.format(new Date(`${d}T12:00:00Z`));
        const hoy = i === serie.dias.length - 1;
        return `<li title="${esc(fecha)}: ${fmtNum(v)}" class="${hoy ? 'is-hoy' : ''}">
          <span class="ep-barras__v">${v || ''}</span>
          <span class="ep-barras__b" style="height:${v ? Math.max(8, (v / max) * 100) : 3}%"></span>
          <span class="ep-barras__d">${hoy ? 'Hoy' : esc(fecha.split(' ')[0].slice(0, 2))}</span>
          <span class="sr-only">${esc(fecha)}: ${fmtNum(v)}</span>
        </li>`;
      })
      .join('')}
  </ol>`;
}

const contacto = (nombre, phone) => {
  const tel = String(phone || '').replace(/\D/g, '').slice(-10);
  return tel
    ? `<span class="promo-contacto">
        <a class="icon-btn promo-contacto__btn" href="tel:+52${tel}" title="Llamar" aria-label="Llamar a ${esc(nombre)}">${I.phone}</a>
        <a class="icon-btn promo-contacto__btn" href="https://wa.me/52${tel}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp con ${esc(nombre)}">${I.whatsapp}</a>
      </span>`
    : '';
};

export async function viewEscritorioPromotor() {
  const n = (await pendientes.todos(sesion.userId)).length;
  const porEnviar = n
    ? `<a class="pend-aviso" href="/pendientes" data-link>${ICONS.upload}<span><strong>${fmtNum(n)}</strong> ${n === 1 ? 'promovido guardado' : 'promovidos guardados'} en tu teléfono por enviar</span><span aria-hidden="true">›</span></a>`
    : '';
  let d;
  try {
    d = await api('/api/escritorio/promotor');
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    // Sin internet: lo esencial para seguir capturando
    return `<div class="ep">
      <section class="ep-hero ep-hero--sin"><div class="ep-hero__txt">
        <p class="ep-hero__label">Sin internet</p>
        <p class="ep-hero__titulo">Puedes seguir capturando</p>
        <p class="ep-hero__sub">Lo que captures se guarda en tu teléfono y se envía solo cuando recuperes la señal.</p>
      </div></section>
      <a class="btn ep-capturar" href="/promovidos/nuevo" data-link>${ICONS.plus}<span>Capturar promovido</span></a>
      ${porEnviar}
    </div>`;
  }
  const e = d.estatus;
  const cumplida = d.total >= d.meta;
  const delta = d.serie.semana - d.serie.semanaAnterior;

  const hero = `
    <section class="ep-hero" aria-label="Tu meta">
      ${anillo(d.total, d.meta)}
      <div class="ep-hero__txt">
        <p class="ep-hero__label">Tu meta de promovidos</p>
        <p class="ep-hero__titulo">${cumplida ? '¡Meta cumplida!' : `Te faltan ${fmtNum(d.faltan)}`}</p>
        <p class="ep-hero__sub">${
          cumplida
            ? `Llevas ${fmtNum(d.total - d.meta)} más de tu meta. Cada promovido extra suma a tu sección.`
            : `Captura ${fmtNum(d.porSemana)} por semana para llegar antes de la elección.`
        }</p>
        <p class="ep-hero__pie">${d.seccion !== null ? `Sección ${fmtSeccion(d.seccion)} · ` : ''}${fmtNum(d.eleccion.dias)} días para la elección</p>
      </div>
    </section>
    <a class="btn ep-capturar" href="/promovidos/nuevo" data-link>${ICONS.plus}<span>Capturar promovido</span></a>`;

  const corregir = d.corregir.length
    ? `<section class="card ep-corregir" aria-labelledby="epCoT">
        <header class="dash-card__head"><h3 id="epCoT">Tienes que corregir</h3><span class="ep-badge">${fmtNum(d.corregir.length)}</span></header>
        <ul class="ep-lista">${d.corregir
          .map(
            (c) => `<li><a href="/promovidos/${c.id}" data-link class="ep-item">
              <span class="ep-item__top"><strong>${esc(c.nombre)}</strong><span class="estatus estatus--observaciones">${c.estatus === 'rechazado' ? 'Rechazado' : 'Con observaciones'}</span></span>
              <span class="ep-item__msg">«${esc(c.mensaje.replace(/^Rechazado:\s*/, ''))}»</span>
              <span class="ep-item__at">${esc(hace(c.at))}</span>
            </a></li>`
          )
          .join('')}</ul>
      </section>`
    : '';

  const tile = (t, v, c) => `<div class="ep-tile"><span class="vz-sw" style="background:${c}"></span><strong>${fmtNum(v)}</strong><span>${t}</span></div>`;
  const resumen = `
    <section class="ep-tiles" aria-label="Tus promovidos por estatus">
      ${tile('Aprobados', e.aprobados, '#16a34a')}
      ${tile('En revisión', e.revision, '#f59e0b')}
      ${tile('Con observaciones', e.observaciones, '#dc2626')}
      ${tile('Rechazados', e.rechazados, '#4a3aa7')}
    </section>`;

  const act = `
    <section class="card" aria-labelledby="epAcT">
      <header class="dash-card__head"><h3 id="epAcT">Tu actividad</h3><span class="muted">Últimos 14 días</span></header>
      ${actividad(d.serie)}
      <dl class="ep-stats">
        <div><dt>Esta semana</dt><dd>${fmtNum(d.serie.semana)}</dd><p>${delta === 0 ? 'Igual que la anterior' : `${delta > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(delta))} vs. la anterior`}</p></div>
        <div><dt>Racha</dt><dd>${fmtNum(d.racha)} <small>${d.racha === 1 ? 'día' : 'días'}</small></dd><p>${d.racha ? 'seguidos capturando' : 'Captura hoy para empezar'}</p></div>
        <div><dt>Tu lugar</dt><dd>#${fmtNum(d.lugar.posicion)} <small>de ${fmtNum(d.lugar.de)}</small></dd><p>promotores de tu sección</p></div>
      </dl>
    </section>`;

  const responsable = d.responsable
    ? `<section class="card ep-rs" aria-labelledby="epRsT">
        <div><h3 id="epRsT" class="ep-rs__label">Tu Responsable de Sección</h3><strong>${esc(d.responsable.name)}</strong><p>Revisa y aprueba tus promovidos.</p></div>
        ${contacto(d.responsable.name, d.responsable.phone)}
      </section>`
    : '';

  const recientes = `
    <section class="card" aria-labelledby="epReT">
      <header class="dash-card__head"><h3 id="epReT">Capturados recientemente</h3><a class="link-btn" href="/promovidos" data-link>Ver todos</a></header>
      ${
        d.recientes.length
          ? `<ul class="ep-lista">${d.recientes
              .map((r) => {
                const s = ESTADO[r.estatus] || ESTADO.en_revision;
                return `<li><a href="/promovidos/${r.id}" data-link class="ep-item ep-item--fila">
                  <span class="vz-sw" style="background:${s.c}" aria-hidden="true"></span>
                  <span class="ep-item__fila"><strong>${esc(r.nombre)}</strong><span>${s.t} · ${esc(hace(r.at))}</span></span>
                </a></li>`;
              })
              .join('')}</ul>`
          : '<p class="muted">Aún no has capturado promovidos. Toca «Capturar promovido» para empezar.</p>'
      }
    </section>`;

  return `
    <div class="ep">
      ${hero}
      ${porEnviar}
      ${corregir}
      ${resumen}
      <div class="ep-cols">${act}<div class="ep-col">${responsable}${recientes}</div></div>
    </div>`;
}
