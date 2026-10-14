// Informe por periodo (todos los niveles): se elige el periodo y se genera un informe con las
// cifras del periodo, el avance contra la meta, la revisión, el material, las unidades a cargo
// y un análisis FODA con acciones sugeridas. Se puede imprimir o guardar como PDF.
import { icon, $, esc, fmtNum, fmtDateTime, api, fieldErrorSetter, navigate } from './lib.js';
import { barras30 } from './panel-sa.js';
import { barra } from './escritorio-cpv.js';

const DOC = icon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>');
const PRINT = icon('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>');
const FECHA = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fecha = (key, fmt = FECHA) => fmt.format(new Date(`${key}T12:00:00Z`));
const sumar = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const pc = (v) => (v === null || v === undefined ? '—' : `${v > 0 && v < 0.01 ? (v * 100).toFixed(1) : fmtNum(Math.round(v * 100))}%`);
const dec = (v) => (v < 10 && v % 1 ? v.toLocaleString('es-MX', { maximumFractionDigits: 1 }) : fmtNum(Math.round(v)));
const horas = (h) => (h === null ? '—' : h < 48 ? `${dec(h)} h` : `${dec(h / 24)} días`);

// Botón de cada panel
export const botonInforme = () =>
  `<div class="inf-cta"><a class="btn btn--secondary btn--sm" href="/informe" data-link>${DOC}<span>Generar informe</span></a></div>`;

// Atajos de periodo, calculados sobre «hoy» del servidor (hora del centro)
function rangos(hoy, primera) {
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const finMesAnterior = sumar(inicioMes, -1);
  const out = [
    { k: '7', t: 'Últimos 7 días', desde: sumar(hoy, -6), hasta: hoy },
    { k: '30', t: 'Últimos 30 días', desde: sumar(hoy, -29), hasta: hoy },
    { k: 'mes', t: 'Este mes', desde: inicioMes, hasta: hoy },
    { k: 'ant', t: 'Mes anterior', desde: `${finMesAnterior.slice(0, 7)}-01`, hasta: finMesAnterior },
  ];
  if (primera) out.push({ k: 'todo', t: 'Desde el inicio', desde: primera > sumar(hoy, -365) ? primera : sumar(hoy, -365), hasta: hoy });
  return out;
}

export async function viewInforme(route) {
  const q = new URLSearchParams(location.search);
  const desde = q.get('desde') || '';
  const hasta = q.get('hasta') || '';
  const ini = await api('/api/informe/inicio');
  let d = null;
  let error = null;
  if (desde || hasta) {
    try {
      d = await api(`/api/informe?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`);
    } catch (err) {
      error = err;
    }
  }
  route.data = { ini, d, desde, hasta, error };
  const atajos = rangos(ini.hoy, ini.primera);
  const activo = atajos.find((r) => r.desde === desde && r.hasta === hasta)?.k;

  const form = `
    <form class="card inf-form" id="infForm" novalidate aria-labelledby="infFormT">
      <header class="dash-card__head"><h3 id="infFormT">${d ? 'Periodo del informe' : 'Elige el periodo del informe'}</h3>
        ${d ? '' : '<span class="muted">El informe resume tus cifras del periodo y las compara con el periodo anterior de la misma duración.</span>'}</header>
      <div class="inf-atajos" role="group" aria-label="Periodos frecuentes">
        ${atajos.map((r) => `<button type="button" class="inf-chip${r.k === activo ? ' is-on' : ''}" data-desde="${r.desde}" data-hasta="${r.hasta}" aria-pressed="${r.k === activo}">${r.t}</button>`).join('')}
      </div>
      <div class="inf-fechas">
        <div class="field">
          <label for="infDesde">Desde</label>
          <input class="input" type="date" id="infDesde" name="desde" value="${esc(desde)}" max="${ini.hoy}" required>
          <p class="field__error" id="infDesde-err"></p>
        </div>
        <div class="field">
          <label for="infHasta">Hasta</label>
          <input class="input" type="date" id="infHasta" name="hasta" value="${esc(hasta || (desde ? '' : ini.hoy))}" max="${ini.hoy}" required>
          <p class="field__error" id="infHasta-err"></p>
        </div>
        <button class="btn" type="submit">${DOC}<span>Generar informe</span></button>
      </div>
      <p class="form-error" id="infErr" role="alert">${error && !error.data?.fields ? esc(error.message) : ''}</p>
    </form>`;

  return `<div class="inf-pagina">${form}${d ? reporte(d) : ''}</div>`;
}

