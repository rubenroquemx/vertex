// Material electoral: inventario del CPV y órdenes de entrega en cascada
// (CPV → Coordinador de Zona → Responsable de Sección). El Responsable reparte su material a la gente
// en activaciones (qué y cuánto, fecha, hora, lugar y mínimo 5 fotos).
import { ICONS, $, esc, fmtNum, fmtSeccion, fmtDateTime, api, fieldErrorSetter, toast, navigate } from './lib.js';

// Estado de una orden (semáforo): por recibir · recibida
function estadoDe(o) {
  if (o.estado === 'pendiente') return { texto: 'Por recibir', clase: 'estatus--revision' };
  return { texto: 'Recibida', clase: 'estatus--aprobado' };
}
const FECHA_HORA = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DIA_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
const HHMM = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const TIPO_EV = { asamblea: 'Asamblea', recorrido: 'Recorrido' };
const chip = (o) => {
  const e = estadoDe(o);
  return `<span class="estatus ${e.clase}">${e.texto}</span>`;
};
const itemsTexto = (o) => o.items.map((i) => `${fmtNum(i.cantidad)} ${esc(i.unidad)} de ${esc(i.nombre)}`).join(' · ');

const filaOrden = (o, yo) => `
  <li><a class="mat-orden" href="/material/ordenes/${o.id}" data-link>
    <span class="mat-orden__top"><strong>${o.folio}</strong>${chip(o)}</span>
    <span class="mat-orden__quien">${o.de.id === yo ? `Para <strong>${esc(o.para.name)}</strong>` : `De <strong>${esc(o.de.name)}</strong>`} · ${esc(fmtDateTime(o.createdAt))}</span>
    <span class="mat-orden__items">${itemsTexto(o)}</span>
  </a></li>`;

// Activación (salida de material a la gente)
const filaActivacion = (a) => `
  <li><a class="mat-orden" href="/material/activaciones/${a.id}" data-link>
    <span class="mat-orden__top"><strong>${a.folio}</strong><span class="estatus estatus--aprobado">${fmtNum(a.fotos)} fotos</span></span>
    <span class="mat-orden__quien"><strong>${esc(a.lugar)}</strong> · ${esc(FECHA_HORA.format(new Date(a.fecha)))}</span>
    <span class="mat-orden__quien">${a.evento ? `${TIPO_EV[a.evento.tipo] || 'Evento'} · ${esc(a.evento.lugar)}` : 'Fuera de agenda'}</span>
    <span class="mat-orden__items">${itemsTexto(a)}</span>
  </a></li>`;

const seccion = (titulo, contenido, extra = '') =>
  `<section class="mat-sec"><div class="mat-sec__head"><h3 class="promo-grupo__titulo">${titulo}</h3>${extra}</div>${contenido}</section>`;

