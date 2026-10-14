// Panel del Super administrador: visión de todo el sistema con cifras agregadas.
// Avance global · captura de los últimos 30 días · estatus de revisión · cada CPV ·
// material electoral · actividad reciente · salud del sistema.
import { ICONS, $, esc, fmtNum, fmtDateTime, api } from './lib.js';
import { botonInforme } from './informe.js';

const pct = (a, b) => (b ? (a / b) * 100 : 0);
const pctTxt = (a, b) => {
  if (!b) return '—';
  const p = pct(a, b);
  return `${p > 0 && p < 1 ? p.toFixed(1) : fmtNum(Math.round(p))}%`;
};
const DIA = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DIA_LARGO = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fecha = (key, fmt = DIA) => fmt.format(new Date(`${key}T12:00:00Z`));

function hace(iso) {
  if (!iso) return 'Sin capturas';
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'Hace un momento';
  if (s < 3600) return `Hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `Hace ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'día' : 'días'}`;
  return fmtDateTime(iso);
}

// Estatus de revisión: colores del semáforo de la app, siempre con su etiqueta
const ESTATUS = [
  { k: 'aprobados', t: 'Aprobados', c: '#16a34a' },
  { k: 'revision', t: 'En revisión', c: '#f59e0b' },
  { k: 'observaciones', t: 'Con observaciones', c: '#dc2626' },
  { k: 'rechazados', t: 'Rechazados', c: '#4a3aa7' },
];

// Medidor horizontal (avance contra meta)
const medidor = (label, valor, meta, extra = '') => `
  <div class="sa-meter">
    <div class="sa-meter__top"><span>${label}</span><strong>${fmtNum(valor)}${meta ? `<small> de ${fmtNum(meta)}</small>` : ''}</strong></div>
    <div class="sa-meter__bar" role="img" aria-label="${esc(label)}: ${pctTxt(valor, meta)}"><span style="width:${Math.min(100, pct(valor, meta))}%"></span></div>
    <div class="sa-meter__pie"><span>${pctTxt(valor, meta)}</span>${extra}</div>
  </div>`;

// Mini serie (30 días) dentro de la tarjeta de cada CPV
function sparkline(serie) {
  const W = 120;
  const H = 32;
  const max = Math.max(...serie, 1);
  const x = (i) => (i / (serie.length - 1)) * W;
  const y = (v) => H - 2 - (v / max) * (H - 4);
  const d = serie.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="sa-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ---------------------------------------------------------------------------
// Gráfico: promovidos por día (30 días), una sola serie
// ---------------------------------------------------------------------------
// `referencia`: línea punteada opcional (p. ej. el ritmo diario necesario para la meta).
// Para otros periodos (informes): `ultimo` = etiqueta de la última barra (null = su fecha), `unidad` = 'día' | 'semana'.
export function barras30(el, { dias, total }, { referencia = null, color = '#2a78d6', ultimo = 'Hoy', unidad = 'día', aria = 'Promovidos capturados por día en los últimos 30 días' } = {}) {
  const W = 720;
  const H = 240;
  const m = { top: 20, right: 8, bottom: 28, left: 44 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = (() => {
    const v = Math.max(...total, referencia?.valor || 0, 1);
    // 4 divisiones con paso «bonito» (1, 1.5, 2, 2.5, 3, 4 o 5 × potencia de 10)
    const pow = 10 ** Math.floor(Math.log10(v / 4));
    return [1, 1.5, 2, 2.5, 3, 4, 5, 10].find((k) => k * pow * 4 >= v) * pow * 4;
  })();
  const band = iw / dias.length;
  const bw = Math.max(4, band * 0.62);
  const y = (v) => m.top + ih - (v / max) * ih;
  const hoy = dias.length - 1;
  const resaltar = ultimo !== null;
  // Etiquetas del eje: una por semana (o cada varias semanas en periodos largos) y la última
  const paso = unidad === 'semana' ? Math.max(1, Math.ceil(dias.length / 8)) : 7 * Math.max(1, Math.ceil(dias.length / 35));
  const grid = [0, 1, 2, 3, 4]
    .map((k) => {
      const v = (max / 4) * k;
      return `<line x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}" class="vz-grid${k === 0 ? ' vz-base' : ''}"/>
        <text x="${m.left - 8}" y="${y(v)}" class="vz-tick" text-anchor="end" dominant-baseline="middle">${fmtNum(v)}</text>`;
    })
    .join('');
  const bars = dias
    .map((d, i) => {
      const x = m.left + band * i + (band - bw) / 2;
      const v = total[i];
      const yy = y(v);
      const h = m.top + ih - yy;
      const r = Math.min(4, h);
      const path = v
        ? `<path d="M${x},${m.top + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${m.top + ih} Z" class="sa-bar${resaltar && i === hoy ? ' is-hoy' : ''}"/>`
        : '';
      const tick = i === hoy && resaltar ? esc(ultimo) : (hoy - i) % paso === 0 ? esc(fecha(d)) : '';
      return `<g class="vz-col" data-i="${i}">
        <rect class="vz-hit" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}"/>${path}
        ${tick ? `<text x="${x + bw / 2}" y="${H - 8}" class="vz-tick${resaltar && i === hoy ? ' vz-today' : ''}" text-anchor="middle">${tick}</text>` : ''}
      </g>`;
    })
    .join('');
  const ref = referencia
    ? `<line x1="${m.left}" x2="${W - m.right}" y1="${y(referencia.valor)}" y2="${y(referencia.valor)}" class="sa-ref"/>
       <text x="${m.left + 6}" y="${y(referencia.valor) - 6}" class="sa-ref__txt">${esc(referencia.etiqueta)}</text>`
    : '';
  // Valor directo solo en hoy (no en cada barra)
  const lbl = resaltar && total[hoy] ? `<text x="${m.left + band * hoy + band / 2}" y="${y(total[hoy]) - 6}" class="vz-value" text-anchor="end">${fmtNum(total[hoy])}</text>` : '';
  el.innerHTML = `<div class="vz-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="vz-svg" role="img" aria-label="${esc(aria)}" style="--bar:${color}">${grid}${bars}${ref}${lbl}</svg>
      <div class="vz-tip" role="tooltip" hidden></div>
    </div>`;
  const wrap = el.querySelector('.vz-wrap');
  const tip = el.querySelector('.vz-tip');
  const svg = el.querySelector('svg');
  const cols = svg.querySelectorAll('.vz-col');
  const show = (i) => {
    const prev = i ? total[i - 1] : null;
    const delta = prev ? Math.round(pct(total[i] - prev, prev)) : null;
    tip.innerHTML = `<p class="vz-tip__title">${unidad === 'semana' ? 'Semana del ' : ''}${esc(fecha(dias[i], DIA_LARGO))}</p>
      <p class="vz-tip__total">Promovidos <strong>${fmtNum(total[i])}</strong></p>
      ${delta !== null ? `<p class="vz-tip__empty">${delta >= 0 ? '+' : ''}${delta}% contra ${unidad === 'semana' ? 'la semana anterior' : 'el día anterior'}</p>` : ''}`;
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const colX = ((m.left + band * (i + 0.5)) / W) * box.width;
    tip.style.left = `${Math.min(Math.max(colX - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth)}px`;
    tip.style.top = `${Math.max(0, (y(total[i]) / H) * box.height - tip.offsetHeight - 12)}px`;
    cols.forEach((g) => g.classList.toggle('is-dim', Number(g.dataset.i) !== i));
  };
  const hide = () => {
    tip.hidden = true;
    cols.forEach((g) => g.classList.remove('is-dim'));
  };
  cols.forEach((g) => {
    g.addEventListener('mouseenter', () => show(Number(g.dataset.i)));
    g.addEventListener('mouseleave', hide);
    g.addEventListener('touchstart', () => show(Number(g.dataset.i)), { passive: true });
  });
  svg.addEventListener('touchend', () => setTimeout(hide, 1800), { passive: true });
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------
export async function viewPanelSA(route) {
  const [d, partidos] = await Promise.all([api('/api/panel/sa'), api('/api/catalogos/partidos').catch(() => [])]);
  route.data = d;
  const t = d.totales;
  const colorPartido = new Map(partidos.map((p) => [p.key, p]));
  const semanaDelta = t.semanaAnterior ? Math.round(pct(t.semana - t.semanaAnterior, t.semanaAnterior)) : null;
  const est = t.estatus;
  const totalEst = ESTATUS.reduce((s, e) => s + est[e.k], 0);

  const hero = `
    <section class="sa-hero" aria-label="Avance global">
      <div class="sa-hero__main">
        <p class="sa-hero__label">Promovidos en todo el sistema</p>
        <p class="sa-hero__value">${fmtNum(t.promovidos)}<span> de ${fmtNum(t.meta)}</span></p>
        <div class="sa-hero__bar" role="img" aria-label="Avance de la meta global: ${pctTxt(t.promovidos, t.meta)}"><span style="width:${Math.min(100, pct(t.promovidos, t.meta))}%"></span></div>
        <p class="sa-hero__pie"><strong>${pctTxt(t.promovidos, t.meta)}</strong> de la meta global de ${fmtNum(t.cpvs)} ${t.cpvs === 1 ? 'Coordinador de Promoción del Voto' : 'Coordinadores de Promoción del Voto'}</p>
      </div>
      <dl class="sa-hero__side">
        <div><dt>Últimos 7 días</dt><dd>${fmtNum(t.semana)}${
          semanaDelta !== null ? `<span class="sa-delta">${semanaDelta >= 0 ? '▲' : '▼'} ${Math.abs(semanaDelta)}% vs. semana anterior</span>` : ''
        }</dd></div>
        <div><dt>Hoy</dt><dd>${fmtNum(t.hoy)}</dd></div>
      </dl>
    </section>`;

  const kpi = (label, valor, sub = '') => `<div class="sa-kpi"><dt>${label}</dt><dd>${valor}</dd>${sub ? `<p>${sub}</p>` : ''}</div>`;
  const kpis = `
    <dl class="sa-kpis">
      ${kpi('CPV', fmtNum(t.cpvs))}
      ${kpi('Coordinadores de Zona', fmtNum(t.zonas))}
      ${kpi('Responsables de Sección', fmtNum(t.responsables), `${pctTxt(t.seccionesCubiertas, t.secciones)} de ${fmtNum(t.secciones)} secciones cubiertas`)}
      ${kpi('Promotores Territoriales', fmtNum(t.promotores), `${pctTxt(t.promotores, t.promotoresMeta)} de ${fmtNum(t.promotoresMeta)} requeridos`)}
      ${kpi('Usuarios activos', fmtNum(d.sistema.sesionesActivas), `${fmtNum(d.sistema.accesos7d)} entraron en 7 días`)}
    </dl>`;

  const grafica = `
    <section class="card sa-card sa-chart">
      <div class="sa-card__head"><h3>Promovidos capturados por día</h3><span class="muted">Últimos 30 días</span></div>
      <div id="saChart"></div>
      <details class="vz-table"><summary>Ver como tabla</summary>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Día</th><th scope="col" class="num">Promovidos</th></tr></thead>
        <tbody>${d.serie.dias
          .map((x, i) => `<tr><td>${esc(fecha(x, DIA_LARGO))}</td><td class="num">${fmtNum(d.serie.total[i])}</td></tr>`)
          .reverse()
          .join('')}</tbody></table></div>
      </details>
    </section>`;

  const estatus = `
    <section class="card sa-card">
      <div class="sa-card__head"><h3>Estatus de revisión</h3><span class="muted">${fmtNum(totalEst)} promovidos</span></div>
      <div class="sa-stack" role="img" aria-label="${ESTATUS.map((e) => `${e.t}: ${fmtNum(est[e.k])}`).join(', ')}">
        ${ESTATUS.filter((e) => est[e.k]).map((e) => `<span style="flex:${est[e.k]};background:${e.c}" title="${e.t}: ${fmtNum(est[e.k])}"></span>`).join('')}
      </div>
      <ul class="sa-leyenda">
        ${ESTATUS.map(
          (e) => `<li><span class="vz-sw" style="background:${e.c}"></span><span>${e.t}</span><strong>${fmtNum(est[e.k])}</strong><small>${pctTxt(est[e.k], totalEst)}</small></li>`
        ).join('')}
      </ul>
      <p class="sa-nota">Los aprueba el Responsable de Sección de cada promotor.</p>
    </section>`;

  const tarjetasCPV = d.cpvs
    .map((c) => {
      const terr = c.territorio ? `${c.territorio.tipo} ${c.territorio.nombre.replace(/^\D+/, '')} · ${c.territorio.entidad}` : 'Sin territorio';
      const chips = c.partidos
        .map((k) => {
          const p = colorPartido.get(k);
          return `<span class="sa-partido"><span class="vz-sw" style="background:${p?.color || '#a3a3a3'}"></span>${esc(k === 'OTRO' ? 'Otro' : p?.name || k)}</span>`;
        })
        .join('');
      const mat = c.material;
      return `<article class="card sa-cpv">
        <header class="sa-cpv__head">
          <div><h4>${esc(c.name)}</h4><p>${c.candidato ? `${esc(c.candidato)} · ` : ''}${esc(terr)}</p></div>
          <a class="icon-btn" href="/usuarios/${c.id}" data-link title="Ver ficha de ${esc(c.name)}" aria-label="Ver ficha de ${esc(c.name)}">${ICONS.eye}</a>
        </header>
        ${chips ? `<div class="sa-partidos">${chips}</div>` : ''}
        ${medidor('Promovidos', c.promovidos, c.meta)}
        ${medidor('Promotores Territoriales', c.promotores, c.promotoresMeta)}
        ${medidor('Secciones con responsable', c.seccionesCubiertas, c.secciones, `<span>${fmtNum(c.zonas)} ${c.zonas === 1 ? 'zona' : 'zonas'}</span>`)}
        <footer class="sa-cpv__pie">
          <div><span class="muted">Material con evidencia</span><strong>${mat.ordenes ? `${fmtNum(mat.conEvidencia)} de ${fmtNum(mat.ordenes)} órdenes` : 'Sin órdenes'}</strong></div>
          <div class="sa-cpv__spark"><span class="muted">Última captura · ${esc(hace(c.ultimaCaptura))}</span>${sparkline(c.serie)}</div>
        </footer>
      </article>`;
    })
    .join('');

  const m = d.material;
  const material = `
    <section class="card sa-card">
      <div class="sa-card__head"><h3>${ICONS.box} Material electoral</h3></div>
      <dl class="sa-lista">
        <div><dt>Unidades en inventario</dt><dd>${fmtNum(m.inventario)}</dd></div>
        <div><dt>Entregadas a zonas</dt><dd>${fmtNum(m.unidadesZonas)} <small>${pctTxt(m.unidadesZonas, m.inventario)}</small></dd></div>
        <div><dt>Órdenes a Responsables</dt><dd>${fmtNum(m.ordenes)}</dd></div>
        <div><dt>Con evidencia</dt><dd><span class="vz-sw" style="background:#16a34a"></span>${fmtNum(m.conEvidencia)} <small>${pctTxt(m.conEvidencia, m.ordenes)}</small></dd></div>
        <div><dt>Falta evidencia</dt><dd><span class="vz-sw" style="background:#dc2626"></span>${fmtNum(m.sinEvidencia)}</dd></div>
        <div><dt>Por recibir</dt><dd><span class="vz-sw" style="background:#f59e0b"></span>${fmtNum(m.pendientes)}</dd></div>
        <div><dt>Fotos de evidencia</dt><dd>${fmtNum(m.fotos)}</dd></div>
      </dl>
    </section>`;

  const actividad = `
    <section class="card sa-card">
      <div class="sa-card__head"><h3>Actividad reciente</h3></div>
      ${
        d.actividad.length
          ? `<ol class="sa-feed">${d.actividad
              .map(
                (a) => `<li><p><strong>${esc(a.quien)}</strong> ${esc(a.texto)}${a.como ? ` <span class="muted">como ${esc(a.como)}</span>` : ''}</p><time datetime="${a.at}">${esc(hace(a.at))}</time></li>`
              )
              .join('')}</ol>`
          : '<p class="muted">Sin actividad todavía.</p>'
      }
    </section>`;

  const s = d.sistema;
  const ok = (v, si, no) => `<span class="sa-ok ${v ? 'is-ok' : 'is-no'}">${v ? si : no}</span>`;
  const sistema = `
    <section class="card sa-card">
      <div class="sa-card__head"><h3>Sistema</h3></div>
      <dl class="sa-lista">
        <div><dt>Cuentas registradas</dt><dd>${fmtNum(s.usuarios)}</dd></div>
        <div><dt>Sesiones activas</dt><dd>${fmtNum(s.sesionesActivas)}</dd></div>
        <div><dt>Accesos en 7 días</dt><dd>${fmtNum(s.accesos7d)}</dd></div>
        <div><dt>Entidades con padrón</dt><dd>${fmtNum(s.entidadesPadron)}</dd></div>
        <div><dt>WhatsApp (recuperación)</dt><dd>${ok(s.whatsapp, 'Activo', 'Sin configurar')}</dd></div>
      </dl>
      <div class="sa-links">
        <a href="/bases-de-datos" data-link>${ICONS.database}<span>Bases de datos</span></a>
        <a href="/configuracion" data-link>${ICONS.settings}<span>Configuración</span></a>
      </div>
    </section>`;

  return `
    <div class="sa">
      ${botonInforme()}
      ${hero}
      ${kpis}
      <div class="sa-row sa-row--chart">${grafica}${estatus}</div>
      <section class="sa-cpvs" aria-labelledby="saCpvs">
        <div class="sa-sec-head"><h3 class="promo-grupo__titulo" id="saCpvs">Coordinadores de Promoción del Voto</h3><a class="link-btn" href="/usuarios" data-link>Ver todos</a></div>
        <div class="sa-cpv-grid">${tarjetasCPV || '<p class="muted">Aún no hay CPV registrados.</p>'}</div>
      </section>
      <div class="sa-row sa-row--3">${material}${actividad}${sistema}</div>
    </div>`;
}

export function mountPanelSA(root, route) {
  barras30($('#saChart', root), route.data.serie);
}
