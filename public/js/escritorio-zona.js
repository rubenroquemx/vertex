// Panel del Coordinador de Zona: meta y ritmo de su zona, mapa de avance por sección, pendientes,
// captura de 30 días contra el ritmo necesario, revisión y el detalle de cada Responsable de Sección.
import { ICONS, $, esc, fmtNum, fmtSeccion, fmtDateTime, api, homeControl } from './lib.js';
import { I } from './coordinador.js';
import { baseMap, seccionesGeo } from './zonas.js';
import { barras30 } from './panel-sa.js';
import { botonInforme } from './informe.js';
import { pct, pctTxt, RANGOS, colorAvance, SIN_RS, ESTATUS, barra, sparkline, FECHA } from './escritorio-cpv.js';

function hace(iso) {
  if (!iso) return 'Sin capturas';
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 3600) return `Hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `Hace ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'día' : 'días'}`;
  return fmtDateTime(iso);
}

function alertas(d) {
  const k = d.kpis;
  const out = [];
  const add = (nivel, titulo, texto, href) => out.push({ nivel, titulo, texto, href });
  const sinPromotores = d.responsables.filter((r) => !r.promotores);
  const sinCaptura = d.responsables.filter((r) => r.promotores && (!r.ultima || Date.now() - new Date(r.ultima) > 3 * 86400000));
  const atorados = [...d.responsables].filter((r) => r.viejos).sort((a, b) => b.viejos - a.viejos);
  if (d.ritmo.faltan && d.ritmo.promedio7d < d.ritmo.necesario)
    add('alta', 'Ritmo por debajo de la meta', `Tu zona captura ${fmtNum(d.ritmo.promedio7d)} al día; se necesitan ${fmtNum(d.ritmo.necesario)}.`);
  if (d.estatus.viejos)
    add(
      'alta',
      `${fmtNum(d.estatus.viejos)} promovidos sin revisar hace más de 3 días`,
      `Más atrasados: ${atorados.slice(0, 3).map((r) => `${esc(r.name)} (${fmtNum(r.viejos)})`).join(', ')}.`
    );
  if (d.vacantes.length)
    add('media', `${fmtNum(d.vacantes.length)} ${d.vacantes.length === 1 ? 'sección sin' : 'secciones sin'} Responsable de Sección`, `Secciones ${d.vacantes.slice(0, 6).map((v) => fmtSeccion(v.c)).join(', ')}${d.vacantes.length > 6 ? '…' : ''}.`, '/responsables/nuevo');
  if (sinPromotores.length) add('media', `${fmtNum(sinPromotores.length)} ${sinPromotores.length === 1 ? 'responsable sin' : 'responsables sin'} promotores`, sinPromotores.slice(0, 4).map((r) => esc(r.name)).join(', '));
  if (sinCaptura.length) add('media', `${fmtNum(sinCaptura.length)} ${sinCaptura.length === 1 ? 'responsable sin' : 'responsables sin'} capturas en 3 días`, sinCaptura.slice(0, 4).map((r) => esc(r.name)).join(', '));
  if (k.promotores < k.promotoresMeta * 0.5) add('baja', 'Faltan Promotores Territoriales', `Tu zona tiene ${fmtNum(k.promotores)} de ${fmtNum(k.promotoresMeta)} requeridos.`);
  if (d.material.porRecibir) add('media', `${fmtNum(d.material.porRecibir)} ${d.material.porRecibir === 1 ? 'orden' : 'órdenes'} de material por recibir`, 'El CPV te envió material: confirma que lo recibiste.', '/material');
  if (d.material.sinEvidencia) add('baja', `${fmtNum(d.material.sinEvidencia)} órdenes de material sin evidencia`, 'Responsables que recibieron material y no han subido sus fotos.', '/material');
  return out;
}

// Orden de la tabla de responsables
const ORDENES = {
  menor: { t: 'Menor avance', f: (a, b) => pct(a.promovidos, a.meta) - pct(b.promovidos, b.meta) },
  mayor: { t: 'Mayor avance', f: (a, b) => pct(b.promovidos, b.meta) - pct(a.promovidos, a.meta) },
  revisar: { t: 'Más por revisar', f: (a, b) => b.viejos - a.viejos || b.porRevisar - a.porRevisar },
  nombre: { t: 'Nombre', f: (a, b) => a.name.localeCompare(b.name, 'es') },
};

function filasResponsables(d, orden) {
  const color = d.zona.color;
  return [...d.responsables]
    .sort(ORDENES[orden].f)
    .map((r) => {
      const tel = String(r.phone || '').replace(/\D/g, '').slice(-10);
      const m = r.material;
      const matTxt = m.pendientes + m.sinEvidencia + m.conEvidencia
        ? `${fmtNum(m.conEvidencia)} ${m.conEvidencia === 1 ? 'recibida' : 'recibidas'}${m.pendientes ? ` · ${fmtNum(m.pendientes)} por recibir` : ''}`
        : '—';
      return `<tr>
        <th scope="row"><span class="ez-rs"><strong>${esc(r.name)}</strong><small>Sección ${r.seccion !== null ? fmtSeccion(r.seccion) : '—'} · ${esc(hace(r.ultima))}</small></span></th>
        <td><div class="ec-celda"><strong>${fmtNum(r.promovidos)}</strong><span class="ec-celda__p">${pctTxt(r.promovidos, r.meta)}</span></div>${barra(r.promovidos, r.meta, color)}<small class="ec-celda__meta">de ${fmtNum(r.meta)}</small></td>
        <td><div class="ec-celda"><strong>${fmtNum(r.promotores)}</strong><span class="ec-celda__p">${pctTxt(r.promotores, r.promotoresMeta)}</span></div>${barra(r.promotores, r.promotoresMeta, color)}<small class="ec-celda__meta">de ${fmtNum(r.promotoresMeta)}</small></td>
        <td class="num">${fmtNum(r.porRevisar)}${r.viejos ? `<small class="ez-viejos">${fmtNum(r.viejos)} con +3 días</small>` : ''}</td>
        <td class="ez-mat">${matTxt}</td>
        <td>${sparkline(r.serie, color)}</td>
        <td class="ez-contacto">${
          tel
            ? `<a class="icon-btn promo-contacto__btn" href="tel:+52${tel}" title="Llamar" aria-label="Llamar a ${esc(r.name)}">${I.phone}</a>
               <a class="icon-btn promo-contacto__btn" href="https://wa.me/52${tel}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp con ${esc(r.name)}">${I.whatsapp}</a>`
            : ''
        }</td>
      </tr>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------