// ===========================================================================
// Página principal
// ===========================================================================
export async function viewMaterial(route, params, state) {
  const r = await api('/api/material');
  route.data = r;
  const yo = state.me.user.id;
  const porRecibir = r.recibidas.filter((o) => o.estado === 'pendiente');
  // Fuera del CPV solo se listan los artículos que le han entregado
  if (!r.esCPV) r.inventario = r.inventario.filter((a) => a.recibido || a.porRecibir || a.repartido);
  const hayInventario = r.inventario.length > 0;

  const inventario = hayInventario
    ? `<div class="table-wrap"><table class="table mat-inv table--cards">
        <thead><tr><th scope="col">Artículo</th><th scope="col">Unidad</th>
          ${r.esCPV ? '<th scope="col" class="num">Inventario</th>' : '<th scope="col" class="num">Recibido</th>'}
          ${r.puedeEntregar ? '<th scope="col" class="num">Entregado</th><th scope="col" class="num">Disponible</th>' : ''}
          ${!r.esCPV ? '<th scope="col" class="num">Por recibir</th>' : ''}</tr></thead>
        <tbody>${r.inventario
          .map(
            (a) => `<tr><th scope="row">${esc(a.nombre)}</th><td>${esc(a.unidad)}</td>
              <td class="num">${fmtNum(r.esCPV ? a.entradas : a.recibido)}</td>
              ${r.puedeEntregar ? `<td class="num">${fmtNum(a.repartido)}</td><td class="num"><strong>${fmtNum(a.disponible)}</strong></td>` : ''}
              ${!r.esCPV ? `<td class="num">${a.porRecibir ? fmtNum(a.porRecibir) : '—'}</td>` : ''}</tr>`
          )
          .join('')}</tbody></table></div>`
    : `<div class="empty"><span aria-hidden="true">${ICONS.box}</span><strong>${r.esCPV ? 'Aún no hay artículos' : 'Aún no tienes material'}</strong>
        <span>${r.esCPV ? 'Da de alta tu primer artículo con el formulario de abajo.' : 'Aquí verás el material que te entreguen.'}</span></div>`;

  // Alta de artículos y entradas (solo CPV), en el área de trabajo
  const formsCPV = r.esCPV
    ? `<div class="mat-forms">
        <form class="card mat-form" id="fArticulo" novalidate>
          <h3>Nuevo artículo</h3>
          <div class="mat-form__row">
            <div class="field"><label for="maNombre">Nombre <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="maNombre" name="nombre" maxlength="80" placeholder="ej. Gorra" autocomplete="off"><p class="field__error" id="maNombre-err"></p></div>
            <div class="field"><label for="maUnidad">Unidad <span class="req" aria-hidden="true">*</span></label>
              <input class="input" id="maUnidad" name="unidad" maxlength="30" placeholder="ej. piezas" list="maUnidades" autocomplete="off"><p class="field__error" id="maUnidad-err"></p></div>
            <div class="field"><label for="maCantidad">Cantidad inicial</label>
              <input class="input num" id="maCantidad" name="cantidad" inputmode="numeric" placeholder="0" autocomplete="off"><p class="field__error" id="maCantidad-err"></p></div>
          </div>
          <datalist id="maUnidades"><option value="piezas"><option value="paquetes"><option value="cajas"><option value="rollos"><option value="millares"></datalist>
          <p class="form-error" id="maErr" role="alert"></p>
          <div class="mat-form__acc"><button class="btn" type="submit">${ICONS.plus}<span>Agregar artículo</span></button></div>
        </form>
        ${
          hayInventario
            ? `<form class="card mat-form" id="fEntrada" novalidate>
          <h3>Registrar entrada</h3>
          <div class="mat-form__row">
            <div class="field"><label for="meArticulo">Artículo <span class="req" aria-hidden="true">*</span></label>
              <select class="input" id="meArticulo" name="articuloId"><option value="">Elige…</option>${r.inventario
                .map((a) => `<option value="${a.id}">${esc(a.nombre)} (${esc(a.unidad)})</option>`)
                .join('')}</select><p class="field__error" id="meArticulo-err"></p></div>
            <div class="field"><label for="meCantidad">Cantidad <span class="req" aria-hidden="true">*</span></label>
              <input class="input num" id="meCantidad" name="cantidad" inputmode="numeric" autocomplete="off"><p class="field__error" id="meCantidad-err"></p></div>
          </div>
          <p class="form-error" id="meErr" role="alert"></p>
          <div class="mat-form__acc"><button class="btn btn--secondary" type="submit">${ICONS.plus}<span>Sumar al inventario</span></button></div>
        </form>`
            : ''
        }
      </div>`
    : '';

  // Avance de la rama (CPV: por zona · Coordinador de Zona: por responsable)
  const rama = r.rama.length
    ? `<div class="table-wrap"><table class="table mat-rama table--cards">
        <thead><tr><th scope="col">${r.esCPV ? 'Zona' : 'Responsable de Sección'}</th>
          <th scope="col" class="num">Unidades entregadas</th><th scope="col" class="num">Por recibir</th>
          ${r.esCPV ? '<th scope="col" class="num">Órdenes a sus responsables</th><th scope="col" class="num">Recibidas</th>' : '<th scope="col" class="num">Activaciones</th><th scope="col" class="num">Repartido a la gente</th>'}
        </tr></thead>
        <tbody>${r.rama
          .map((h) => {
            const total = (o) => o.pendiente + o.recibida + o.comprobada;
            const nombre = r.esCPV ? `${esc(h.zona || h.name)}<small>${esc(h.name)}</small>` : `${esc(h.name)}<small>${h.secciones.length ? `Sección ${h.secciones.map(fmtSeccion).join(', ')}` : 'Sin sección'}</small>`;
            return `<tr><th scope="row" class="mat-rama__nombre">${nombre}</th>
              <td class="num">${fmtNum(h.piezas)}</td>
              <td class="num">${h.ordenes.pendiente ? `<span class="mat-alerta">${fmtNum(h.ordenes.pendiente)}</span>` : '—'}</td>
              ${
                r.esCPV
                  ? `<td class="num">${fmtNum(total(h.abajo))}</td><td class="num">${total(h.abajo) ? `${fmtNum(h.abajo.recibida + h.abajo.comprobada)} de ${fmtNum(total(h.abajo))}` : '—'}</td>`
                  : `<td class="num">${fmtNum(h.activaciones || 0)}</td><td class="num">${fmtNum(h.repartidoGente || 0)}</td>`
              }</tr>`;
          })
          .join('')}</tbody></table></div>`
    : `<p class="muted">Aún no tienes ${r.esCPV ? 'zonas' : 'Responsables de Sección'} a quién entregar.</p>`;

  const ordenes = [...r.recibidas, ...r.emitidas].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Responsable de Sección: inventario (existencia y lo entregado a la gente) y, abajo, el tablero
  // «Por recibir | Activaciones»
  if (r.activa) {
    const inv = r.inventario.filter((a) => a.recibido || a.entregado);
    const tabla = inv.length
      ? `<div class="table-wrap"><table class="table mat-inv mat-inv--rs">
          <thead><tr><th scope="col">Artículo</th><th scope="col" class="num">En existencia</th><th scope="col" class="num">Entregados</th></tr></thead>
          <tbody>${inv
            .map((a) => `<tr><th scope="row">${esc(a.nombre)}</th><td class="num"><strong>${fmtNum(a.disponible)}</strong> <small>${esc(a.unidad)}</small></td><td class="num">${fmtNum(a.entregado)} <small>${esc(a.unidad)}</small></td></tr>`)
            .join('')}</tbody></table></div>`
      : `<div class="empty"><span aria-hidden="true">${ICONS.box}</span><strong>Aún no tienes material</strong><span>Cuando confirmes lo que te entreguen, aparecerá aquí.</span></div>`;
    const columna = (titulo, n, lista, vacio, accion = '') => `
      <section class="mat-col" aria-label="${titulo}">
        <header class="mat-col__head"><h3>${titulo}</h3><span class="mat-col__n">${fmtNum(n)}</span></header>
        ${accion}
        ${lista || `<p class="mat-col__vacio">${vacio}</p>`}
      </section>`;
    const recibidas = r.recibidas.filter((o) => o.estado !== 'pendiente');
    return `
      <div class="mat">
        ${seccion('Inventario', tabla)}
        <div class="mat-kanban">
          ${columna('Por recibir', porRecibir.length, porRecibir.length ? `<ul class="mat-lista">${porRecibir.map((o) => filaOrden(o, yo)).join('')}</ul>` : '', 'No tienes material por recibir.')}
          ${columna(
            'Activaciones',
            r.activaciones.length,
            r.activaciones.length ? `<ul class="mat-lista">${r.activaciones.map(filaActivacion).join('')}</ul>` : '',
            'Reporta aquí lo que repartes a la gente, con fecha, hora, lugar y mínimo 5 fotos.',
            `<a class="btn mat-col__btn" href="/material/activaciones/nueva" data-link>${ICONS.plus}<span>Nueva activación</span></a>`
          )}
        </div>
        ${
          recibidas.length
            ? `<details class="mat-hist"><summary>Órdenes recibidas <span class="muted">${fmtNum(recibidas.length)}</span></summary><ul class="mat-lista">${recibidas.map((o) => filaOrden(o, yo)).join('')}</ul></details>`
            : ''
        }
      </div>`;
  }

  return `
    <div class="mat">
      ${r.puedeEntregar ? `<div class="mat-acciones"><a class="btn" href="/material/entregar" data-link>${ICONS.box}<span>Nueva orden de entrega</span></a></div>` : ''}
      ${porRecibir.length ? seccion('Por recibir', `<ul class="mat-lista">${porRecibir.map((o) => filaOrden(o, yo)).join('')}</ul>`) : ''}
      ${seccion(r.esCPV ? 'Inventario' : 'Mi material', inventario)}
      ${formsCPV}
      ${r.puedeEntregar ? seccion(r.esCPV ? 'Avance por zona' : 'Avance por Responsable de Sección', rama) : ''}
      ${seccion('Órdenes de entrega', ordenes.length ? `<ul class="mat-lista">${ordenes.map((o) => filaOrden(o, yo)).join('')}</ul>` : '<p class="muted">Aún no hay órdenes de entrega.</p>')}
    </div>`;
}

