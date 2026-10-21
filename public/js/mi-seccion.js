// Mi sección (Responsable de Sección y Promotor Territorial): el mapa de su sección con los puntos
// de interés del equipo (naranja) y la ubicación de las casillas (verde, solo el Responsable las ubica).
// Para agregar uno: botón → tocar el mapa (el pin se puede arrastrar) → nombre y descripción debajo.
import { ICONS, api, esc, fmtSeccion, fmtDateTime, toast } from './lib.js';
import { baseMap } from './zonas.js';

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICO = {
  interes: svg('<path d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/>'),
  // Urna: caja con la boleta entrando por la ranura
  casilla: svg('<path d="M3 13h18v8H3z"/><path d="M7 13V4h10v9"/><path d="M10 8h4"/><path d="M8 17h8"/>'),
};
const TIPO = {
  interes: { color: '#ea580c', titulo: 'Punto de interés', boton: 'Crear punto de interés' },
  casilla: { color: '#16a34a', titulo: 'Casilla', boton: 'Ubicar casilla' },
};
const pin = (tipo) =>
  L.divIcon({
    className: 'ms-pin',
    html: `<span class="ms-pin__in" style="--c:${TIPO[tipo].color}">${ICO[tipo]}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -32],
  });

export async function viewMiSeccion(route) {
  const d = await api('/api/mi-seccion');
  route.data = d;
  if (!d.feature) {
    return `<div class="empty"><span aria-hidden="true">${ICONS.map}</span><strong>${d.seccion === null ? 'Aún no tienes sección asignada' : 'El mapa de tu sección no está disponible'}</strong>
      <span>${d.seccion === null ? 'Debe asignarse una sección a la estructura.' : 'Avísale a tu coordinador.'}</span></div>`;
  }
  const boton = (tipo) =>
    `<button class="btn ms-btn ms-btn--${tipo}" type="button" data-nuevo="${tipo}">${ICO[tipo]}<span>${TIPO[tipo].boton}</span></button>`;
  return `
    <div class="ms" id="ms">
      <div class="ms-acciones">${boton('interes')}${d.puedeCasilla ? boton('casilla') : ''}</div>
      <p class="ms-aviso" id="msAviso" role="status" hidden></p>
      <div class="ms-mapa" id="msMapa" role="region" aria-label="Mapa de la sección ${fmtSeccion(d.seccion)}"></div>
      <form class="card ms-form" id="msForm" novalidate hidden>
        <h3 id="msFormT"></h3>
        <div class="field">
          <label for="msNombre" id="msNombreL">Nombre</label>
          <input class="input" id="msNombre" name="nombre" maxlength="80" autocomplete="off">
          <p class="field__error" id="msNombre-err"></p>
        </div>
        <div class="field">
          <label for="msDesc">Descripción</label>
          <textarea class="input textarea" id="msDesc" name="descripcion" rows="3" maxlength="500"></textarea>
        </div>
        <p class="form-error" id="msErr" role="alert"></p>
        <div class="ms-form__acc">
          <button class="btn btn--secondary" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Guardar</button>
        </div>
      </form>
    </div>`;
}

export function mountMiSeccion(root, route) {
  const d = route.data;
  const el = root.querySelector('#msMapa');
  if (!el || !d?.feature) return null;
  const { map, destroy } = baseMap(el);
  const capa = L.geoJSON(d.feature, { style: { color: '#16a34a', weight: 3, opacity: 1, fillColor: '#16a34a', fillOpacity: 0.12 }, interactive: false }).addTo(map);
  capa.eachLayer((l) => l.bindTooltip(`Sección ${fmtSeccion(d.seccion)}`, { permanent: true, direction: 'center', className: 'ms-etiqueta' }));
  map.fitBounds(capa.getBounds(), { padding: [24, 24] });

  // --- Puntos guardados
  const marcas = new Map();
  const popup = (p) => `
    <div class="ms-pop">
      <span class="ms-pop__tipo" style="color:${TIPO[p.tipo].color}">${TIPO[p.tipo].titulo}</span>
      <strong>${esc(p.nombre)}</strong>
      ${p.descripcion ? `<p>${esc(p.descripcion).replace(/\n/g, '<br>')}</p>` : ''}
      <small>${esc(p.autor)} · ${esc(fmtDateTime(p.createdAt))}</small>
      ${p.puedeBorrar ? `<button class="link-btn ms-pop__borrar" type="button" data-borrar="${p.id}">Borrar</button>` : ''}
    </div>`;
  const pintar = (p) => {
    const m = L.marker([p.lat, p.lng], { icon: pin(p.tipo), title: `${TIPO[p.tipo].titulo}: ${p.nombre}`, alt: `${TIPO[p.tipo].titulo}: ${p.nombre}` })
      .bindPopup(popup(p))
      .addTo(map);
    marcas.set(p.id, m);
  };
  d.puntos.forEach(pintar);

  // Borrar en dos toques (sin ventanas emergentes)
  map.on('popupopen', (e) => {
    const b = e.popup.getElement()?.querySelector('[data-borrar]');
    if (!b) return;
    b.addEventListener('click', async () => {
      if (!b.dataset.confirmar) {
        b.dataset.confirmar = '1';
        b.textContent = '¿Seguro? Toca de nuevo para borrar';
        return;
      }
      b.disabled = true;
      try {
        await api(`/api/mi-seccion/puntos/${b.dataset.borrar}`, { method: 'DELETE' });
        map.removeLayer(marcas.get(b.dataset.borrar));
        marcas.delete(b.dataset.borrar);
        toast('Punto borrado');
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    });
  });

  // --- Nuevo punto: tocar el mapa, ajustar el pin y escribir nombre y descripción
  const wrap = root.querySelector('#ms');
  const aviso = root.querySelector('#msAviso');
  const form = root.querySelector('#msForm');
  let nuevo = null; // { tipo, marker }
  const terminar = () => {
    if (nuevo?.marker) map.removeLayer(nuevo.marker);
    nuevo = null;
    form.hidden = true;
    aviso.hidden = true;
    wrap.classList.remove('is-colocando', 'is-editando');
    root.querySelectorAll('[data-nuevo]').forEach((b) => b.removeAttribute('aria-pressed'));
    setTimeout(() => map.invalidateSize(), 0);
  };
  const colocar = (latlng) => {
    if (!nuevo) return;
    if (nuevo.marker) nuevo.marker.setLatLng(latlng);
    else nuevo.marker = L.marker(latlng, { icon: pin(nuevo.tipo), draggable: true, autoPan: true }).addTo(map);
    aviso.textContent = 'Arrastra el pin para ajustarlo. Escribe los datos debajo del mapa.';
    wrap.classList.remove('is-colocando');
    wrap.classList.add('is-editando');
    form.hidden = false;
    setTimeout(() => {
      map.invalidateSize();
      map.panTo(nuevo.marker.getLatLng());
      form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 0);
  };
  map.on('click', (e) => colocar(e.latlng));

  root.querySelectorAll('[data-nuevo]').forEach((b) =>
    b.addEventListener('click', () => {
      const tipo = b.dataset.nuevo;
      terminar();
      nuevo = { tipo, marker: null };
      b.setAttribute('aria-pressed', 'true');
      wrap.classList.add('is-colocando');
      aviso.hidden = false;
      aviso.textContent = tipo === 'casilla' ? 'Toca en el mapa dónde está la casilla.' : 'Toca en el mapa dónde va el punto de interés.';
      root.querySelector('#msFormT').textContent = tipo === 'casilla' ? 'Nueva casilla' : 'Nuevo punto de interés';
      root.querySelector('#msNombreL').innerHTML = tipo === 'casilla' ? 'Nombre (opcional)' : 'Nombre <span class="req" aria-hidden="true">*</span>';
      root.querySelector('#msNombre').placeholder = tipo === 'casilla' ? 'ej. Básica, Contigua 1' : 'ej. Tienda de la esquina';
      root.querySelector('#msDesc').placeholder = tipo === 'casilla' ? 'ej. Escuela primaria Benito Juárez, entrada por la calle 5' : 'Por qué es importante, referencias…';
      form.reset();
      root.querySelector('#msNombre-err').textContent = '';
      root.querySelector('#msErr').textContent = '';
    })
  );
  form.querySelector('[data-cancelar]').addEventListener('click', terminar);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nuevo?.marker) return;
    const errNombre = root.querySelector('#msNombre-err');
    const nombre = root.querySelector('#msNombre').value.trim();
    errNombre.textContent = '';
    root.querySelector('#msErr').textContent = '';
    if (nuevo.tipo === 'interes' && nombre.length < 2) return (errNombre.textContent = 'Escribe el nombre del punto.');
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const { lat, lng } = nuevo.marker.getLatLng();
      const p = await api('/api/mi-seccion/puntos', { method: 'POST', body: { tipo: nuevo.tipo, nombre, descripcion: root.querySelector('#msDesc').value, lat, lng } });
      terminar();
      pintar(p);
      toast(p.tipo === 'casilla' ? 'Casilla ubicada' : 'Punto de interés guardado');
    } catch (err) {
      errNombre.textContent = err.data?.fields?.nombre || '';
      root.querySelector('#msErr').textContent = err.data?.fields?.ubicacion || (err.data?.fields ? '' : err.message);
    } finally {
      btn.disabled = false;
    }
  });

  return destroy;
}
