// Promovidos del Promotor Territorial: captura (INE + datos + domicilio) y lista.
// La sección y la vigencia se validan aquí para avisar al momento, y de nuevo en el servidor.
import { ICONS, $, esc, fmtNum, fmtDate, api, fieldErrorSetter, submitWith, toast } from './lib.js';
import { I, debounce } from './coordinador.js';

const sinSeccion = (msg) => `
  <div class="empty">
    <span aria-hidden="true">${ICONS.map}</span>
    <strong>Aún no puedes capturar promovidos</strong>
    <span>${esc(msg)}</span>
  </div>`;

// Foto de la INE: se reduce a 1600 px y JPEG para que suba rápido desde el celular
function comprimir(file, max = 1600, calidad = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

const campoFoto = (id, label) => `
  <div class="field">
    <span class="field__label" id="${id}-label">${label} <span class="req" aria-hidden="true">*</span></span>
    <label class="ine-shot" id="${id}Box">
      <input type="file" accept="image/*" capture="environment" class="sr-only" id="${id}" aria-labelledby="${id}-label">
      <span class="ine-shot__empty">${ICONS.camera}<span>Tomar foto</span></span>
    </label>
    <p class="field__error" id="${id}-err"></p>
  </div>`;

const campo = (id, name, label, { req = false, help = '', attrs = '', cls = '' } = {}) => `
  <div class="field">
    <label for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    <input class="input ${cls}" id="${id}" name="${name}" autocomplete="off" ${attrs}>
    ${help ? `<p class="field__help">${help}</p>` : ''}
    <p class="field__error" id="${id}-err"></p>
  </div>`;

// ===========================================================================
// Nueva captura
// ===========================================================================
export async function viewNuevoPromovido(route) {
  let ctx;
  try {
    ctx = await api('/api/promovidos/contexto');
  } catch (err) {
    if (err.status === 409) return sinSeccion(err.message);
    throw err;
  }
  route.ctx = ctx;
  return `
    <div class="promo-page">
      <a class="back-link" href="/promovidos" data-link>${ICONS.back}<span>Promovidos</span></a>
      <div class="page-head">
        <h2>Nuevo promovido</h2>
        <p>Sección <strong>${fmtNum(ctx.seccion)}</strong>${ctx.entidad.nombre ? ` · ${esc(ctx.entidad.nombre)}` : ''}. Solo puedes capturar personas de esta sección con INE vigente para la elección.</p>
      </div>

      <form id="promoForm" novalidate>
        <section class="card form-card" aria-labelledby="ps1">
          <header class="form-card__head">
            <span class="form-card__icon" aria-hidden="true">${ICONS.camera}</span>
            <h3 id="ps1">1. Credencial para votar (INE)</h3>
            <span class="form-card__aside">Campos requeridos <span class="req">*</span></span>
          </header>
          <div class="field-row field-row--fotos">
            ${campoFoto('pFrente', 'Foto INE (frente)')}
            ${campoFoto('pReverso', 'Foto INE (reverso)')}
          </div>
          <div class="field-row field-row--fotos">
            ${campo('pVigencia', 'vigencia', 'Vigencia', { req: true, help: `Año final de la INE: ${ctx.vigenciaMin} o posterior.`, attrs: 'inputmode="numeric" maxlength="4"' })}
            ${campo('pSeccion', 'seccion', 'Sección', { req: true, help: `Debe ser la ${fmtNum(ctx.seccion)}.`, attrs: 'inputmode="numeric" maxlength="4"' })}
          </div>
        </section>

        <section class="card form-card" aria-labelledby="ps2">
          <header class="form-card__head">
            <span class="form-card__icon" aria-hidden="true">${I.user}</span>
            <h3 id="ps2">2. Datos personales</h3>
          </header>
          <div class="field-row">
            ${campo('pPaterno', 'paterno', 'Apellido paterno', { req: true, cls: 'input--upper', attrs: 'maxlength="60" autocapitalize="characters"' })}
            ${campo('pMaterno', 'materno', 'Apellido materno', { cls: 'input--upper', attrs: 'maxlength="60" autocapitalize="characters"' })}
          </div>
          ${campo('pNombres', 'nombres', 'Nombre(s)', { req: true, cls: 'input--upper', attrs: 'maxlength="80" autocapitalize="characters"' })}
          <div class="field-row">
            ${campo('pClave', 'claveElector', 'Clave de elector', { req: true, help: '18 caracteres, como aparece en la INE.', cls: 'input--upper mono', attrs: 'maxlength="18" autocapitalize="characters" spellcheck="false"' })}
            ${campo('pCurp', 'curp', 'CURP', { req: true, help: '18 caracteres.', cls: 'input--upper mono', attrs: 'maxlength="18" autocapitalize="characters" spellcheck="false"' })}
          </div>
        </section>

        <section class="card form-card" aria-labelledby="ps3">
          <header class="form-card__head">
            <span class="form-card__icon" aria-hidden="true">${I.map}</span>
            <h3 id="ps3">3. Domicilio</h3>
          </header>
          <div class="field-row">
            ${campo('pCp', 'cp', 'Código postal', { req: true, help: 'Al escribirlo se llenan localidad, municipio y estado.', attrs: 'inputmode="numeric" maxlength="5"' })}
            <div class="field">
              <label for="pLocalidad">Localidad <span class="req" aria-hidden="true">*</span></label>
              <select class="input" id="pLocalidad" name="localidadSel" disabled><option value="">Primero escribe el CP</option></select>
              <input class="input input--upper" id="pLocalidadOtra" name="localidadOtra" maxlength="80" placeholder="Escribe la localidad" hidden>
              <p class="field__error" id="pLocalidad-err"></p>
            </div>
          </div>
          <div class="field-row">
            ${campo('pMunicipio', 'municipio', 'Municipio', { attrs: 'readonly tabindex="-1"' })}
            ${campo('pEstado', 'estado', 'Estado', { attrs: 'readonly tabindex="-1"' })}
          </div>
          ${campo('pCalle', 'calle', 'Calle', { req: true, cls: 'input--upper', attrs: 'maxlength="100" autocapitalize="characters"' })}
          <div class="field-row field-row--3">
            ${campo('pNumExt', 'numExt', 'No. Ext.', { req: true, cls: 'input--upper', attrs: 'maxlength="12" placeholder="S/N"' })}
            ${campo('pNumInt', 'numInt', 'No. Int.', { cls: 'input--upper', attrs: 'maxlength="12"' })}
            ${campo('pFracc', 'fracc', 'Fracc.', { cls: 'input--upper', attrs: 'maxlength="80"' })}
          </div>
        </section>

        <p class="form-error" id="pFormErr" role="alert"></p>
        <div class="form-footer">
          <a class="btn btn--secondary" href="/promovidos" data-link>Cancelar</a>
          <button class="btn" type="submit">Guardar promovido</button>
        </div>
      </form>
    </div>`;
}

export function mountNuevoPromovido(root, route) {
  const ctx = route.ctx;
  const form = $('#promoForm', root);
  if (!form) return;
  const formErr = $('#pFormErr', root);
  const fields = {
    ineFrente: 'pFrente',
    ineReverso: 'pReverso',
    vigencia: 'pVigencia',
    seccion: 'pSeccion',
    paterno: 'pPaterno',
    materno: 'pMaterno',
    nombres: 'pNombres',
    claveElector: 'pClave',
    curp: 'pCurp',
    cp: 'pCp',
    localidad: 'pLocalidad',
    calle: 'pCalle',
    numExt: 'pNumExt',
    numInt: 'pNumInt',
    fracc: 'pFracc',
  };
  const setErrors = fieldErrorSetter(root, fields);
  const err = (id, msg) => ($(`#${id}-err`, root).textContent = msg || '');
  const fotos = { ineFrente: null, ineReverso: null };

  // ---------- Fotos ----------
  for (const [key, id] of [
    ['ineFrente', 'pFrente'],
    ['ineReverso', 'pReverso'],
  ]) {
    const input = $(`#${id}`, root);
    const box = $(`#${id}Box`, root);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      box.classList.add('is-busy');
      try {
        fotos[key] = await comprimir(file);
        let img = box.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = key === 'ineFrente' ? 'Vista previa del frente de la INE' : 'Vista previa del reverso de la INE';
          box.prepend(img);
        }
        img.src = fotos[key];
        box.classList.add('has-photo');
        err(id, '');
      } catch (e) {
        err(id, e.message);
      } finally {
        box.classList.remove('is-busy');
        input.value = '';
      }
    });
  }

  // ---------- Mayúsculas y solo dígitos ----------
  root.querySelectorAll('.input--upper').forEach((el) => el.addEventListener('input', () => {
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange?.(pos, pos);
  }));
  for (const id of ['pVigencia', 'pSeccion', 'pCp']) {
    const el = $(`#${id}`, root);
    el.addEventListener('input', () => (el.value = el.value.replace(/\D/g, '')));
  }
  for (const id of ['pClave', 'pCurp']) {
    const el = $(`#${id}`, root);
    el.addEventListener('input', () => (el.value = el.value.toUpperCase().replace(/[^A-Z0-9Ñ]/g, '')));
  }

  // ---------- Avisos inmediatos: vigencia y sección ----------
  $('#pVigencia', root).addEventListener('blur', (e) => {
    const v = Number(e.target.value);
    err('pVigencia', e.target.value.length === 4 && v < ctx.vigenciaMin ? `Esta INE vence en ${v}: no sirve para votar el ${ctx.eleccion}. Se requiere vigencia ${ctx.vigenciaMin} o posterior.` : '');
  });
  $('#pSeccion', root).addEventListener('blur', (e) => {
    const v = Number(e.target.value);
    err('pSeccion', e.target.value && v !== ctx.seccion ? `Solo puedes capturar promovidos de la sección ${ctx.seccion}.` : '');
  });

  // ---------- Código postal → localidad, municipio y estado ----------
  const cp = $('#pCp', root);
  const sel = $('#pLocalidad', root);
  const otra = $('#pLocalidadOtra', root);
  let cpInfo = null;
  const limpiarCP = (msg = 'Primero escribe el CP') => {
    cpInfo = null;
    sel.innerHTML = `<option value="">${esc(msg)}</option>`;
    sel.disabled = true;
    otra.hidden = true;
    $('#pMunicipio', root).value = '';
    $('#pEstado', root).value = '';
  };
  const buscar = debounce(async () => {
    const v = cp.value;
    if (v.length !== 5) return limpiarCP();
    sel.innerHTML = '<option value="">Buscando…</option>';
    try {
      const r = await api(`/api/cp/${v}`);
      if (cp.value !== v) return;
      cpInfo = r;
      err('pCp', '');
      $('#pMunicipio', root).value = r.municipio.toUpperCase();
      $('#pEstado', root).value = r.estado.toUpperCase();
      sel.innerHTML =
        `<option value="">Elige la localidad (${fmtNum(r.asentamientos.length)})</option>` +
        r.asentamientos.map((a, i) => `<option value="${i}">${esc(a.nombre)} · ${esc(a.tipo)}</option>`).join('') +
        '<option value="otra">Otra (escribirla)</option>';
      sel.disabled = false;
      if (r.asentamientos.length === 1) {
        sel.value = '0';
        sel.dispatchEvent(new Event('change'));
      }
    } catch (e) {
      if (cp.value !== v) return;
      limpiarCP('Código postal no encontrado');
      err('pCp', e.status === 404 ? 'No encontramos ese código postal.' : e.message);
    }
  }, 250);
  cp.addEventListener('input', buscar);
  sel.addEventListener('change', () => {
    otra.hidden = sel.value !== 'otra';
    if (!otra.hidden) otra.focus();
    const a = cpInfo?.asentamientos[Number(sel.value)];
    // Si es fraccionamiento, se propone también en «Fracc.»
    if (a && /fraccionamiento/i.test(a.tipo) && !$('#pFracc', root).value) $('#pFracc', root).value = a.nombre.toUpperCase();
    err('pLocalidad', '');
  });
  const localidad = () => (sel.value === 'otra' ? otra.value : cpInfo?.asentamientos[Number(sel.value)]?.nombre || '');

  // ---------- Guardar ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      ...Object.fromEntries(new FormData(form)),
      ineFrente: fotos.ineFrente,
      ineReverso: fotos.ineReverso,
      localidad: localidad(),
    };
    const saved = await submitWith(form, 'Guardar promovido', 'Guardando…', setErrors, formErr, () => api('/api/promovidos', { method: 'POST', body }));
    if (!saved) {
      root.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    toast(`Promovido registrado: ${saved.nombre}`);
    // Listo para la siguiente captura
    form.reset();
    fotos.ineFrente = fotos.ineReverso = null;
    root.querySelectorAll('.ine-shot').forEach((b) => {
      b.classList.remove('has-photo');
      b.querySelector('img')?.remove();
    });
    limpiarCP();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ===========================================================================
// Lista del promotor
// ===========================================================================
export async function viewPromovidos() {
  const lista = await api('/api/promovidos');
  return `
    <div class="page-head page-head--actions">
      <div>
        <h2>Promovidos</h2>
        <p>${lista.length ? `Has registrado ${fmtNum(lista.length)} ${lista.length === 1 ? 'promovido' : 'promovidos'}.` : 'Aún no registras promovidos.'}</p>
      </div>
      <a class="btn promo-new" href="/promovidos/nuevo" data-link>${ICONS.plus}<span>Nuevo promovido</span></a>
    </div>
    ${
      lista.length
        ? `<ul class="promo-list">${lista
            .map(
              (p) => `<li><a class="promo-item" href="/promovidos/${p.id}" data-link>
                <strong>${esc(p.nombre)}</strong>
                <span class="promo-item__meta"><span class="mono">${esc(p.claveElector)}</span><span>${esc(p.localidad)}</span><span>${fmtDate(p.createdAt)}</span></span>
              </a></li>`
            )
            .join('')}</ul>`
        : `<div class="empty">
            <span aria-hidden="true">${ICONS.users}</span>
            <strong>Sin promovidos todavía</strong>
            <span>Toca el botón + para capturar el primero.</span>
          </div>`
    }`;
}

// ===========================================================================
// Ficha del promovido (con fotos de la INE): solo la rama del promotor hasta el CPV
// ===========================================================================
export async function viewPromovido(route, params) {
  const p = await api(`/api/promovidos/${params[0]}`);
  const d = p.domicilio || {};
  const dato = (label, value, cls = '') => `<div><dt>${label}</dt><dd class="${cls}">${value || '—'}</dd></div>`;
  const direccion = [d.calle, d.numExt && `No. ${d.numExt}`, d.numInt && `Int. ${d.numInt}`].filter(Boolean).join(' ');
  const fotoIne = (lado, label) => `
    <figure class="ine-view">
      <img src="/api/promovidos/${p.id}/ine/${lado}" alt="${label} de la INE de ${esc(p.nombre)}">
      <figcaption>${label}</figcaption>
    </figure>`;
  return `
    <div class="promo-page">
      <a class="back-link" href="/promovidos" data-link>${ICONS.back}<span>Promovidos</span></a>
      <div class="page-head">
        <h2>${esc(p.nombre)}</h2>
        <p>Sección ${fmtNum(p.seccion)} · registrado el ${fmtDate(p.createdAt)}${p.promotor ? ` por ${esc(p.promotor)}` : ''}</p>
      </div>
      <section class="card form-card" aria-labelledby="pv1">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.camera}</span><h3 id="pv1">Credencial para votar (INE)</h3></header>
        <div class="ine-views">${fotoIne('frente', 'Frente')}${fotoIne('reverso', 'Reverso')}</div>
        <dl class="ficha__grid">
          ${dato('Clave de elector', esc(p.claveElector), 'mono')}
          ${dato('CURP', esc(p.curp), 'mono')}
          ${dato('Vigencia', esc(p.vigencia))}
          ${dato('Sección', fmtNum(p.seccion))}
        </dl>
      </section>
      <section class="card form-card" aria-labelledby="pv2">
        <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${I.map}</span><h3 id="pv2">Domicilio</h3></header>
        <dl class="ficha__grid">
          ${dato('Calle y número', esc(direccion))}
          ${dato('Fracc.', esc(d.fracc))}
          ${dato('Localidad', esc(d.localidad))}
          ${dato('Código postal', esc(d.cp))}
          ${dato('Municipio', esc(d.municipio))}
          ${dato('Estado', esc(d.estado))}
        </dl>
      </section>
    </div>`;
}