export function mountMaterial(root, route) {
  const enviar = async (form, url, fields, errId, body) => {
    const setErrors = fieldErrorSetter(root, fields);
    setErrors();
    $(`#${errId}`, root).textContent = '';
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await api(url, { method: 'POST', body });
      return true;
    } catch (err) {
      setErrors(err.data?.fields || {});
      $(`#${errId}`, root).textContent = err.data?.fields ? '' : err.message;
      return false;
    } finally {
      btn.disabled = false;
    }
  };
  $('#fArticulo', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    if (await enviar(e.currentTarget, '/api/material/articulos', { nombre: 'maNombre', unidad: 'maUnidad', cantidad: 'maCantidad' }, 'maErr', body)) {
      toast(`Artículo «${body.nombre.trim()}» agregado`);
      navigate('/material');
    }
  });
  $('#fEntrada', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    if (await enviar(e.currentTarget, '/api/material/entradas', { articuloId: 'meArticulo', cantidad: 'meCantidad' }, 'meErr', body)) {
      toast('Entrada registrada');
      navigate('/material');
    }
  });
}

// ===========================================================================
// Nueva orden de entrega (CPV → zona · Coordinador de Zona → responsable)
// ===========================================================================
export async function viewEntregar(route, params, state) {
  const r = await api('/api/material');
  route.data = r;
  if (!r.puedeEntregar) return `<div class="empty"><strong>Tu nivel no entrega material</strong></div>`;
  const disponibles = r.inventario.filter((a) => a.disponible > 0);
  const destino = r.esCPV ? 'zona' : 'Responsable de Sección';
  return `
    <a class="back-link" href="/material" data-link>${ICONS.back}<span>Material electoral</span></a>
    <form class="card mat-entregar" id="fOrden" novalidate>
      <div class="field">
        <label for="moPara">Entregar a (${destino}) <span class="req" aria-hidden="true">*</span></label>
        <select class="input" id="moPara" name="paraId">
          <option value="">Elige…</option>
          ${r.rama
            .map((h) => `<option value="${h.id}">${esc(r.esCPV ? `${h.zona || 'Zona'} · ${h.name}` : `${h.name}${h.secciones.length ? ` · Sección ${h.secciones.map(fmtSeccion).join(', ')}` : ''}`)}</option>`)
            .join('')}
        </select>
        <p class="field__error" id="moPara-err"></p>
      </div>
      ${
        disponibles.length
          ? `<fieldset class="mat-items"><legend>Artículos y cantidades</legend>
          ${disponibles
            .map(
              (a) => `<div class="mat-item">
                <label for="mi-${a.id}"><strong>${esc(a.nombre)}</strong><small>Disponible: ${fmtNum(a.disponible)} ${esc(a.unidad)}</small></label>
                <input class="input num" id="mi-${a.id}" data-articulo="${a.id}" data-max="${a.disponible}" inputmode="numeric" placeholder="0" autocomplete="off">
                <p class="field__error" id="mi-${a.id}-err"></p>
              </div>`
            )
            .join('')}
          <p class="field__error" id="moItems-err"></p>
        </fieldset>`
          : `<div class="empty"><strong>No tienes material disponible</strong><span>${r.esCPV ? 'Registra entradas en tu inventario.' : 'Confirma lo que te entregaron o espera nuevo material.'}</span></div>`
      }
      <div class="field">
        <label for="moNota">Nota (opcional)</label>
        <input class="input" id="moNota" name="nota" maxlength="300" placeholder="ej. Para el evento del sábado" autocomplete="off">
      </div>
      <p class="form-error" id="moErr" role="alert"></p>
      <div class="mat-form__acc">
        <a class="btn btn--secondary" href="/material" data-link>Cancelar</a>
        <button class="btn" type="submit" ${disponibles.length ? '' : 'disabled'}>Crear orden de entrega</button>
      </div>
    </form>`;
}