function reporte(d) {
  const k = d.kpis;
  const u = d.unidad;
  const semanal = d.periodo.diasMedidos > 92;
  const diasConCaptura = d.serie.total.filter(Boolean).length;
  const variacion =
    k.variacion === null
      ? `Sin capturas en el periodo anterior`
      : `${k.variacion >= 0 ? '+' : '−'}${pc(Math.abs(k.variacion))} contra el periodo anterior (${fmtNum(k.anterior)})`;

  const kpi = (label, valor, sub, extra = '') => `
    <div class="ec-kpi"><span class="ec-kpi__label">${label}</span><span class="ec-kpi__valor">${valor}</span>${extra}<span class="ec-kpi__sub">${sub}</span></div>`;
  const kpis = `
    <div class="ec-kpis inf-kpis">
      ${kpi('Capturados en el periodo', fmtNum(k.capturados), esc(variacion))}
      ${k.meta ? kpi('Avance al cierre', pc(k.avance), `${fmtNum(k.acumulado)} de ${fmtNum(k.meta)} · faltan ${fmtNum(k.faltan)}`, barra(k.acumulado, k.meta)) : kpi('Acumulado al cierre', fmtNum(k.acumulado), 'Sin meta definida')}
      ${kpi('Ritmo diario', dec(k.ritmo), k.faltan ? `Se necesitan ${dec(k.necesario)} al día` : 'Meta cumplida')}
      ${kpi('Aprobados en el periodo', fmtNum(k.aprobados), `${fmtNum(k.rechazados)} rechazados${k.tasaRechazo !== null ? ` · ${pc(k.tasaRechazo)} de rechazo` : ''}`)}
      ${
        k.promotores !== null
          ? kpi('Promotores activos', fmtNum(k.activos), `de ${fmtNum(k.promotores)} capturaron en el periodo`)
          : kpi('Días con captura', fmtNum(diasConCaptura), `de ${fmtNum(d.periodo.diasMedidos)} días del periodo`)
      }
    </div>`;

  const grafica = `
    <section class="card inf-grafica" aria-labelledby="infChT">
      <header class="dash-card__head"><h3 id="infChT">Promovidos capturados por ${semanal ? 'semana' : 'día'}</h3>
        <span class="muted">${k.faltan && k.meta ? `La línea es el ritmo necesario (${dec(semanal ? k.necesario * 7 : k.necesario)} por ${semanal ? 'semana' : 'día'})` : `${fmtNum(d.periodo.diasMedidos)} días`}</span></header>
      <div id="infChart"></div>
      <details class="vz-table"><summary>Ver como tabla</summary>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Día</th><th scope="col" class="num">Promovidos</th></tr></thead>
        <tbody>${d.serie.dias.map((x, i) => `<tr><td>${esc(fecha(x))}</td><td class="num">${fmtNum(d.serie.total[i])}</td></tr>`).reverse().join('')}</tbody></table></div>
      </details>
    </section>`;

  const cuadrante = (clave, letra, titulo, items) => `
    <section class="inf-q inf-q--${clave}" aria-labelledby="infQ${letra}">
      <h3 id="infQ${letra}"><span class="inf-q__letra" aria-hidden="true">${letra}</span>${titulo}</h3>
      <ul>${items.map((x) => `<li><strong>${esc(x.titulo)}.</strong> ${esc(x.texto)}</li>`).join('')}</ul>
    </section>`;
  const foda = `
    <section class="inf-foda-wrap" aria-labelledby="infFodaT">
      <h3 class="inf-h" id="infFodaT">Análisis FODA</h3>
      <div class="inf-foda">
        ${cuadrante('f', 'F', 'Fortalezas', d.foda.fortalezas)}
        ${cuadrante('o', 'O', 'Oportunidades', d.foda.oportunidades)}
        ${cuadrante('d', 'D', 'Debilidades', d.foda.debilidades)}
        ${cuadrante('a', 'A', 'Amenazas', d.foda.amenazas)}
      </div>
      <p class="muted inf-foda__nota">Fortalezas y debilidades: lo que depende de la estructura. Oportunidades y amenazas: lo que puede ganarse o ponerse en riesgo.</p>
    </section>`;

  const acciones = d.acciones.length
    ? `<section class="card inf-acciones" aria-labelledby="infAcT"><h3 id="infAcT">Acciones sugeridas</h3><ol>${d.acciones.map((a) => `<li>${esc(a)}</li>`).join('')}</ol></section>`
    : '';

  const tabla =
    u && d.unidades.length
      ? `<section class="card" aria-labelledby="infUnT">
          <header class="dash-card__head"><h3 id="infUnT">Desempeño por ${esc(u.singular)}</h3><span class="muted">Ordenado por avance contra su meta</span></header>
          <div class="table-wrap"><table class="table table--cards inf-tabla">
            <thead><tr><th scope="col">${esc(u.columna)}</th><th scope="col" class="num">En el periodo</th><th scope="col" class="num">Acumulado</th><th scope="col">Avance</th><th scope="col" class="num">Aprobados</th><th scope="col" class="num">Rechazados</th>${u.singular === 'promotor' ? '' : '<th scope="col" class="num">Promotores activos</th>'}</tr></thead>
            <tbody>${d.unidades
              .map(
                (x) => `<tr>
                  <td><strong>${esc(x.nombre)}</strong>${x.detalle ? `<br><span class="muted">${esc(x.detalle)}</span>` : ''}</td>
                  <td class="num">${fmtNum(x.capturados)}</td>
                  <td class="num"><span>${fmtNum(x.acumulado)}${x.meta ? ` <span class="muted">de ${fmtNum(x.meta)}</span>` : ''}</span></td>
                  <td><div class="inf-avance">${x.meta ? `${barra(x.acumulado, x.meta, x.avance >= 1 ? '#16a34a' : 'var(--color-foreground)')}<span>${pc(x.avance)}</span>` : '<span class="muted">Sin meta</span>'}</div></td>
                  <td class="num">${fmtNum(x.aprobados)}</td>
                  <td class="num">${fmtNum(x.rechazados)}</td>
                  ${u.singular === 'promotor' ? '' : `<td class="num"><span>${fmtNum(x.activos)} <span class="muted">de ${fmtNum(x.promotores)}</span></span></td>`}
                </tr>`
              )
              .join('')}</tbody>
          </table></div>
        </section>`
      : '';

  const fila = (t, v) => `<div><dt>${t}</dt><dd>${v}</dd></div>`;
  const totalMotivos = d.motivos.reduce((s, m) => s + m.n, 0);
  const revision = `
    <section class="card" aria-labelledby="infRvT">
      <header class="dash-card__head"><h3 id="infRvT">Revisión</h3></header>
      <dl class="inf-dl">
        ${fila('Aprobados en el periodo', fmtNum(k.aprobados))}
        ${fila('Rechazados en el periodo', `${fmtNum(k.rechazados)}${k.tasaRechazo !== null ? ` <small>(${pc(k.tasaRechazo)})</small>` : ''}`)}
        ${fila('Tiempo promedio de revisión', horas(k.horasRevision))}
        ${fila('En revisión al generar el informe', fmtNum(k.enRevision))}
        ${fila('Esperan más de 3 días', fmtNum(k.viejos))}
      </dl>
      ${
        totalMotivos
          ? `<h4 class="inf-sub">Motivos de rechazo registrados</h4><ul class="inf-motivos">${d.motivos
              .map((m) => `<li><span>${esc(m.motivo)}</span>${barra(m.n, totalMotivos)}<strong>${fmtNum(m.n)}</strong></li>`)
              .join('')}</ul>`
          : ''
      }
    </section>`;
  const m = d.material;
  const material = m
    ? `<section class="card" aria-labelledby="infMtT">
        <header class="dash-card__head"><h3 id="infMtT">Material electoral</h3></header>
        <dl class="inf-dl">
          ${fila('Órdenes creadas en el periodo', `${fmtNum(m.creadas)} <small>(${fmtNum(m.unidades)} piezas)</small>`)}
          ${fila('Recibidas en el periodo', fmtNum(m.recibidas))}
          ${fila('Comprobadas con fotos', fmtNum(m.comprobadas))}
          ${fila('Tiempo promedio para recibir', horas(m.horasRecibir))}
          ${fila('Por recibir hoy', fmtNum(m.pendientes))}
          ${fila('Recibidas sin evidencia hoy', fmtNum(m.sinEvidencia))}
        </dl>
      </section>`
    : '';

  return `
    <article class="inf" aria-labelledby="infT">
      <header class="inf-head">
        <div class="inf-head__txt">
          <p class="inf-head__nivel">Informe · ${esc(d.ambito.nivel)}</p>
          <h2 id="infT">${esc(d.ambito.titulo)}</h2>
          <p class="inf-head__periodo">Del ${esc(fecha(d.periodo.desde))} al ${esc(fecha(d.periodo.hasta))} · ${fmtNum(d.periodo.dias)} ${d.periodo.dias === 1 ? 'día' : 'días'}</p>
          <p class="inf-head__meta">Comparado con el periodo del ${esc(fecha(d.periodo.anterior.desde))} al ${esc(fecha(d.periodo.anterior.hasta))}.${
            d.periodo.inicio !== d.periodo.desde ? ` La primera captura fue el ${esc(fecha(d.periodo.inicio))}: el ritmo y la gráfica se miden desde ese día.` : ''
          } Generado el ${esc(fmtDateTime(d.generado))} por ${esc(d.por)}.</p>
        </div>
        <button class="btn btn--secondary btn--sm inf-head__print" type="button" data-action="imprimir">${PRINT}<span>Imprimir o guardar PDF</span></button>
      </header>
      <section class="inf-resumen" aria-labelledby="infReT"><h3 id="infReT">Resumen</h3><p>${esc(d.resumen)}</p></section>
      ${kpis}
      ${foda}
      ${acciones}
      ${grafica}
      ${tabla}
      <div class="ec-row ${material ? 'ec-row--2' : ''}">${revision}${material}</div>
      <p class="inf-nota">La meta es la vigente al generar el informe. Las cifras marcadas «hoy» o «al generar el informe» corresponden al momento de generarlo, no al cierre del periodo. El informe no incluye datos personales de promovidos.</p>
    </article>`;
}

