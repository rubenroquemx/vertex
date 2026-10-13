// Escritorio del Coordinador de Promoción del Voto (CPV).
// Meta y ritmo · cifras de la estructura · mapa de avance por sección · pendientes que requieren
// atención · captura de 30 días contra el ritmo necesario · revisión · zonas · responsables · material.
import { ICONS, $, esc, fmtNum, fmtSeccion, api, homeControl, navigate } from './lib.js';
import { baseMap, seccionesGeo } from './zonas.js';
import { barras30 } from './panel-sa.js';

export const pct = (a, b) => (b ? (a / b) * 100 : 0);
export const pctTxt = (a, b) => {
  if (!b) return '—';
  const p = pct(a, b);
  return `${p > 0 && p < 1 ? p.toFixed(1) : fmtNum(Math.round(p))}%`;
};
export const FECHA = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

// Avance por sección (mapa): una sola tonalidad, de claro (poco) a oscuro (mucho)
export const RANGOS = [
  { hasta: 0.1, color: '#cde2fb', t: 'Menos de 10%' },
  { hasta: 0.25, color: '#9ec5f4', t: '10% a 24%' },
  { hasta: 0.5, color: '#5598e7', t: '25% a 49%' },
  { hasta: 0.75, color: '#2a78d6', t: '50% a 74%' },
  { hasta: Infinity, color: '#184f95', t: '75% o más' },
];
export const colorAvance = (v) => RANGOS.find((r) => v < r.hasta).color;
export const SIN_RS = '#d4d4d4';

export const ESTATUS = [
  { k: 'aprobados', t: 'Aprobados', c: '#16a34a' },
  { k: 'revision', t: 'En revisión', c: '#f59e0b' },
  { k: 'observaciones', t: 'Con observaciones', c: '#dc2626' },
  { k: 'rechazados', t: 'Rechazados', c: '#4a3aa7' },
];

export const barra = (valor, meta, color = 'var(--color-foreground)') =>
  `<span class="ec-bar" role="img" aria-label="${pctTxt(valor, meta)}"><span style="width:${Math.min(100, pct(valor, meta))}%;background:${color}"></span></span>`;