export function mountEntregar(root) {
  const form = $('#fOrden', root);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const p of root.querySelectorAll('.field__error, .form-error')) p.textContent = '';
    const items = [...root.querySelectorAll('[data-articulo]')]
      .map((i) => ({ articuloId: i.dataset.articulo, cantidad: i.value.trim() }))
      .filter((i) => i.cantidad !== '' && i.cantidad !== '0');
    let ok = true;
    if (!$('#moPara', root).value) {
      $('#moPara-err', root).textContent = 'Elige a quién se entrega.';
      ok = false;
    }
    for (const i of items) {
      const inp = $(`#mi-${i.articuloId}`, root);
      const n = Number(i.cantidad.replace(/,/g, ''));
      if (!Number.isInteger(n) || n <= 0) {
        $(`#mi-${i.articuloId}-err`, root).textContent = 'Escribe un número entero.';
        ok = false;
      } else if (n > Number(inp.dataset.max)) {
        $(`#mi-${i.articuloId}-err`, root).textContent = `Máximo ${fmtNum(inp.dataset.max)}.`;
        ok = false;
      }
    }
    if (!items.length) {
      $('#moItems-err', root).textContent = 'Escribe la cantidad de al menos un artículo.';
      ok = false;
    }
    if (!ok) return;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const r = await api('/api/material/ordenes', { method: 'POST', body: { paraId: $('#moPara', root).value, nota: $('#moNota', root).value, items } });
      toast(`Orden ${r.folio} creada`);
      navigate(`/material/ordenes/${r.id}`);
    } catch (err) {
      const f = err.data?.fields || {};
      if (f.paraId) $('#moPara-err', root).textContent = f.paraId;
      if (f.items) $('#moItems-err', root).textContent = f.items;
      for (const [id, msg] of Object.entries(f.porArticulo || {})) {
        const p = $(`#mi-${id}-err`, root);
        if (p) p.textContent = msg;
      }
      $('#moErr', root).textContent = err.message;
      btn.disabled = false;
    }
  });
}