// Agrupa la serie diaria en semanas (periodos largos)
function porSemana({ dias, total }) {
  const out = { dias: [], total: [] };
  for (let i = 0; i < dias.length; i += 7) {
    out.dias.push(dias[i]);
    out.total.push(total.slice(i, i + 7).reduce((s, v) => s + v, 0));
  }
  return out;
}

export function mountInforme(root, route) {
  const { d, error } = route.data;
  const form = $('#infForm', root);
  const setErrors = fieldErrorSetter(root, { desde: 'infDesde', hasta: 'infHasta' });
  if (error?.data?.fields) setErrors(error.data.fields);

  root.onclick = (e) => {
    const at = e.target.closest('[data-desde]');
    if (at) {
      $('#infDesde', root).value = at.dataset.desde;
      $('#infHasta', root).value = at.dataset.hasta;
      form.requestSubmit();
      return;
    }
    if (e.target.closest('[data-action="imprimir"]')) window.print();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const desde = $('#infDesde', root).value;
    const hasta = $('#infHasta', root).value;
    const errs = {};
    if (!desde) errs.desde = 'Elige la fecha de inicio.';
    if (!hasta) errs.hasta = 'Elige la fecha de fin.';
    if (desde && hasta && desde > hasta) errs.desde = 'La fecha de inicio debe ser anterior a la de fin.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    navigate(`/informe?desde=${desde}&hasta=${hasta}`);
  });

  if (d) {
    const semanal = d.periodo.diasMedidos > 92;
    const serie = semanal ? porSemana(d.serie) : d.serie;
    const nec = semanal ? d.kpis.necesario * 7 : d.kpis.necesario;
    barras30($('#infChart', root), serie, {
      ultimo: null,
      unidad: semanal ? 'semana' : 'día',
      aria: `Promovidos capturados por ${semanal ? 'semana' : 'día'} del ${fecha(d.periodo.inicio)} al ${fecha(d.periodo.hasta)}`,
      referencia: d.kpis.faltan && d.kpis.meta ? { valor: nec, etiqueta: `Ritmo necesario: ${dec(nec)} por ${semanal ? 'semana' : 'día'}` } : null,
    });
    // Al generar, el informe queda a la vista
    $('.inf', root)?.scrollIntoView({ block: 'start' });
  }
  return () => {
    root.onclick = null;
  };
}

