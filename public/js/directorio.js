// Directorio del CPV: todas las personas de su estructura (coordinadores de zona, responsables
// de sección y promotores) con su zona, sección, de quién dependen y cómo contactarlas.
import { $, esc, initials, fmtNum, fmtSeccion, api, toast, ICONS } from './lib.js';
import { I as CI } from './coordinador.js';

const NIVELES = [
  { key: '', name: 'Todos' },
  { key: 'coord_zona', name: 'Coordinadores de zona', uno: 'Coordinador de zona' },
  { key: 'resp_seccion', name: 'Responsables de sección', uno: 'Responsable de sección' },
  { key: 'promotor', name: 'Promotores', uno: 'Promotor territorial' },
];
const NOMBRE_NIVEL = Object.fromEntries(NIVELES.filter((n) => n.key).map((n) => [n.key, n.uno]));
const POR_PAGINA = 60;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function viewDirectorio(route) {
  route.data = await api('/api/directorio');
  const d = route.data;
  if (!d.personas.length) {
    return `<div class="empty"><span aria-hidden="true">${CI.user}</span><strong>Tu estructura aún está vacía</strong>
      <span>Cuando crees zonas y tus coordinadores den de alta a su equipo, aquí aparecerán todos con sus datos de contacto.</span></div>`;
  }
  const q = new URLSearchParams(location.search);
  const cuenta = (k) => d.personas.filter((p) => !k || p.role === k).length;
  return `
    <div class="dir">
      <div class="page-head"><p>Todas las personas de tu estructura con su zona, sección y datos de contacto.</p></div>
      <div class="dir__niveles" role="radiogroup" aria-label="Nivel">
        ${NIVELES.map(
          (n) => `<label class="dir__nivel"><input type="radio" name="nivel" value="${n.key}" ${(q.get('nivel') || '') === n.key ? 'checked' : ''}>
            <span>${esc(n.name)} <b>${fmtNum(cuenta(n.key))}</b></span></label>`
        ).join('')}
      </div>
      <div class="dir__barra">
        <div class="input-icon dir__buscar"><span aria-hidden="true">${ICONS.search}</span>
          <input class="input" id="dirQ" type="search" placeholder="Buscar por nombre, usuario, teléfono o sección" aria-label="Buscar en el directorio" value="${esc(q.get('q') || '')}" autocomplete="off"></div>
        <select class="input dir__zona" id="dirZona" aria-label="Zona">
          <option value="">Todas las zonas</option>
          ${d.zonas.map((z) => `<option value="${esc(z.id)}" ${q.get('zona') === z.id ? 'selected' : ''}>${esc(z.codigo)} · ${esc(z.nombre)}</option>`).join('')}
        </select>
        <button class="btn btn--secondary" type="button" id="dirCsv">Descargar</button>
      </div>
      <p class="dir__total" id="dirTotal" aria-live="polite"></p>
      <ul class="card dir__lista" id="dirLista"></ul>
      <div class="dir__mas"><button class="btn btn--secondary" type="button" id="dirMas" hidden>Ver más</button></div>
    </div>`;
}