// ===========================================================================
// Ficha de la orden: artículos, recepción, evidencia (fotos)
// ===========================================================================
export async function viewOrden(route, params) {
  const o = await api(`/api/material/ordenes/${params[0]}`);
  route.orden = o;
  const linea = (t, v) => (v ? `<div><dt>${t}</dt><dd>${v}</dd></div>` : '');
  return `
    <a class="back-link" href="/material" data-link>${ICONS.back}<span>Material electoral</span></a>
    <div class="mat-ficha">
      <section class="card">
        <div class="mat-ficha__head"><h2>${o.folio}</h2>${chip(o)}</div>
        <dl class="mat-datos">
          ${linea('Entrega', esc(o.de.name))}
          ${linea('Recibe', esc(o.para.name))}
          ${linea('Creada', esc(fmtDateTime(o.createdAt)))}
          ${linea('Recibida', o.recibidaAt ? esc(fmtDateTime(o.recibidaAt)) : '')}
          ${linea('Nota', esc(o.nota))}
        </dl>
        <table class="table mat-ficha__items">
          <thead><tr><th scope="col">Artículo</th><th scope="col" class="num">Cantidad</th></tr></thead>
          <tbody>${o.items.map((i) => `<tr><th scope="row">${esc(i.nombre)}</th><td class="num">${fmtNum(i.cantidad)} ${esc(i.unidad)}</td></tr>`).join('')}</tbody>
        </table>
        ${o.puedeRecibir ? `<div class="mat-form__acc"><button class="btn" type="button" id="moRecibir">Recibido</button></div>` : ''}
        ${o.puedeCancelar ? `<div class="mat-form__acc"><button class="btn btn--secondary" type="button" id="moCancelar">Cancelar orden</button></div>` : ''}
      </section>

      ${
        o.evidencias.length
          ? `<section class="card mat-evid">
        <h3>Fotos de evidencia <span class="muted">${fmtNum(o.evidencias.length)}</span></h3>
        <div class="mat-galeria">${o.evidencias
          .map((f) => `<a href="/api/material/evidencias/${f.id}" target="_blank" rel="noopener"><img src="/api/material/evidencias/${f.id}" alt="Foto de evidencia" loading="lazy"></a>`)
          .join('')}</div>
      </section>`
          : ''
      }
    </div>`;
}