export async function viewEscritorioZona(route) {
  const d = await api('/api/escritorio/zona');
  route.data = d;
  if (!d.entidad) {
    return `<div class="empty"><span aria-hidden="true">${ICONS.map}</span><strong>Tu zona aún no tiene secciones</strong>
      <span>Cuando tu Coordinador de Promoción del Voto te asigne secciones, aquí verás su avance.</span></div>`;
  }
  const k = d.kpis;
  const r = d.ritmo;
  const enRitmo = !r.faltan || r.promedio7d >= r.necesario;
  const semanaDelta = k.semanaAnterior ? Math.round(pct(k.semana - k.semanaAnterior, k.semanaAnterior)) : null;
  const est = d.estatus;
  const totalEst = ESTATUS.reduce((t, e) => t + est[e.k], 0);
  const avisos = alertas(d);

  const hero = `
    <section class="ec-hero" aria-label="Meta de la zona">
      <div>
        <p class="ec-hero__label"><span class="vz-sw" style="background:${d.zona.color}"></span> ${esc(d.zona.codigo)} · ${esc(d.zona.nombre)}</p>
        <p class="ec-hero__value">${fmtNum(k.promovidos)}<span> de ${fmtNum(k.meta)} promovidos</span></p>
        <div class="ec-hero__bar" role="img" aria-label="Avance de la meta: ${pctTxt(k.promovidos, k.meta)}"><span style="width:${Math.min(100, pct(k.promovidos, k.meta))}%;background:${d.zona.color}"></span></div>
        <p class="ec-hero__pie"><strong>${pctTxt(k.promovidos, k.meta)}</strong> de la meta de tu zona · faltan ${fmtNum(r.faltan)} · ${fmtNum(d.eleccion.dias)} días para la elección</p>
      </div>
      <dl class="ec-hero__ritmo">
        <div><dt>Ritmo actual</dt><dd>${fmtNum(r.promedio7d)}<small>/día</small></dd><p>Promedio de 7 días${semanaDelta !== null ? ` · ${semanaDelta >= 0 ? '▲' : '▼'} ${Math.abs(semanaDelta)}% vs. semana anterior` : ''}</p></div>
        <div><dt>Ritmo necesario</dt><dd>${fmtNum(r.necesario)}<small>/día</small></dd><p>Para completar la meta antes de la elección</p></div>
        <div class="ec-hero__estado ${enRitmo ? 'is-ok' : 'is-bajo'}">
          <span aria-hidden="true">${enRitmo ? '✓' : '!'}</span>
          <p>${
            !r.faltan
              ? 'Meta alcanzada.'
              : enRitmo
                ? `A este ritmo tu zona llega a la meta el <strong>${esc(FECHA.format(new Date(r.proyeccion)))}</strong>.`
                : `A este ritmo tu zona no llega a tiempo${r.proyeccion ? ` (lo haría el ${esc(FECHA.format(new Date(r.proyeccion)))})` : ''}.`
          }</p>
        </div>
      </dl>
    </section>`;

  const kpi = (label, valor, meta, sub, href) => `
    <${href ? `a href="${href}" data-link` : 'div'} class="ec-kpi">
      <span class="ec-kpi__label">${label}</span><span class="ec-kpi__valor">${valor}</span>
      ${meta ? barra(meta[0], meta[1]) : ''}<span class="ec-kpi__sub">${sub}</span>
    </${href ? 'a' : 'div'}>`;
  const kpis = `
    <div class="ec-kpis">
      ${kpi('Secciones con responsable', fmtNum(k.seccionesCubiertas), [k.seccionesCubiertas, k.secciones], `${pctTxt(k.seccionesCubiertas, k.secciones)} de ${fmtNum(k.secciones)} secciones`, '/responsables')}
      ${kpi('Promotores Territoriales', fmtNum(k.promotores), [k.promotores, k.promotoresMeta], `${pctTxt(k.promotores, k.promotoresMeta)} de ${fmtNum(k.promotoresMeta)} requeridos`)}
      ${kpi('Aprobados', fmtNum(est.aprobados), [est.aprobados, totalEst], `${pctTxt(est.aprobados, totalEst)} de lo capturado`)}
      ${kpi('Por revisar', fmtNum(est.revision + est.observaciones), null, `${fmtNum(est.viejos)} con más de 3 días`)}
      ${kpi('Material con evidencia', fmtNum(d.material.conEvidencia), [d.material.conEvidencia, d.material.ordenes], `de ${fmtNum(d.material.ordenes)} órdenes a responsables`, '/material')}
    </div>`;

  const mapa = `
    <section class="card ec-mapa" aria-labelledby="ezMapT">
      <header class="dash-card__head"><h3 id="ezMapT">Avance por sección</h3><span class="muted">${esc(d.entidad.nombre)} · ${fmtNum(k.secciones)} secciones</span></header>
      <div class="map ec-mapa__map" id="ezMap"></div>
      <ul class="legend">${RANGOS.map((x) => `<li><span class="vz-sw" style="background:${x.color}"></span>${x.t}</li>`).join('')}<li><span class="vz-sw" style="background:${SIN_RS}"></span>Sin responsable</li></ul>
      <p class="map-card__info" id="ezInfo" aria-live="polite"></p>
    </section>`;

  const atencion = `
    <section class="card ec-atencion" aria-labelledby="ezAtT">
      <header class="dash-card__head"><h3 id="ezAtT">Requiere tu atención</h3><span class="muted">${fmtNum(avisos.length)}</span></header>
      ${
        avisos.length
          ? `<ul class="ec-avisos">${avisos
              .map(
                (a) => `<li class="ec-aviso is-${a.nivel}"><span class="ec-aviso__punto" aria-hidden="true"></span>
                  <div><strong>${a.titulo}</strong><p>${a.texto}</p>${a.href ? `<a href="${a.href}" data-link>Ir</a>` : ''}</div><span class="sr-only">Prioridad ${a.nivel}</span></li>`
              )
              .join('')}</ul>`
          : '<p class="muted">Todo en orden por ahora.</p>'
      }
    </section>`;

  const grafica = `
    <section class="card" aria-labelledby="ezChT">
      <header class="dash-card__head"><h3 id="ezChT">Promovidos capturados por día</h3><span class="muted">Últimos 30 días · la línea es el ritmo necesario</span></header>
      <div id="ezChart"></div>
      <details class="vz-table"><summary>Ver como tabla</summary>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Día</th><th scope="col" class="num">Promovidos</th></tr></thead>
        <tbody>${d.serie.dias.map((x, i) => `<tr><td>${esc(x)}</td><td class="num">${fmtNum(d.serie.total[i])}</td></tr>`).reverse().join('')}</tbody></table></div>
      </details>
    </section>`;

  const estatus = `
    <section class="card" aria-labelledby="ezEsT">
      <header class="dash-card__head"><h3 id="ezEsT">Revisión de promovidos</h3><span class="muted">${fmtNum(totalEst)}</span></header>
      <div class="sa-stack" role="img" aria-label="${ESTATUS.map((e) => `${e.t}: ${fmtNum(est[e.k])}`).join(', ')}">
        ${ESTATUS.filter((e) => est[e.k]).map((e) => `<span style="flex:${est[e.k]};background:${e.c}" title="${e.t}: ${fmtNum(est[e.k])}"></span>`).join('')}
      </div>
      <ul class="sa-leyenda">${ESTATUS.map((e) => `<li><span class="vz-sw" style="background:${e.c}"></span><span>${e.t}</span><strong>${fmtNum(est[e.k])}</strong><small>${pctTxt(est[e.k], totalEst)}</small></li>`).join('')}</ul>
      <dl class="sa-lista ez-material">
        <div><dt>Material recibido del CPV</dt><dd>${fmtNum(d.material.unidadesRecibidas)} <small>unidades</small></dd></div>
        <div><dt>Entregado a responsables</dt><dd>${fmtNum(d.material.unidadesEntregadas)} <small>${pctTxt(d.material.unidadesEntregadas, d.material.unidadesRecibidas)}</small></dd></div>
      </dl>
    </section>`;

  const tabla = `
    <section class="card" aria-labelledby="ezRsT">
      <header class="dash-card__head">
        <h3 id="ezRsT">Responsables de Sección <span class="muted">${fmtNum(k.responsables)}</span></h3>
        <label class="ez-orden"><span>Ordenar por</span>
          <select class="input" id="ezOrden">${Object.entries(ORDENES).map(([key, o]) => `<option value="${key}">${o.t}</option>`).join('')}</select>
        </label>
      </header>
      ${
        d.responsables.length
          ? `<div class="table-wrap"><table class="table ec-zonas ez-tabla table--cards">
          <thead><tr><th scope="col">Responsable</th><th scope="col">Promovidos</th><th scope="col">Promotores</th><th scope="col" class="num">Por revisar</th><th scope="col">Material</th><th scope="col">30 días</th><th scope="col"><span class="sr-only">Contacto</span></th></tr></thead>
          <tbody id="ezFilas">${filasResponsables(d, 'menor')}</tbody></table></div>`
          : `<div class="empty empty--sm"><strong>Aún no tienes Responsables de Sección</strong><a class="btn btn--sm" href="/responsables/nuevo" data-link>${ICONS.plus}<span>Nuevo responsable</span></a></div>`
      }
    </section>`;

  const vacantes = d.vacantes.length
    ? `<section class="card" aria-labelledby="ezVaT">
        <header class="dash-card__head"><h3 id="ezVaT">Secciones sin Responsable</h3><a class="btn btn--sm" href="/responsables/nuevo" data-link>${ICONS.plus}<span>Nuevo responsable</span></a></header>
        <ul class="ez-vacantes">${d.vacantes
          .map((v) => `<li><strong>${fmtSeccion(v.c)}</strong><span>Meta ${fmtNum(v.m)} · ${v.e !== null ? `${fmtNum(v.e)} electores` : ''}</span></li>`)
          .join('')}</ul>
        <p class="sa-nota">Ordenadas por meta de promovidos: las primeras pesan más en el avance de tu zona.</p>
      </section>`
    : '';

  return `
    <div class="ec">
      ${botonInforme()}
      ${hero}
      ${kpis}
      <div class="ec-row ec-row--mapa">${mapa}${atencion}</div>
      <div class="ec-row ec-row--chart">${grafica}${estatus}</div>
      ${tabla}
      ${vacantes}
    </div>`;
}