export function mountDirectorio(root, route) {
  const d = route.data;
  if (!d?.personas.length) return undefined;
  const zonas = new Map(d.zonas.map((z) => [z.id, z]));
  let filtradas = [];
  let mostradas = 0;

  const fila = (p) => {
    const z = zonas.get(p.zona);
    const tel = String(p.phone || '').replace(/\D/g, '').slice(-10);
    const detalle = [
      z ? `<span class="dir__chip" style="--zc:${esc(z.color)}">${esc(z.codigo)}</span>` : '',
      p.seccion !== null && p.seccion !== undefined ? `Sección ${esc(fmtSeccion(p.seccion))}` : '',
      p.jefe ? `Depende de ${esc(p.jefe)}` : '',
    ].filter(Boolean).join(' · ');
    const cifras =
      p.role === 'coord_zona'
        ? `${fmtNum(p.equipo)} ${p.equipo === 1 ? 'responsable' : 'responsables'} · ${fmtNum(p.promovidos)} promovidos`
        : p.role === 'resp_seccion'
          ? `${fmtNum(p.equipo)} ${p.equipo === 1 ? 'promotor' : 'promotores'} · ${fmtNum(p.promovidos)} promovidos`
          : `${fmtNum(p.promovidos)} promovidos · ${fmtNum(p.aprobados)} ${p.aprobados === 1 ? 'aprobado' : 'aprobados'}`;
    return `<li class="dir__fila">
      <span class="dir__ini" style="--zc:${esc(z?.color || '#94a3b8')}" aria-hidden="true">${p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="" loading="lazy">` : esc(initials(p.name))}</span>
      <div class="dir__txt">
        <p class="dir__nombre"><strong>${esc(p.name)}</strong> <span class="dir__rol dir__rol--${esc(p.role)}">${esc(NOMBRE_NIVEL[p.role])}</span></p>
        <p class="dir__det">${detalle}</p>
        <p class="dir__det">${cifras}${p.username ? ` · <span class="mono">@${esc(p.username)}</span>` : ''}</p>
      </div>
      <span class="promo-contacto">${
        tel
          ? `<a class="icon-btn promo-contacto__btn" href="tel:+52${tel}" title="Llamar" aria-label="Llamar a ${esc(p.name)}">${CI.phone}</a>
             <a class="icon-btn promo-contacto__btn" href="https://wa.me/52${tel}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp con ${esc(p.name)}">${CI.whatsapp}</a>`
          : `<span class="icon-btn promo-contacto__btn is-off" title="Sin teléfono" aria-label="Sin teléfono">${CI.phone}</span>`
      }${p.email ? `<a class="icon-btn promo-contacto__btn" href="mailto:${esc(p.email)}" title="Correo" aria-label="Correo a ${esc(p.name)}">${CI.mail}</a>` : ''}</span>
    </li>`;
  };

  const lista = $('#dirLista', root);
  const mas = $('#dirMas', root);
  const pintarMas = () => {
    lista.insertAdjacentHTML('beforeend', filtradas.slice(mostradas, mostradas + POR_PAGINA).map(fila).join(''));
    mostradas = Math.min(filtradas.length, mostradas + POR_PAGINA);
    mas.hidden = mostradas >= filtradas.length;
    mas.textContent = `Ver más (${fmtNum(filtradas.length - mostradas)} restantes)`;
  };

  const aplicar = () => {
    const nivel = root.querySelector('input[name="nivel"]:checked')?.value || '';
    const zona = $('#dirZona', root).value;
    const q = norm($('#dirQ', root).value.trim());
    const qDigitos = q.replace(/\D/g, '');
    filtradas = d.personas.filter(
      (p) =>
        (!nivel || p.role === nivel) &&
        (!zona || p.zona === zona) &&
        (!q ||
          norm(p.name).includes(q) ||
          norm(p.username).includes(q) ||
          (qDigitos && (String(p.phone || '').includes(qDigitos) || (p.seccion !== null && String(p.seccion).padStart(4, '0').includes(qDigitos)))))
    );
    $('#dirTotal', root).textContent = `${fmtNum(filtradas.length)} ${filtradas.length === 1 ? 'persona' : 'personas'}`;
    lista.innerHTML = filtradas.length ? '' : '<li class="dir__vacio">Nadie coincide con los filtros.</li>';
    mostradas = 0;
    if (filtradas.length) pintarMas();
    else mas.hidden = true;
    // Los filtros quedan en la dirección: al regresar a la página se conservan
    const u = new URLSearchParams();
    if (nivel) u.set('nivel', nivel);
    if (zona) u.set('zona', zona);
    if (q) u.set('q', $('#dirQ', root).value.trim());
    history.replaceState(null, '', `/directorio${u.toString() ? `?${u}` : ''}`);
  };

  let espera = 0;
  root.querySelector('.dir__niveles').addEventListener('change', aplicar);
  $('#dirZona', root).addEventListener('change', aplicar);
  $('#dirQ', root).addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(aplicar, 180);
  });
  mas.addEventListener('click', pintarMas);
  // Carga continua al llegar al final de la lista
  const io = new IntersectionObserver((e) => {
    if (e[0].isIntersecting && !mas.hidden) pintarMas();
  }, { rootMargin: '400px' });
  io.observe(mas);

  // Descarga de lo filtrado (CSV para Excel)
  $('#dirCsv', root).addEventListener('click', () => {
    const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [['Nombre', 'Nivel', 'Zona', 'Sección', 'Depende de', 'Teléfono', 'Correo', 'Usuario', 'Promovidos', 'Aprobados']];
    for (const p of filtradas) {
      const z = zonas.get(p.zona);
      filas.push([p.name, NOMBRE_NIVEL[p.role], z ? `${z.codigo} ${z.nombre}` : '', p.seccion !== null ? fmtSeccion(p.seccion) : '', p.jefe || '', p.phone, p.email, p.username || '', p.promovidos, p.aprobados]);
    }
    const blob = new Blob([`﻿${filas.map((f) => f.map(celda).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `directorio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Directorio descargado (${fmtNum(filtradas.length)} personas)`);
  });

  aplicar();
  return () => io.disconnect();
}