// Reduce la foto a JPEG de máximo 1600 px (las del celular pesan varios MB)
export async function aJpeg(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const img =
    bmp ||
    (await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = URL.createObjectURL(file);
    }));
  const w = img.width;
  const h = img.height;
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

export function mountOrden(root, route) {
  const o = route.orden;
  const recargar = () => navigate(location.pathname);
  $('#moRecibir', root)?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api(`/api/material/ordenes/${o.id}/recibir`, { method: 'POST' });
      toast('Material recibido');
      recargar();
    } catch (err) {
      toast(err.message);
      e.currentTarget.disabled = false;
    }
  });
  // Cancelar en dos toques (sin ventanas modales)
  $('#moCancelar', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.confirmar) {
      b.dataset.confirmar = '1';
      b.textContent = '¿Seguro? Toca de nuevo para cancelar';
      b.classList.add('btn--destructive');
      return;
    }
    b.disabled = true;
    try {
      await api(`/api/material/ordenes/${o.id}`, { method: 'DELETE' });
      toast(`Orden ${o.folio} cancelada`);
      navigate('/material');
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  });

}

// ===========================================================================
// Activaciones del Responsable de Sección: salida de material a la gente
// ===========================================================================
export async function viewNuevaActivacion(route) {
  const o = await api('/api/material/activaciones/opciones');
  route.opciones = o;
  const hoy = DIA_KEY.format(new Date());
  const ahora = HHMM.format(new Date());
  if (!o.inventario.length) {
    return `
      <a class="back-link" href="/material" data-link>${ICONS.back}<span>Material electoral</span></a>
      <div class="empty"><span aria-hidden="true">${ICONS.box}</span><strong>No tienes material en existencia</strong>
        <span>Confirma lo que te entregaron para poder repartirlo.</span></div>`;
  }
  return `
    <a class="back-link" href="/material" data-link>${ICONS.back}<span>Material electoral</span></a>
    <form class="card mat-entregar mat-act" id="fAct" novalidate>
      <div class="field">
        <label for="acEvento">Evento de la agenda</label>
        <select class="input" id="acEvento" name="eventoId">
          <option value="">Fuera de agenda</option>
          ${o.eventos
            .map((e) => `<option value="${e.id}">${esc(`${FECHA_HORA.format(new Date(e.inicio))} · ${e.tipoTexto} · ${e.lugar}`)}</option>`)
            .join('')}
        </select>
        <p class="field__help">Solo eventos que ya ocurrieron.</p>
        <p class="field__error" id="acEvento-err"></p>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="acFecha">Fecha <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="acFecha" name="fecha" type="date" max="${hoy}" value="${hoy}" required>
          <p class="field__error" id="acFecha-err"></p>
        </div>
        <div class="field">
          <label for="acHora">Hora <span class="req" aria-hidden="true">*</span></label>
          <input class="input" id="acHora" name="hora" type="time" value="${ahora}" required>
          <p class="field__error" id="acHora-err"></p>
        </div>
      </div>
      <div class="field">
        <label for="acLugar">Lugar <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="acLugar" name="lugar" maxlength="160" placeholder="ej. Parque central de la colonia" autocomplete="off" required>
        <p class="field__error" id="acLugar-err"></p>
      </div>
      <fieldset class="mat-items"><legend>¿Qué repartiste?</legend>
        ${o.inventario
          .map(
            (a) => `<div class="mat-item">
              <label for="mi-${a.id}"><strong>${esc(a.nombre)}</strong><small>En existencia: ${fmtNum(a.disponible)} ${esc(a.unidad)}</small></label>
              <input class="input num" id="mi-${a.id}" data-articulo="${a.id}" data-max="${a.disponible}" inputmode="numeric" placeholder="0" autocomplete="off">
              <p class="field__error" id="mi-${a.id}-err"></p>
            </div>`
          )
          .join('')}
        <p class="field__error" id="acItems-err"></p>
      </fieldset>
      <div class="field mat-subir">
        <span class="field__label">Fotos de evidencia <span class="req" aria-hidden="true">*</span></span>
        <input type="file" id="acFotos" accept="image/*" multiple hidden>
        <div class="mat-previas" id="acPrevias"></div>
        <p class="field__help" id="acFotosHelp">Sube mínimo ${o.minFotos} fotos de la gente recibiendo el material.</p>
        <p class="field__error" id="acFotos-err"></p>
        <div><button class="btn btn--secondary" type="button" id="acElegir">${ICONS.camera}<span>Tomar o elegir fotos</span></button></div>
      </div>
      <div class="field">
        <label for="acNota">Nota (opcional)</label>
        <input class="input" id="acNota" name="nota" maxlength="300" autocomplete="off">
      </div>
      <p class="form-error" id="acErr" role="alert"></p>
      <div class="mat-form__acc">
        <a class="btn btn--secondary" href="/material" data-link>Cancelar</a>
        <button class="btn" type="submit">Reportar activación</button>
      </div>
    </form>`;
}