export function mountEscritorioZona(root, route) {
  const d = route.data;
  if (!d?.entidad) return undefined;
  barras30($('#ezChart', root), d.serie, {
    color: d.zona.color,
    ...(d.ritmo.faltan ? { referencia: { valor: d.ritmo.necesario, etiqueta: `Ritmo necesario: ${fmtNum(d.ritmo.necesario)}/día` } } : {}),
  });
  $('#ezOrden', root)?.addEventListener('change', (e) => {
    $('#ezFilas', root).innerHTML = filasResponsables(d, e.target.value);
  });

  const info = $('#ezInfo', root);
  const { map, destroy } = baseMap($('#ezMap', root));
  let bounds = null;
  homeControl(() => bounds && map.fitBounds(bounds, { padding: [12, 12] })).addTo(map);
  const bySec = new Map(d.secciones.map((s) => [s.c, s]));
  const resumen = `${fmtNum(d.kpis.seccionesCubiertas)} de ${fmtNum(d.kpis.secciones)} secciones con Responsable de Sección`;
  const estilo = (f) => {
    const s = bySec.get(f.properties.seccion);
    if (!s?.rs) return { color: '#a3a3a3', weight: 0.8, opacity: 1, dashArray: '3 3', fillColor: SIN_RS, fillOpacity: 0.6 };
    return { color: '#ffffff', weight: 0.8, opacity: 1, fillColor: colorAvance(s.m ? s.p / s.m : 0), fillOpacity: 0.85 };
  };
  info.textContent = 'Cargando mapa…';
  (async () => {
    try {
      const fc = await seccionesGeo(d.entidad.clave, d.secciones.map((s) => s.c));
      const layer = L.geoJSON(fc, {
        style: estilo,
        onEachFeature(f, l) {
          const s = bySec.get(f.properties.seccion);
          const label = `Sección ${fmtSeccion(f.properties.seccion)} · ${s?.rs ? `${fmtNum(s.p)} de ${fmtNum(s.m)} promovidos (${pctTxt(s.p, s.m)}) · ${s.rs}` : 'Sin Responsable de Sección'}`;
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
