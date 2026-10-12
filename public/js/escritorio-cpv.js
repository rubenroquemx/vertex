// Escritorio del Coordinador de Promoción del Voto (CPV).
// Banda de cifras clave · mapa del territorio · zonas con mejor desempeño ·
// promovidos de los últimos 7 días por zona · avance de la estructura por zona.
import { ICONS, $, esc, fmtNum, fmtSeccion, api, homeControl, navigate } from './lib.js';
import { baseMap, seccionesGeo } from './zonas.js';

const DIA = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const DIA_LARGO = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fecha = (key, fmt = DIA) => fmt.format(new Date(`${key}T12:00:00Z`));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const num = (n) => (n === null || n === undefined ? '—' : fmtNum(n));

// Escala "bonita" para el eje Y (0, 5, 10, 20, 25, 50…)
function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => (m * pow * 4) >= v) * pow;
  return step * 4;
}

// ---------------------------------------------------------------------------
// Gráfico de barras apiladas: promovidos por día y por zona
// ---------------------------------------------------------------------------
export function stackedBars(el, { dias, hoy, zonas }) {
  const W = 720;
  const H = 260;
  const m = { top: 24, right: 8, bottom: 30, left: 36 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const totals = dias.map((_, i) => zonas.reduce((t, z) => t + z.serie[i], 0));
  const max = niceMax(Math.max(...totals, 1));
  const band = iw / dias.length;
  const bw = Math.min(44, band * 0.56);
  const y = (v) => m.top + ih - (v / max) * ih;
  const GAP = 2; // separación de 2 px entre segmentos

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
      let acc = 0;
      const segs = zonas.filter((z) => z.serie[i] > 0);
      const rects = segs
        .map((z, k) => {
          const v = z.serie[i];
          const y0 = y(acc);
          const y1 = y(acc + v);
          acc += v;
          const h = Math.max(0, y0 - y1 - (k < segs.length - 1 ? GAP : 0));
          const top = k === segs.length - 1; // solo el extremo superior va redondeado (4 px)
          const r = top ? Math.min(4, h) : 0;
          const yy = y0 - h;
          return `<path d="M${x},${y0} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${y0} Z" fill="${z.color}"/>`;
        })
        .join('');
      const label = totals[i] ? `<text x="${x + bw / 2}" y="${y(totals[i]) - 6}" class="vz-value" text-anchor="middle">${fmtNum(totals[i])}</text>` : '';
      return `<g class="vz-col" data-i="${i}">
        <rect class="vz-hit" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}" />
        ${rects}${label}
        <text x="${x + bw / 2}" y="${H - 8}" class="vz-tick${d === hoy ? ' vz-today' : ''}" text-anchor="middle">${d === hoy ? 'Hoy' : esc(fecha(d))}</text>
      </g>`;
    })
    .join('');

  el.innerHTML = `
    <div class="vz-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="vz-svg" role="img" aria-label="Promovidos por día en los últimos 7 días, por zona">${grid}${bars}</svg>
      <div class="vz-tip" role="tooltip" hidden></div>
    </div>`;

  // Tooltip por día (desglose por zona)
  const wrap = el.querySelector('.vz-wrap');
  const tip = el.querySelector('.vz-tip');
  const svg = el.querySelector('svg');
  const show = (i, evt) => {
    const rows = zonas
      .filter((z) => z.serie[i] > 0)
      .map((z) => `<li><span class="vz-sw" style="background:${z.color}"></span><span>${esc(z.codigo)}</span><strong>${fmtNum(z.serie[i])}</strong></li>`)
      .join('');
    tip.innerHTML = `<p class="vz-tip__title">${esc(fecha(dias[i], DIA_LARGO))}</p>
      ${rows ? `<ul>${rows}</ul>` : '<p class="vz-tip__empty">Sin promovidos</p>'}
      <p class="vz-tip__total">Total <strong>${fmtNum(totals[i])}</strong></p>`;
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const colX = ((m.left + band * (i + 0.5)) / W) * box.width;
    const left = Math.min(Math.max(colX - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, (y(totals[i]) / H) * box.height - tip.offsetHeight - 12)}px`;
    svg.querySelectorAll('.vz-col').forEach((g) => g.classList.toggle('is-dim', Number(g.dataset.i) !== i));
  };
  const hide = () => {
    tip.hidden = true;
    svg.querySelectorAll('.vz-col').forEach((g) => g.classList.remove('is-dim'));
  };
  svg.querySelectorAll('.vz-col').forEach((g) => {
    g.addEventListener('mouseenter', (e) => show(Number(g.dataset.i), e));
    g.addEventListener('mouseleave', hide);
  });
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------
export async function viewEscritorioCPV(route) {
  route.data = null;
  const d = await api('/api/escritorio/cpv');
  route.data = d;
  if (!d.entidad) {
    return `<div class="empty"><span aria-hidden="true">${ICONS.map}</span><strong>Tu cuenta aún no tiene territorio asignado</strong>
      <span>Cuando el administrador te asigne un territorio, aquí verás el avance de tu estructura.</span></div>`;
  }
  const k = d.kpis;
  const t = d.totales;
  const hayPromovidos = k.promovidos > 0;
  const hay7d = d.serie.total.some((v) => v > 0);

  // Desempeño: promovidos (7 días, luego históricos), después cobertura de la estructura
  const ranking = [...d.zonas].sort(
    (a, b) =>
      b.promovidos7d - a.promovidos7d ||
      b.promovidos - a.promovidos ||
      pct(b.seccionesCubiertas, b.secciones) - pct(a.seccionesCubiertas, a.secciones) ||
      b.promotores - a.promotores
  );
  const maxProm = Math.max(1, ...ranking.map((z) => z.promovidos7d));

  const kpi = (label, value, extra = '', action = '') =>
    `<div class="kband__item">${action}<span class="kband__value">${value}</span><span class="kband__label">${label}</span>${extra}</div>`;

  return `
    <section class="kband" aria-label="Cifras principales">
      ${kpi('Zonas creadas', fmtNum(k.zonas))}
      ${k.vacantes ? kpi('Secciones sin asignar', fmtNum(k.vacantes), `<a class="kband__link" href="/zonas/nueva" data-link>Asignar</a>`) : ''}
      ${kpi('Coordinadores de zona', fmtNum(k.coordinadores))}
      ${kpi('Responsables de sección', fmtNum(k.responsables))}
      ${kpi('Promotores territoriales', fmtNum(k.promotores))}
      ${kpi('Promovidos', fmtNum(k.promovidos), k.promovidosHoy ? `<span class="kband__delta">+${fmtNum(k.promovidosHoy)} hoy</span>` : '')}
    </section>

    <div class="dash-grid">
      <section class="card dash-map" aria-labelledby="dMapT">
        <header class="dash-card__head">
          <h3 id="dMapT">Tu territorio</h3>
          <span class="muted">${esc(d.entidad.nombre)} · ${fmtNum(t.secciones)} secciones · ${num(t.electores)} electores</span>
        </header>
        <div class="map dash-map__map" id="dMap"></div>
        <ul class="legend" aria-label="Zonas">
          ${d.zonas.map((z) => `<li><span class="vz-sw" style="background:${z.color}"></span>${esc(z.codigo)}</li>`).join('')}
          ${t.vacantes ? '<li><span class="vz-sw vz-sw--vacant"></span>Sin asignar</li>' : ''}
        </ul>
        <p class="map-card__info" id="dInfo" aria-live="polite"></p>
      </section>

      <section class="card" aria-labelledby="dRankT">
        <header class="dash-card__head">
          <h3 id="dRankT">Zonas con mejor desempeño</h3>
          <span class="muted">Promovidos 7 días</span>
        </header>
        ${
          ranking.length
            ? `<ol class="rank">
                ${ranking
                  .slice(0, 6)
                  .map(
                    (z, i) => `<li class="rank__item">
                      <span class="rank__pos">${i + 1}</span>
                      <div class="rank__body">
                        <div class="rank__top"><span class="vz-sw" style="background:${z.color}"></span><strong>${esc(z.codigo)}</strong><span class="muted rank__name">${esc(z.nombre)}</span><span class="rank__num">${fmtNum(z.promovidos7d)}</span></div>
                        <div class="rank__bar"><span style="width:${(z.promovidos7d / maxProm) * 100}%;background:${z.color}"></span></div>
                        <div class="rank__meta muted">${fmtNum(z.promotores)} promotores · ${pct(z.seccionesCubiertas, z.secciones)}% secciones con responsable</div>
                      </div>
                    </li>`
                  )
                  .join('')}
              </ol>
              ${hayPromovidos ? '' : '<p class="dash-note">Aún no hay promovidos: el orden se basa en el avance de la estructura.</p>'}`
            : `<div class="empty empty--sm"><strong>Aún no tienes zonas</strong><a class="btn btn--sm" href="/zonas/nueva" data-link>${ICONS.plus}<span>Crear zona</span></a></div>`
        }
      </section>

      <section class="card dash-wide" aria-labelledby="dChartT">
        <header class="dash-card__head">
          <h3 id="dChartT">Promovidos de los últimos 7 días</h3>
          <span class="muted">Por día y por zona</span>
        </header>
        ${
          hay7d
            ? `<ul class="legend legend--top" aria-label="Zonas">${d.zonas
                .filter((z) => z.promovidos7d)
                .map((z) => `<li><span class="vz-sw" style="background:${z.color}"></span>${esc(z.codigo)}</li>`)
                .join('')}</ul>
              <div id="dChart"></div>
              <details class="vz-table">
                <summary>Ver como tabla</summary>
                <div class="table-wrap"><table class="table">
                  <thead><tr><th scope="col">Zona</th>${d.serie.dias.map((x) => `<th scope="col" class="num">${esc(fecha(x))}</th>`).join('')}<th scope="col" class="num">Total</th></tr></thead>
                  <tbody>${d.zonas
                    .map((z) => `<tr><td>${esc(z.codigo)}</td>${z.serie.map((v) => `<td class="num num--r">${fmtNum(v)}</td>`).join('')}<td class="num num--r"><strong>${fmtNum(z.promovidos7d)}</strong></td></tr>`)
                    .join('')}</tbody>
                </table></div>
              </details>`
            : `<div class="empty empty--chart"><span aria-hidden="true">${ICONS.users}</span><strong>Sin promovidos en los últimos 7 días</strong>
                <span>Cuando los Promotores Territoriales capturen promovidos, aquí verás el avance diario de cada zona.</span></div>`
        }
      </section>

      <section class="card" aria-labelledby="dStructT">
        <header class="dash-card__head">
          <h3 id="dStructT">Avance de la estructura</h3>
          <span class="muted">Secciones con responsable</span>
        </header>
        ${
          d.zonas.length
            ? `<ul class="hbars">${d.zonas
                .map((z) => {
                  const p = pct(z.seccionesCubiertas, z.secciones);
                  return `<li>
                    <div class="hbars__top"><span class="vz-sw" style="background:${z.color}"></span><span>${esc(z.codigo)}</span><strong>${p}%</strong></div>
                    <div class="hbars__track" role="img" aria-label="${esc(z.codigo)}: ${p}% de secciones con responsable"><span style="width:${p}%"></span></div>
                    <div class="muted hbars__meta">${fmtNum(z.seccionesCubiertas)} de ${fmtNum(z.secciones)} secciones · ${fmtNum(z.responsables)} responsables</div>
                  </li>`;
                })
                .join('')}</ul>`
            : '<p class="dash-note">Crea zonas para ver el avance de tu estructura.</p>'
        }
        <div class="cover">
          <div class="cover__row"><span>Territorio repartido en zonas</span><strong>${pct(t.asignadas, t.secciones)}%</strong></div>
          <div class="hbars__track"><span style="width:${pct(t.asignadas, t.secciones)}%"></span></div>
          <div class="muted hbars__meta">${fmtNum(t.asignadas)} de ${fmtNum(t.secciones)} secciones · ${num(t.electoresAsignados)} de ${num(t.electores)} electores</div>
        </div>
      </section>
    </div>`;
}

export function mountEscritorioCPV(root, route) {
  const d = route.data;
  if (!d?.entidad) return undefined;

  if (d.serie.total.some((v) => v > 0)) {
    stackedBars($('#dChart', root), { dias: d.serie.dias, hoy: d.serie.hoy, zonas: d.zonas.filter((z) => z.promovidos7d) });
  }

  // Mapa: secciones del territorio coloreadas por zona; las vacantes en gris
  const info = $('#dInfo', root);
  const { map, destroy } = baseMap($('#dMap', root));
  let bounds = null;
  homeControl(() => bounds && map.fitBounds(bounds, { padding: [12, 12] })).addTo(map);
  const zonaById = new Map(d.zonas.map((z) => [z.id, z]));
  const bySec = new Map(d.secciones.map((s) => [s.c, s]));
  const resumen = `${fmtNum(d.totales.asignadas)} de ${fmtNum(d.totales.secciones)} secciones en zonas`;
  info.textContent = 'Cargando mapa…';
  (async () => {
    try {
      const fc = await seccionesGeo(d.entidad.clave, d.secciones.map((s) => s.c));
      const layer = L.geoJSON(fc, {
        style: (f) => {
          const z = zonaById.get(bySec.get(f.properties.seccion)?.z);
          return z
            ? { color: z.color, weight: 0.6, opacity: 1, fillColor: z.color, fillOpacity: 0.55 }
            : { color: '#3f3f46', weight: 0.6, opacity: 0.8, fillColor: '#71717a', fillOpacity: 0.28 };
        },
        onEachFeature(f, l) {
          const s = bySec.get(f.properties.seccion);
          const z = zonaById.get(s?.z);
          const label = `Sección ${fmtSeccion(f.properties.seccion)} · ${z ? `${z.codigo} ${z.nombre}` : 'Sin asignar'}${s?.e !== null && s?.e !== undefined ? ` · ${fmtNum(s.e)} electores` : ''}`;
          l.bindTooltip(esc(label), { sticky: true, direction: 'top', className: 'map-tip' });
          l.on({
            mouseover: () => {
              l.setStyle({ weight: 2 });
              info.textContent = label;
            },
            mouseout: () => {
              l.setStyle({ weight: 0.6 });
              info.textContent = resumen;
            },
            click: () => z && navigate('/zonas'),
          });
        },
      }).addTo(map);
      bounds = layer.getBounds();
      map.fitBounds(bounds, { padding: [12, 12] });
      info.textContent = resumen;
    } catch (err) {
      info.textContent = `No se pudo cargar el mapa: ${err.message}`;
    }
  })();
  return destroy;
}