export function mountNuevaActivacion(root, route) {
  const form = $('#fAct', root);
  const o = route.opciones;
  if (!form || !o) return;
  // Al elegir un evento se proponen su fecha, hora y lugar (se pueden ajustar)
  $('#acEvento', root).addEventListener('change', (e) => {
    const ev = o.eventos.find((x) => x.id === e.target.value);
    if (!ev) return;
    const d = new Date(ev.inicio);
    $('#acFecha', root).value = DIA_KEY.format(d);
    $('#acHora', root).value = HHMM.format(d);
    $('#acLugar', root).value = ev.lugar;
  });

  const fotos = [];
  const input = $('#acFotos', root);
  const previas = $('#acPrevias', root);
  const errFotos = $('#acFotos-err', root);
  const pintar = () => {
    previas.innerHTML = fotos
      .map((f, i) => `<figure><img src="${f}" alt="Foto ${i + 1}"><button class="icon-btn" type="button" data-quitar="${i}" aria-label="Quitar foto ${i + 1}">${ICONS.close}</button></figure>`)
      .join('');
    $('#acFotosHelp', root).textContent =
      fotos.length < o.minFotos ? `Llevas ${fotos.length} de ${o.minFotos} fotos mínimas.` : `Listo: ${fotos.length} fotos. Puedes agregar más (máximo ${o.maxFotos}).`;
  };
  $('#acElegir', root).addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    errFotos.textContent = '';
    for (const f of input.files) {
      if (fotos.length >= o.maxFotos) {
        errFotos.textContent = `Máximo ${o.maxFotos} fotos.`;
        break;
      }
      try {
        fotos.push(await aJpeg(f));
      } catch {
        errFotos.textContent = 'Alguna foto no se pudo leer.';
      }
    }
    input.value = '';
    pintar();
  });
  previas.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    fotos.splice(Number(b.dataset.quitar), 1);
    pintar();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const p of root.querySelectorAll('.field__error, .form-error')) p.textContent = '';
    const items = [...root.querySelectorAll('[data-articulo]')]
      .map((i) => ({ articuloId: i.dataset.articulo, cantidad: i.value.trim() }))
      .filter((i) => i.cantidad !== '' && i.cantidad !== '0');
    let ok = true;
    for (const i of items) {
      const n = Number(i.cantidad.replace(/,/g, ''));
      const max = Number($(`#mi-${i.articuloId}`, root).dataset.max);
      if (!Number.isInteger(n) || n <= 0) ($(`#mi-${i.articuloId}-err`, root).textContent = 'Escribe un número entero.'), (ok = false);
      else if (n > max) ($(`#mi-${i.articuloId}-err`, root).textContent = `Máximo ${fmtNum(max)}.`), (ok = false);
    }
    if (!items.length) ($('#acItems-err', root).textContent = 'Escribe cuánto repartiste de al menos un artículo.'), (ok = false);
    if (!$('#acLugar', root).value.trim()) ($('#acLugar-err', root).textContent = 'Escribe el lugar donde se repartió.'), (ok = false);
    if (fotos.length < o.minFotos) (errFotos.textContent = `Sube mínimo ${o.minFotos} fotos (llevas ${fotos.length}).`), (ok = false);
    if (!ok) return root.querySelector('.field__error:not(:empty)')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const body = { ...Object.fromEntries(new FormData(form)), items, fotos };
      const r = await api('/api/material/activaciones', { method: 'POST', body });
      toast(`Activación ${r.folio} reportada`);
      navigate('/material');
    } catch (err) {
      const f = err.data?.fields || {};
      const ids = { eventoId: 'acEvento', fecha: 'acFecha', hora: 'acHora', lugar: 'acLugar', items: 'acItems', fotos: 'acFotos' };
      for (const [k, id] of Object.entries(ids)) if (f[k]) $(`#${id}-err`, root).textContent = f[k];
      for (const [id, msg] of Object.entries(f.porArticulo || {})) {
        const p = $(`#mi-${id}-err`, root);
        if (p) p.textContent = msg;
      }
      $('#acErr', root).textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Reportar activación';
    }
  });
}