export function sparkline(serie, color) {
  const W = 96;
  const H = 26;
  const max = Math.max(...serie, 1);
  const d = serie.map((v, i) => `${i ? 'L' : 'M'}${((i / (serie.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join(' ');
  return `<svg class="ec-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" style="stroke:${color}"/></svg>`;
}

// Pendientes que requieren atención, de lo más urgente a lo menos
function alertas(d) {
  const k = d.kpis;
  const out = [];
  const add = (nivel, titulo, texto, href) => out.push({ nivel, titulo, texto, href });
  const vacantes = k.secciones - k.seccionesCubiertas;
  if (d.ritmo.faltan && d.ritmo.promedio7d < d.ritmo.necesario)
    add('alta', 'Ritmo por debajo de la meta', `Capturan ${fmtNum(d.ritmo.promedio7d)} al día; se necesitan ${fmtNum(d.ritmo.necesario)} para llegar a tiempo.`, null);
  if (d.estatus.viejos) add('alta', `${fmtNum(d.estatus.viejos)} promovidos esperan revisión hace más de 3 días`, 'Los Responsables de Sección deben aprobarlos o dejar observaciones.', null);
  if (vacantes) add('media', `${fmtNum(vacantes)} ${vacantes === 1 ? 'sección sin' : 'secciones sin'} Responsable de Sección`, `Cobertura actual: ${pctTxt(k.seccionesCubiertas, k.secciones)} de tus secciones.`, '/zonas');
  if (d.totales.vacantes) add('media', `${fmtNum(d.totales.vacantes)} secciones sin zona`, 'Asígnalas a un Coordinador de Zona.', '/zonas/nueva');
  if (k.promotores < k.promotoresMeta * 0.5)
    add('media', 'Faltan Promotores Territoriales', `Tienes ${fmtNum(k.promotores)} de ${fmtNum(k.promotoresMeta)} requeridos (${pctTxt(k.promotores, k.promotoresMeta)}).`, null);
  if (d.estatus.observaciones) add('baja', `${fmtNum(d.estatus.observaciones)} promovidos con observaciones`, 'Esperan corrección de su Promotor Territorial.', null);
  if (d.material.sinEvidencia) add('baja', `${fmtNum(d.material.sinEvidencia)} órdenes de material sin evidencia`, 'Responsables que recibieron material y no han subido sus fotos.', '/material');
  if (d.material.porRecibirZonas) add('baja', `${fmtNum(d.material.porRecibirZonas)} ${d.material.porRecibirZonas === 1 ? 'orden' : 'órdenes'} de material por recibir`, 'Tus Coordinadores de Zona aún no confirman la recepción.', '/material');
  return out;
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
  const r = d.ritmo;
  const enRitmo = !r.faltan || r.promedio7d >= r.necesario;
  const semanaDelta = k.semanaAnterior ? Math.round(pct(k.semana - k.semanaAnterior, k.semanaAnterior)) : null;
  const est = d.estatus;
  const totalEst = ESTATUS.reduce((t, e) => t + est[e.k], 0);
  const avisos = alertas(d);

  const hero = `
    <section class="ec-hero" aria-label="Meta de promovidos">
      <div>
        <p class="ec-hero__label">Promovidos de tu estructura</p>
        <p class="ec-hero__value">${fmtNum(k.promovidos)}<span> de ${fmtNum(k.meta)}</span></p>
        <div class="ec-hero__bar" role="img" aria-label="Avance de la meta: ${pctTxt(k.promovidos, k.meta)}"><span style="width:${Math.min(100, pct(k.promovidos, k.meta))}%"></span></div>
        <p class="ec-hero__pie"><strong>${pctTxt(k.promovidos, k.meta)}</strong> de la meta · faltan ${fmtNum(r.faltan)} · ${fmtNum(d.eleccion.dias)} días para la elección</p>
      </div>
      <dl class="ec-hero__ritmo">
        <div><dt>Ritmo actual</dt><dd>${fmtNum(r.promedio7d)}<small>/día</small></dd><p>Promedio de los últimos 7 días${semanaDelta !== null ? ` · ${semanaDelta >= 0 ? '▲' : '▼'} ${Math.abs(semanaDelta)}% vs. semana anterior` : ''}</p></div>
        <div><dt>Ritmo necesario</dt><dd>${fmtNum(r.necesario)}<small>/día</small></dd><p>Para completar la meta antes de la elección</p></div>
        <div class="ec-hero__estado ${enRitmo ? 'is-ok' : 'is-bajo'}">
          <span aria-hidden="true">${enRitmo ? '✓' : '!'}</span>
          <p>${
            !r.faltan
              ? 'Meta alcanzada.'
              : enRitmo
                ? `A este ritmo llegas a la meta el <strong>${esc(FECHA.format(new Date(r.proyeccion)))}</strong>.`
                : `A este ritmo no llegas a tiempo${r.proyeccion ? ` (lo harías el ${esc(FECHA.format(new Date(r.proyeccion)))})` : ''}.`
          }</p>
        </div>
      </dl>
    </section>`;

  const kpi = (label, valor, meta, sub, href) => `
    <${href ? `a href="${href}" data-link` : 'div'} class="ec-kpi">
      <span class="ec-kpi__label">${label}</span>
      <span class="ec-kpi__valor">${valor}</span>
      ${meta !== null ? barra(meta[0], meta[1]) : ''}
      <span class="ec-kpi__sub">${sub}</span>
    </${href ? 'a' : 'div'}>`;
  const kpis = `
    <div class="ec-kpis">
      ${kpi('Secciones con responsable', fmtNum(k.seccionesCubiertas), [k.seccionesCubiertas, k.secciones], `${pctTxt(k.seccionesCubiertas, k.secciones)} de ${fmtNum(k.secciones)} secciones`, '/zonas')}
      ${kpi('Promotores Territoriales', fmtNum(k.promotores), [k.promotores, k.promotoresMeta], `${pctTxt(k.promotores, k.promotoresMeta)} de ${fmtNum(k.promotoresMeta)} requeridos`)}
      ${kpi('Aprobados', fmtNum(est.aprobados), [est.aprobados, totalEst], `${pctTxt(est.aprobados, totalEst)} de lo capturado`)}
      ${kpi('Por revisar', fmtNum(est.revision + est.observaciones), null, `${fmtNum(est.viejos)} con más de 3 días`)}
      ${kpi('Material con evidencia', fmtNum(d.material.conEvidencia), [d.material.conEvidencia, d.material.ordenes], `de ${fmtNum(d.material.ordenes)} órdenes a responsables`, '/material')}
    </div>`;

  const mapa = `
    <section class="card ec-mapa" aria-labelledby="ecMapT">
      <header class="dash-card__head">
        <h3 id="ecMapT">Avance por sección</h3>
        <div class="seg" role="group" aria-label="Colorear el mapa por">
          <button type="button" class="seg__btn is-on" data-modo="avance" aria-pressed="true">Avance</button>
          <button type="button" class="seg__btn" data-modo="zona" aria-pressed="false">Zonas</button>
        </div>
      </header>
      <div class="map ec-mapa__map" id="dMap"></div>
      <ul class="legend" id="ecLeyenda"></ul>
      <p class="map-card__info" id="dInfo" aria-live="polite"></p>
    </section>`;

  const atencion = `
    <section class="card ec-atencion" aria-labelledby="ecAtT">
      <header class="dash-card__head"><h3 id="ecAtT">Requiere tu atención</h3><span class="muted">${fmtNum(avisos.length)}</span></header>
      ${
        avisos.length
          ? `<ul class="ec-avisos">${avisos
              .map(
                (a) => `<li class="ec-aviso is-${a.nivel}">
                  <span class="ec-aviso__punto" aria-hidden="true"></span>
                  <div><strong>${a.titulo}</strong><p>${a.texto}</p>${a.href ? `<a href="${a.href}" data-link>Ir</a>` : ''}</div>
                  <span class="sr-only">Prioridad ${a.nivel}</span>
                </li>`
              )
              .join('')}</ul>`
          : '<p class="muted">Todo en orden por ahora.</p>'
      }
    </section>`;

  const grafica = `
    <section class="card" aria-labelledby="ecChT">
      <header class="dash-card__head"><h3 id="ecChT">Promovidos capturados por día</h3><span class="muted">Últimos 30 días · la línea es el ritmo necesario</span></header>
      <div id="dChart"></div>
      <details class="vz-table"><summary>Ver como tabla</summary>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Día</th><th scope="col" class="num">Promovidos</th></tr></thead>
        <tbody>${d.serie.dias.map((x, i) => `<tr><td>${esc(x)}</td><td class="num">${fmtNum(d.serie.total[i])}</td></tr>`).reverse().join('')}</tbody></table></div>
      </details>
    </section>`;

  const estatus = `
    <section class="card" aria-labelledby="ecEsT">
      <header class="dash-card__head"><h3 id="ecEsT">Revisión de promovidos</h3><span class="muted">${fmtNum(totalEst)}</span></header>
      <div class="sa-stack" role="img" aria-label="${ESTATUS.map((e) => `${e.t}: ${fmtNum(est[e.k])}`).join(', ')}">
        ${ESTATUS.filter((e) => est[e.k]).map((e) => `<span style="flex:${est[e.k]};background:${e.c}" title="${e.t}: ${fmtNum(est[e.k])}"></span>`).join('')}
      </div>
      <ul class="sa-leyenda">${ESTATUS.map(
        (e) => `<li><span class="vz-sw" style="background:${e.c}"></span><span>${e.t}</span><strong>${fmtNum(est[e.k])}</strong><small>${pctTxt(est[e.k], totalEst)}</small></li>`
      ).join('')}</ul>
      <p class="sa-nota">Cada Responsable de Sección aprueba los promovidos de sus promotores.</p>
    </section>`;

  // Celda de avance: cifra y %, barra y la meta debajo
  const celda = (v, meta, color) =>
    `<td><div class="ec-celda"><strong>${fmtNum(v)}</strong><span class="ec-celda__p">${pctTxt(v, meta)}</span></div>${barra(v, meta, color)}<small class="ec-celda__meta">de ${fmtNum(meta)}</small></td>`;
  const zonasOrden = [...d.zonas].sort((a, b) => pct(b.promovidos, b.meta) - pct(a.promovidos, a.meta));
  const tablaZonas = `
    <section class="card" aria-labelledby="ecZT">
      <header class="dash-card__head"><h3 id="ecZT">Zonas</h3><a class="link-btn" href="/zonas" data-link>Administrar zonas</a></header>
      ${
        zonasOrden.length
          ? `<div class="table-wrap"><table class="table ec-zonas table--cards">
          <thead><tr><th scope="col">Zona</th><th scope="col">Promovidos</th><th scope="col">Promotores</th><th scope="col">Secciones cubiertas</th><th scope="col" class="num">Por revisar</th><th scope="col" class="num">Material</th><th scope="col">30 días</th></tr></thead>
          <tbody>${zonasOrden
            .map(
              (z) => `<tr>
                <th scope="row"><span class="ec-zona"><span class="vz-sw" style="background:${z.color}"></span><span><strong>${esc(z.codigo)}</strong><small>${esc(z.nombre)} · ${esc(z.coordinador)}</small></span></span></th>
                ${celda(z.promovidos, z.meta, z.color)}
                ${celda(z.promotores, z.promotoresMeta, z.color)}
                ${celda(z.seccionesCubiertas, z.secciones, z.color)}
                <td class="num">${fmtNum(z.porRevisar)}</td>
                <td class="num">${z.material.ordenes ? `${fmtNum(z.material.conEvidencia)} <small class="muted">de ${fmtNum(z.material.ordenes)}</small>` : '—'}</td>
                <td>${sparkline(z.serie, z.color)}</td>
              </tr>`
            )
            .join('')}</tbody></table></div>`
          : `<div class="empty empty--sm"><strong>Aún no tienes zonas</strong><a class="btn btn--sm" href="/zonas/nueva" data-link>${ICONS.plus}<span>Crear zona</span></a></div>`
      }
    </section>`;

  const listaRS = (lista) =>
    lista.length
      ? `<ol class="ec-rs">${lista
          .map(
            (x) => `<li>
              <div class="ec-rs__top"><span class="vz-sw" style="background:${x.color}"></span><strong>${esc(x.name)}</strong><span class="ec-rs__p">${pctTxt(x.promovidos, x.meta)}</span></div>
              ${barra(x.promovidos, x.meta, x.color)}
              <p>Sección ${fmtSeccion(x.seccion)} · ${esc(x.zona)} · ${fmtNum(x.promovidos)} de ${fmtNum(x.meta)} · ${fmtNum(x.promotores)} ${x.promotores === 1 ? 'promotor' : 'promotores'}</p>
            </li>`
          )
          .join('')}</ol>`
      : '<p class="muted">Aún no hay Responsables de Sección.</p>';
  const responsables = `
    <section class="card" aria-labelledby="ecRsT"><header class="dash-card__head"><h3 id="ecRsT">Responsables con mayor avance</h3><span class="muted">de ${fmtNum(d.responsables.total)}</span></header>${listaRS(d.responsables.mejores)}</section>
    <section class="card" aria-labelledby="ecRbT"><header class="dash-card__head"><h3 id="ecRbT">Responsables que necesitan apoyo</h3><span class="muted">Menor avance</span></header>${listaRS(d.responsables.rezagados)}</section>`;

  return `
    <div class="ec">
      ${hero}
      ${kpis}
      <div class="ec-row ec-row--mapa">${mapa}${atencion}</div>
      <div class="ec-row ec-row--chart">${grafica}${estatus}</div>
      ${tablaZonas}
      <div class="ec-row ec-row--2">${responsables}</div>
    </div>`;
}

export function mountEscritorioCPV(root, route) {
  const d = route.data;
  if (!d?.entidad) return undefined;

  barras30($('#dChart', root), d.serie, d.ritmo.faltan ? { referencia: { valor: d.ritmo.necesario, etiqueta: `Ritmo necesario: ${fmtNum(d.ritmo.necesario)}/día` } } : {});

  // Mapa: secciones coloreadas por avance contra su meta (o por zona)
  const info = $('#dInfo', root);
  const leyenda = $('#ecLeyenda', root);
  const { map, destroy } = baseMap($('#dMap', root));
  let bounds = null;
  let layer = null;
  let modo = 'avance';
  homeControl(() => bounds && map.fitBounds(bounds, { padding: [12, 12] })).addTo(map);
  const zonaById = new Map(d.zonas.map((z) => [z.id, z]));
  const bySec = new Map(d.secciones.map((s) => [s.c, s]));
  const resumen = `${fmtNum(d.kpis.seccionesCubiertas)} de ${fmtNum(d.kpis.secciones)} secciones con Responsable de Sección`;

  const estilo = (f) => {
    const s = bySec.get(f.properties.seccion);
    if (modo === 'zona') {
      const z = zonaById.get(s?.z);
      return z
        ? { color: '#ffffff', weight: 0.8, opacity: 1, fillColor: z.color, fillOpacity: 0.7 }
        : { color: '#ffffff', weight: 0.8, opacity: 1, fillColor: '#71717a', fillOpacity: 0.35 };
    }
    if (!s?.rs) return { color: '#a3a3a3', weight: 0.8, opacity: 1, dashArray: '3 3', fillColor: SIN_RS, fillOpacity: 0.6 };
    return { color: '#ffffff', weight: 0.8, opacity: 1, fillColor: colorAvance(s.m ? s.p / s.m : 0), fillOpacity: 0.85 };
  };
  const pintarLeyenda = () => {
    leyenda.innerHTML =
      modo === 'avance'
        ? `${RANGOS.map((r) => `<li><span class="vz-sw" style="background:${r.color}"></span>${r.t}</li>`).join('')}<li><span class="vz-sw" style="background:${SIN_RS}"></span>Sin responsable</li>`
        : d.zonas.map((z) => `<li><span class="vz-sw" style="background:${z.color}"></span>${esc(z.codigo)}</li>`).join('');
  };
  pintarLeyenda();
  root.querySelectorAll('[data-modo]').forEach((b) =>
    b.addEventListener('click', () => {
      modo = b.dataset.modo;
      root.querySelectorAll('[data-modo]').forEach((x) => {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      pintarLeyenda();
      layer?.setStyle(estilo);
    })
  );

  info.textContent = 'Cargando mapa…';
  (async () => {
    try {
      const fc = await seccionesGeo(d.entidad.clave, d.secciones.map((s) => s.c));
      layer = L.geoJSON(fc, {
        style: estilo,
        onEachFeature(f, l) {
          const s = bySec.get(f.properties.seccion);
          const z = zonaById.get(s?.z);
          const label = `Sección ${fmtSeccion(f.properties.seccion)} · ${z ? z.codigo : 'Sin zona'} · ${
            s?.rs ? `${fmtNum(s.p)} de ${fmtNum(s.m)} promovidos (${pctTxt(s.p, s.m)}) · ${s.rs}` : 'Sin Responsable de Sección'
          }`;
          l.bindTooltip(esc(label), { sticky: true, direction: 'top', className: 'map-tip' });
          l.on({
            mouseover: () => {
              l.setStyle({ weight: 2.5, color: '#171717' });
              info.textContent = label;
            },
            mouseout: () => {
              layer.resetStyle(l);
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
