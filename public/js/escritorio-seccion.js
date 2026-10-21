// Panel del Responsable de Sección: meta y ritmo de su sección, bandeja de revisión, promotores,
// captura de 30 días contra el ritmo necesario y material electoral.
import { ICONS, $, esc, fmtNum, fmtSeccion, fmtDateTime, api } from './lib.js';
import { I } from './coordinador.js';
import { barras30 } from './panel-sa.js';
import { DOC } from './informe.js';
import { pct, pctTxt, ESTATUS, barra, sparkline, FECHA } from './escritorio-cpv.js';

function hace(iso) {
  if (!iso) return 'Sin capturas';
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 3600) return `Hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `Hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `Hace ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'día' : 'días'}`;
  return fmtDateTime(iso);
}
const DIA = 86400000;
const decimal = (n) => (n < 10 && n % 1 ? n.toLocaleString('es-MX', { maximumFractionDigits: 1 }) : fmtNum(Math.round(n)));

export async function viewEscritorioSeccion(route) {
  const d = await api('/api/escritorio/seccion');
  route.data = d;
  if (!d.seccion) {
    return `<div class="empty"><span aria-hidden="true">${ICONS.map}</span><strong>Aún no tienes sección asignada</strong>
      <span>Tu Coordinador de Zona debe asignarte una sección.</span></div>`;
  }
  const k = d.kpis;
  const r = d.ritmo;
  const est = d.estatus;
  const enRitmo = !r.faltan || r.promedio7d >= r.necesario;
  const porRevisar = est.revision + est.observaciones;
  const totalEst = ESTATUS.reduce((t, e) => t + est[e.k], 0);
  const color = d.zona?.color || '#2a78d6';

  const hero = `
    <section class="ec-hero" aria-label="Meta de la sección">
      <div>
        <p class="ec-hero__label">Sección ${fmtSeccion(d.seccion.clave)} · ${esc(d.seccion.municipio)}${d.zona ? ` · <span class="vz-sw" style="background:${color}"></span> ${esc(d.zona.codigo)}` : ''}</p>
        <p class="ec-hero__value">${fmtNum(k.promovidos)}<span> de ${fmtNum(k.meta)} promovidos</span></p>
        <div class="ec-hero__bar" role="img" aria-label="Avance de la meta: ${pctTxt(k.promovidos, k.meta)}"><span style="width:${Math.min(100, pct(k.promovidos, k.meta))}%"></span></div>
        <p class="ec-hero__pie"><strong>${pctTxt(k.promovidos, k.meta)}</strong> de la meta de tu sección · faltan ${fmtNum(r.faltan)} · ${fmtNum(d.eleccion.dias)} días para la elección</p>
      </div>
      <dl class="ec-hero__ritmo">
        <div><dt>Ritmo actual</dt><dd>${decimal(r.promedio7d)}<small>/día</small></dd><p>Promedio de los últimos 7 días</p></div>
        <div><dt>Ritmo necesario</dt><dd>${fmtNum(r.necesario)}<small>/día</small></dd><p>Para completar la meta a tiempo</p></div>
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

  // La tarea principal del Responsable: revisar lo que capturan sus promotores
  const bandeja = `
    <section class="es-bandeja ${porRevisar ? '' : 'is-vacia'}" aria-labelledby="esBT">
      <div class="es-bandeja__num"><span id="esBT">Por revisar</span><strong>${fmtNum(porRevisar)}</strong></div>
      <div class="es-bandeja__txt">
        ${
          porRevisar
            ? `<p>${est.viejos ? `<strong>${fmtNum(est.viejos)} llevan más de 3 días esperando.</strong> ` : ''}${est.observaciones ? `${fmtNum(est.observaciones)} tienen observaciones tuyas. ` : ''}Revisa que los datos coincidan con la INE y apruébalos o recházalos con un motivo.</p>`
            : '<p>No tienes promovidos pendientes. ¡Bien hecho!</p>'
        }
        <div class="es-bandeja__acc">
          ${d.siguiente ? `<a class="btn btn--inv" href="/promovidos/${d.siguiente}" data-link>${ICONS.eye}<span>Empezar a revisar</span></a>` : ''}
          <a class="btn btn--ghost-inv" href="/promovidos" data-link>Ver todos</a>
        </div>
      </div>
    </section>`;

  const kpi = (label, valor, meta, sub, href) => `
    <${href ? `a href="${href}" data-link` : 'div'} class="ec-kpi">
      <span class="ec-kpi__label">${label}</span><span class="ec-kpi__valor">${valor}</span>
      ${meta ? barra(meta[0], meta[1]) : ''}<span class="ec-kpi__sub">${sub}</span>
    </${href ? 'a' : 'div'}>`;
  const m = d.material;
  const kpis = `
    <div class="ec-kpis es-kpis">
      ${kpi('Promotores Territoriales', fmtNum(k.promotores), [k.promotores, k.promotoresMeta], `${pctTxt(k.promotores, k.promotoresMeta)} de ${fmtNum(k.promotoresMeta)} que debes tener`, '/estructura')}
      ${kpi('Aprobados', fmtNum(est.aprobados), [est.aprobados, totalEst], `${pctTxt(est.aprobados, totalEst)} de lo capturado`)}
      ${kpi('Rechazados', fmtNum(est.rechazados), null, 'Esperan corrección del promotor', '/promovidos')}
      ${kpi('Material', m.porRecibir.length ? fmtNum(m.porRecibir.length) : fmtNum(m.conEvidencia), null, m.porRecibir.length ? `${fmtNum(m.porRecibir.length)} por recibir` : m.total ? 'órdenes recibidas' : 'Sin órdenes de material', m.porRecibir[0] ? `/material/ordenes/${m.porRecibir[0]}` : '/material')}
    </div>`;

  const grafica = `
    <section class="card" aria-labelledby="esChT">
      <header class="dash-card__head"><h3 id="esChT">Promovidos capturados por día</h3><span class="muted">Últimos 30 días · la línea es el ritmo necesario</span></header>
      <div id="esChart"></div>
      <details class="vz-table"><summary>Ver como tabla</summary>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Día</th><th scope="col" class="num">Promovidos</th></tr></thead>
        <tbody>${d.serie.dias.map((x, i) => `<tr><td>${esc(x)}</td><td class="num">${fmtNum(d.serie.total[i])}</td></tr>`).reverse().join('')}</tbody></table></div>
      </details>
    </section>`;

  const estatus = `
    <section class="card" aria-labelledby="esEsT">
      <header class="dash-card__head"><h3 id="esEsT">Revisión</h3><span class="muted">${fmtNum(totalEst)} capturados</span></header>
      <div class="sa-stack" role="img" aria-label="${ESTATUS.map((e) => `${e.t}: ${fmtNum(est[e.k])}`).join(', ')}">
        ${ESTATUS.filter((e) => est[e.k]).map((e) => `<span style="flex:${est[e.k]};background:${e.c}" title="${e.t}: ${fmtNum(est[e.k])}"></span>`).join('')}
      </div>
      <ul class="sa-leyenda">${ESTATUS.map((e) => `<li><span class="vz-sw" style="background:${e.c}"></span><span>${e.t}</span><strong>${fmtNum(est[e.k])}</strong><small>${pctTxt(est[e.k], totalEst)}</small></li>`).join('')}</ul>
    </section>`;

  // Promotores: avance contra su meta (factor de conversión del CPV). Dos listas de hasta 7:
  // los de mejor desempeño y los que necesitan apoyo (sin repetir a nadie)
  const meta = d.metaPorPromotor;
  const desc = [...d.promotores].sort((a, b) => b.promovidos - a.promovidos || a.name.localeCompare(b.name, 'es'));
  const mejores = desc.slice(0, Math.min(7, Math.ceil(desc.length / 2)));
  const apoyo = desc.slice(mejores.length).reverse().slice(0, 7);
  const filas = (lista) => lista
    .map((p) => {
      const tel = String(p.phone || '').replace(/\D/g, '').slice(-10);
      const inactivo = !p.ultima || Date.now() - new Date(p.ultima) > 3 * DIA;
      return `<li class="es-prom">
        <div class="es-prom__main">
          <div class="ec-rs__top"><strong>${esc(p.name)}</strong><span class="ec-rs__p">${pctTxt(p.promovidos, meta)}</span></div>
          ${barra(p.promovidos, meta, p.promovidos >= meta ? '#16a34a' : 'var(--color-foreground)')}
          <p>${fmtNum(p.promovidos)} de ${fmtNum(meta)} · ${fmtNum(p.aprobados)} aprobados${p.porRevisar ? ` · <strong>${fmtNum(p.porRevisar)} por revisar</strong>` : ''}${p.rechazados ? ` · ${fmtNum(p.rechazados)} rechazados` : ''} · <span class="${inactivo ? 'es-inactivo' : ''}">${esc(hace(p.ultima))}</span></p>
        </div>
        ${sparkline(p.serie, '#2a78d6')}
        <span class="promo-contacto">${
          tel
            ? `<a class="icon-btn promo-contacto__btn" href="tel:+52${tel}" title="Llamar" aria-label="Llamar a ${esc(p.name)}">${I.phone}</a>
               <a class="icon-btn promo-contacto__btn" href="https://wa.me/52${tel}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp con ${esc(p.name)}">${I.whatsapp}</a>`
            : ''
        }</span>
      </li>`;
    })
    .join('');
  const tarjeta = (id, titulo, sub, lista) => `
    <section class="card" aria-labelledby="${id}">
      <header class="dash-card__head"><h3 id="${id}">${titulo}</h3><span class="muted">${sub}</span></header>
      ${lista.length ? `<ul class="es-proms">${filas(lista)}</ul>` : '<p class="muted">Aún no tienes promotores.</p>'}
    </section>`;
  const faltanPromotores = Math.max(0, k.promotoresMeta - k.promotores);
  const listaPromotores = `
    <div class="es-proms-dos">
      ${tarjeta('esPrMej', 'Mejor desempeño', `Meta de ${fmtNum(meta)} promovidos cada uno`, mejores)}
      ${tarjeta('esPrApo', 'Necesitan apoyo', 'Menor avance contra su meta', apoyo)}
    </div>
    <div class="es-proms-pie">
      <a class="link-btn" href="/estructura" data-link>Ver todos tus promotores (${fmtNum(desc.length)})</a>
      ${
        faltanPromotores
          ? `<div class="es-faltan"><p>Te faltan <strong>${fmtNum(faltanPromotores)} ${faltanPromotores === 1 ? 'promotor' : 'promotores'}</strong> para cubrir tu sección.</p><a class="btn btn--sm" href="/estructura/nuevo" data-link>${ICONS.plus}<span>Nuevo promotor</span></a></div>`
          : ''
      }
    </div>`;

  return `
    <div class="ec">
      ${hero}
      ${bandeja}
      <a class="btn es-informe" href="/informe" data-link>${DOC}<span>Generar informe</span></a>
      ${kpis}
      <div class="ec-row ec-row--chart">${grafica}${estatus}</div>
      ${listaPromotores}
    </div>`;
}

export function mountEscritorioSeccion(root, route) {
  const d = route.data;
  if (!d?.seccion) return;
  barras30($('#esChart', root), d.serie, d.ritmo.faltan ? { referencia: { valor: d.ritmo.necesario, etiqueta: `Ritmo necesario: ${fmtNum(d.ritmo.necesario)}/día` } } : {});
}