export async function viewActivacion(route, params) {
  const a = await api(`/api/material/activaciones/${params[0]}`);
  const linea = (t, v) => (v ? `<div><dt>${t}</dt><dd>${v}</dd></div>` : '');
  return `
    <a class="back-link" href="/material" data-link>${ICONS.back}<span>Material electoral</span></a>
    <div class="mat-ficha">
      <section class="card">
        <div class="mat-ficha__head"><h2>${a.folio}</h2><span class="estatus estatus--aprobado">Activación</span></div>
        <dl class="mat-datos">
          ${linea('Reportó', esc(a.por.name))}
          ${linea('Fecha y hora', esc(FECHA_HORA.format(new Date(a.fecha))))}
          ${linea('Lugar', esc(a.lugar))}
          ${linea('Evento', a.evento ? `<a href="/agenda/eventos/${a.evento.id}" data-link>${esc(`${TIPO_EV[a.evento.tipo] || 'Evento'} · ${a.evento.lugar}`)}</a>` : 'Fuera de agenda')}
          ${linea('Nota', esc(a.nota))}
        </dl>
        <table class="table mat-ficha__items">
          <thead><tr><th scope="col">Artículo</th><th scope="col" class="num">Repartido</th></tr></thead>
          <tbody>${a.items.map((i) => `<tr><th scope="row">${esc(i.nombre)}</th><td class="num">${fmtNum(i.cantidad)} ${esc(i.unidad)}</td></tr>`).join('')}</tbody>
        </table>
      </section>
      <section class="card mat-evid">
        <h3>Fotos de evidencia <span class="muted">${fmtNum(a.fotosIds.length)}</span></h3>
        <div class="mat-galeria">${a.fotosIds
          .map((id) => `<a href="/api/material/activaciones/fotos/${id}" target="_blank" rel="noopener"><img src="/api/material/activaciones/fotos/${id}" alt="Foto de la activación" loading="lazy"></a>`)
          .join('')}</div>
      </section>
    </div>`;
}
