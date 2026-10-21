// Mi sección (Responsable de Sección y Promotor Territorial): solo el mapa de su sección
import { ICONS, api, fmtSeccion } from './lib.js';
import { baseMap } from './zonas.js';

export async function viewMiSeccion(route) {
  const d = await api('/api/mi-seccion');
  route.data = d;
  if (!d.feature) {
    return `<div class="empty"><span aria-hidden="true">${ICONS.map}</span><strong>${d.seccion === null ? 'Aún no tienes sección asignada' : 'El mapa de tu sección no está disponible'}</strong>
      <span>${d.seccion === null ? 'Debe asignarse una sección a la estructura.' : 'Avísale a tu coordinador.'}</span></div>`;
  }
  return `<div class="ms-mapa" id="msMapa" role="region" aria-label="Mapa de la sección ${fmtSeccion(d.seccion)}"></div>`;
}

export function mountMiSeccion(root, route) {
  const d = route.data;
  const el = root.querySelector('#msMapa');
  if (!el || !d?.feature) return null;
  const { map, destroy } = baseMap(el);
  const capa = L.geoJSON(d.feature, { style: { color: '#16a34a', weight: 3, opacity: 1, fillColor: '#16a34a', fillOpacity: 0.12 }, interactive: false }).addTo(map);
  capa.eachLayer((l) =>
    l.bindTooltip(`Sección ${fmtSeccion(d.seccion)}`, { permanent: true, direction: 'center', className: 'ms-etiqueta' })
  );
  map.fitBounds(capa.getBounds(), { padding: [24, 24] });
  return destroy;
}
