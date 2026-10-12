// Promovidos del Promotor Territorial: captura (INE + datos + domicilio) y lista.
// La sección y la vigencia se validan aquí para avisar al momento, y de nuevo en el servidor.
import { ICONS, $, esc, fmtNum, fmtSeccion, fmtDate, fmtDateTime, fmtPhone, api, fieldErrorSetter, toast, navigate } from './lib.js';
import { I, debounce } from './coordinador.js';
import { camaraDisponible, abrirCamara, ajustarEnGuia } from './ine-camara.js';

const sinSeccion = (msg) => `
  <div class="empty">
    <span aria-hidden="true">${ICONS.map}</span>
    <strong>Aún no puedes capturar promovidos</strong>
    <span>${esc(msg)}</span>
  </div>`;

// Foto de la INE: tomarla con la cámara (con guía) o cargar una imagen ya guardada en el teléfono.
// La vista previa solo aparece cuando ya hay imagen.
const campoFoto = (id, label) => `
  <div class="field ine-field">
    <span class="field__label" id="${id}-label">${label} <span class="req" aria-hidden="true">*</span></span>
    <div class="ine-preview" id="${id}Box" hidden></div>
    <div class="ine-shot__btns">
      <button type="button" class="btn btn--secondary" data-foto="camara" data-lado="${id}">${ICONS.camera}<span>Tomar foto</span></button>
      <label class="btn btn--secondary">${ICONS.upload}<span>Cargar imagen</span>
        <input type="file" accept="image/*" class="sr-only" id="${id}" aria-labelledby="${id}-label"></label>
    </div>
    <input type="file" accept="image/*" capture="environment" class="sr-only" id="${id}Cam" tabindex="-1" aria-hidden="true">
    <p class="field__error" id="${id}-err"></p>
  </div>`;

const campo = (id, name, label, { req = false, help = '', attrs = '', cls = '' } = {}) => `
  <div class="field">
    <label for="${id}">${label}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    <input class="input ${cls}" id="${id}" name="${name}" autocomplete="off" ${attrs}>
    ${help ? `<p class="field__help">${help}</p>` : ''}
    <p class="field__error" id="${id}-err"></p>
  </div>`;

// Asistente de captura: un paso por pantalla
const PASOS = ['Fotografía', 'Datos generales', 'Domicilio', 'Verificación'];
const PASO_DE = {
  ineFrente: 1,
  ineReverso: 1,
  vigencia: 2,
  seccion: 2,
  paterno: 2,
  materno: 2,
  nombres: 2,
  claveElector: 2,
  curp: 2,
  telefono: 2,
  cp: 3,
  localidad: 3,
  calle: 3,
  numExt: 3,
  numInt: 3,
  fracc: 3,
};
const CLAVE_RE = /^[A-Z]{6}\d{8}[HMX]\d{3}$/;
const CURP_RE = /^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z\d]\d$/;

// `editando`: id del promovido al editar (cancelar regresa a su ficha)
const acciones = (paso, editando = null) => `
  <div class="wiz-actions">
    ${paso === 1 ? `<a class="btn btn--secondary" href="/promovidos${editando ? `/${editando}` : ''}" data-link>Cancelar</a>` : '<button type="button" class="btn btn--secondary" data-wiz="atras">Atrás</button>'}
    ${paso === 4 ? `<button class="btn" type="submit">${editando ? 'Guardar cambios' : 'Guardar promovido'}</button>` : '<button type="button" class="btn" data-wiz="sig">Siguiente</button>'}
  </div>`;

// ===========================================================================
// Nueva captura
// ===========================================================================
// También sirve para editar: /promovidos/:id/editar (params[0] = id)
export async function viewNuevoPromovido(route, params = []) {
  const editando = params[0] || null;
  let ctx;
  route.actual = null;
  if (editando) {
    const p = await api(`/api/promovidos/${editando}`);
    if (!p.puedeEditar) return sinSeccion('Solo el promotor que lo capturó y su Responsable de Sección pueden editar este registro.');
    route.actual = p;
    ctx = { seccion: p.seccionPermitida, vigenciaMin: p.vigenciaMin, eleccion: p.eleccion };
  } else {
    try {
      ctx = await api('/api/promovidos/contexto');
    } catch (err) {
      if (err.status === 409) return sinSeccion(err.message);
      throw err;
    }
  }
  route.ctx = ctx;
  return `
    <div class="wiz">
      <div class="wiz-bar" role="progressbar" aria-label="Avance de la captura" aria-valuemin="1" aria-valuemax="${PASOS.length}" aria-valuenow="1">
        <div class="wiz-bar__track" aria-hidden="true">${PASOS.map(() => '<span></span>').join('')}</div>
        <p class="wiz-bar__label" id="wizLabel">Paso 1 de ${PASOS.length} · ${PASOS[0]}</p>
      </div>

      <form id="promoForm" novalidate>
        <section class="card wiz-step" data-paso="1" aria-label="Paso 1: ${PASOS[0]}">
          <p class="wiz-step__help">${editando ? 'Las fotos guardadas se conservan; tómalas o cárgalas de nuevo solo si quieres reemplazarlas.' : 'Toma o carga la foto del frente y del reverso de la INE y encuádrala en la guía: se guarda solo lo que queda dentro del marco.'}</p>
          <div class="ine-fotos">
            ${campoFoto('pFrente', 'Frente de la INE')}
            ${campoFoto('pReverso', 'Reverso de la INE')}
          </div>
          <div class="ine-cam" id="ineCam" hidden></div>
          ${acciones(1, editando)}
        </section>

        <section class="card wiz-step" data-paso="2" aria-label="Paso 2: ${PASOS[1]}" hidden>
          <div class="field-row field-row--fotos">
            ${campo('pVigencia', 'vigencia', 'Vigencia', { req: true, help: `Año final de la INE: ${ctx.vigenciaMin} o posterior.`, attrs: 'inputmode="numeric" maxlength="4"' })}
            ${campo('pSeccion', 'seccion', 'Sección', { req: true, help: `Debe ser la ${fmtSeccion(ctx.seccion)}.`, attrs: 'inputmode="numeric" maxlength="4"' })}
          </div>
          <div class="field-row">
            ${campo('pPaterno', 'paterno', 'Apellido paterno', { req: true, cls: 'input--upper', attrs: 'maxlength="60" autocapitalize="characters"' })}
            ${campo('pMaterno', 'materno', 'Apellido materno', { cls: 'input--upper', attrs: 'maxlength="60" autocapitalize="characters"' })}
          </div>
          ${campo('pNombres', 'nombres', 'Nombre(s)', { req: true, cls: 'input--upper', attrs: 'maxlength="80" autocapitalize="characters"' })}
          <div class="field-row">
            ${campo('pClave', 'claveElector', 'Clave de elector', { req: true, help: '18 caracteres, como aparece en la INE.', cls: 'input--upper mono', attrs: 'maxlength="18" autocapitalize="characters" spellcheck="false"' })}
            ${campo('pCurp', 'curp', 'CURP', { req: true, help: '18 caracteres.', cls: 'input--upper mono', attrs: 'maxlength="18" autocapitalize="characters" spellcheck="false"' })}
          </div>
          ${campo('pTelefono', 'telefono', 'Teléfono (WhatsApp)', { req: true, help: '10 dígitos.', attrs: 'type="tel" inputmode="numeric" maxlength="14" autocomplete="off"' })}
          ${acciones(2, editando)}
        </section>

        <section class="card wiz-step" data-paso="3" aria-label="Paso 3: ${PASOS[2]}" hidden>
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
          ${acciones(3, editando)}
        </section>

        <section class="card wiz-step" data-paso="4" aria-label="Paso 4: ${PASOS[3]}" hidden>
          <p class="wiz-step__help">Revisa que los datos coincidan con la credencial antes de guardar.</p>
          <div id="wizResumen"></div>
          <p class="form-error" id="pFormErr" role="alert"></p>
          ${acciones(4, editando)}
        </section>
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
    telefono: 'pTelefono',
    cp: 'pCp',
    localidad: 'pLocalidad',
    calle: 'pCalle',
    numExt: 'pNumExt',
    numInt: 'pNumInt',
    fracc: 'pFracc',
  };
  const setErrors = fieldErrorSetter(root, fields);
  const err = (id, msg) => ($(`#${id}-err`, root).textContent = msg || '');
  const val = (id) => $(`#${id}`, root).value.trim();
  const fotos = { ineFrente: null, ineReverso: null };

  // ---------- Fotos: cámara con guía o imagen cargada ----------
  const LADOS = { pFrente: { key: 'ineFrente', titulo: 'Frente de la INE' }, pReverso: { key: 'ineReverso', titulo: 'Reverso de la INE' } };
  const camBox = $('#ineCam', root);
  let cerrarCamara = null;

  const ponerFoto = (id, dataUrl) => {
    const { key } = LADOS[id];
    fotos[key] = dataUrl;
    const box = $(`#${id}Box`, root);
    let img = box.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = key === 'ineFrente' ? 'Vista previa del frente de la INE' : 'Vista previa del reverso de la INE';
      box.prepend(img);
    }
    img.src = dataUrl;
    box.hidden = false;
    // Con foto, los botones ofrecen reemplazarla
    box.closest('.ine-field').classList.add('has-photo');
    err(id, '');
  };

  // Foto cargada (o tomada con la cámara del teléfono): se encuadra en la guía y se guarda
  // solo lo que queda dentro del marco
  const desdeArchivo = async (id, input) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    cerrarCamara?.();
    try {
      cerrarCamara = await ajustarEnGuia(camBox, {
        titulo: LADOS[id].titulo,
        fuente: file,
        onListo: (dataUrl) => {
          cerrarCamara = null;
          ponerFoto(id, dataUrl);
          $(`#${id}`, root).closest('.ine-field').scrollIntoView({ block: 'center', behavior: 'smooth' });
        },
        onCerrar: () => (cerrarCamara = null),
      });
    } catch (e) {
      err(id, e.message || 'No se pudo abrir la foto. Intenta con otra.');
    }
  };

  for (const id of Object.keys(LADOS)) {
    $(`#${id}`, root).addEventListener('change', (e) => desdeArchivo(id, e.target));
    $(`#${id}Cam`, root).addEventListener('change', (e) => desdeArchivo(id, e.target));
  }

  const tomarFoto = async (id) => {
    cerrarCamara?.();
    cerrarCamara = null;
    // Sin cámara en vivo (p. ej. sin HTTPS): se usa la cámara del teléfono sin guía
    // (dentro del mismo toque del usuario, si no el navegador lo bloquea)
    if (!camaraDisponible()) return $(`#${id}Cam`, root).click();
    try {
      cerrarCamara = await abrirCamara(camBox, {
        titulo: LADOS[id].titulo,
        onCaptura: (dataUrl) => {
          cerrarCamara = null;
          ponerFoto(id, dataUrl);
          $(`#${id}`, root).closest('.ine-field').scrollIntoView({ block: 'center', behavior: 'smooth' });
        },
        onCerrar: () => (cerrarCamara = null),
      });
    } catch {
      // Permiso negado o cámara ocupada: se ofrece la cámara del teléfono con un botón
      // (abrirla aquí directamente lo bloquearía el navegador)
      camBox.hidden = false;
      camBox.innerHTML = `
        <div class="notice">${ICONS.alert}<div>
          <strong>No se pudo abrir la cámara con guía.</strong> Revisa que el navegador tenga permiso de usar la cámara, o usa la cámara del teléfono:
          <div class="ine-cam__actions">
            <label class="btn">${ICONS.camera}<span>Abrir cámara del teléfono</span>
              <input type="file" accept="image/*" capture="environment" class="sr-only" data-alt="${id}"></label>
          </div>
        </div></div>`;
      camBox.querySelector('[data-alt]').addEventListener('change', (e) => {
        camBox.hidden = true;
        camBox.innerHTML = '';
        desdeArchivo(id, e.target);
      });
    }
  };

  // ---------- Mayúsculas y solo dígitos ----------
  root.querySelectorAll('.input--upper').forEach((el) =>
    el.addEventListener('input', () => {
      const pos = el.selectionStart;
      el.value = el.value.toUpperCase();
      el.setSelectionRange?.(pos, pos);
    })
  );
  for (const id of ['pVigencia', 'pSeccion', 'pCp', 'pTelefono']) {
    const el = $(`#${id}`, root);
    el.addEventListener('input', () => (el.value = el.value.replace(/\D/g, '')));
  }
  for (const id of ['pClave', 'pCurp']) {
    const el = $(`#${id}`, root);
    el.addEventListener('input', () => (el.value = el.value.toUpperCase().replace(/[^A-Z0-9Ñ]/g, '')));
  }

  // ---------- Avisos inmediatos: vigencia y sección ----------
  const msgVigencia = (v) => `Esta INE vence en ${v}: no sirve para votar el ${ctx.eleccion}. Se requiere vigencia ${ctx.vigenciaMin} o posterior.`;
  const msgSeccion = () => `Solo puedes capturar promovidos de la sección ${fmtSeccion(ctx.seccion)}.`;
  $('#pVigencia', root).addEventListener('blur', (e) => {
    const v = Number(e.target.value);
    err('pVigencia', e.target.value.length === 4 && v < ctx.vigenciaMin ? msgVigencia(v) : '');
  });
  $('#pSeccion', root).addEventListener('blur', (e) => {
    const v = Number(e.target.value);
    err('pSeccion', e.target.value && v !== ctx.seccion ? msgSeccion() : '');
  });

  // ---------- Código postal → localidad, municipio y estado ----------
  const cp = $('#pCp', root);
  const sel = $('#pLocalidad', root);
  const otra = $('#pLocalidadOtra', root);
  let cpInfo = null;
  // Al editar: localidad guardada, que se elige al cargar las opciones del CP
  let localidadInicial = route.actual?.domicilio?.localidad || '';
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
      if (localidadInicial) {
        const i = r.asentamientos.findIndex((a) => a.nombre.toUpperCase() === localidadInicial.toUpperCase());
        sel.value = i >= 0 ? String(i) : 'otra';
        if (i < 0) otra.value = localidadInicial;
        sel.dispatchEvent(new Event('change'));
        localidadInicial = '';
      } else if (r.asentamientos.length === 1) {
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
  const localidad = () => (sel.value === 'otra' ? otra.value.trim().toUpperCase() : (cpInfo?.asentamientos[Number(sel.value)]?.nombre || '').toUpperCase());

  // ---------- Pasos ----------
  const pasos = [...root.querySelectorAll('.wiz-step')];
  const barra = $('.wiz-bar', root);
  let paso = 1;

  // Revisión de cada paso antes de avanzar (el servidor vuelve a validar todo al guardar)
  function revisar(n) {
    const e = {};
    if (n === 1) {
      // Al editar, las fotos guardadas cuentan
      if (!fotos.ineFrente && !route.actual) e.ineFrente = 'Toma o carga la foto del frente.';
      if (!fotos.ineReverso && !route.actual) e.ineReverso = 'Toma o carga la foto del reverso.';
    }
    if (n === 2) {
      const vig = Number(val('pVigencia'));
      if (!/^\d{4}$/.test(val('pVigencia'))) e.vigencia = 'Escribe el año de vigencia (4 dígitos).';
      else if (vig < ctx.vigenciaMin) e.vigencia = msgVigencia(vig);
      if (!val('pSeccion')) e.seccion = 'Escribe la sección que aparece en la INE.';
      else if (Number(val('pSeccion')) !== ctx.seccion) e.seccion = msgSeccion();
      if (val('pPaterno').length < 2) e.paterno = 'Escribe el apellido paterno.';
      if (val('pNombres').length < 2) e.nombres = 'Escribe el nombre o nombres.';
      if (!CLAVE_RE.test(val('pClave'))) e.claveElector = 'La clave de elector tiene 18 caracteres: 6 letras, 8 números, H/M y 3 números.';
      if (!CURP_RE.test(val('pCurp'))) e.curp = 'La CURP tiene 18 caracteres.';
      if (val('pTelefono').length !== 10) e.telefono = 'Escribe el teléfono (WhatsApp) de 10 dígitos.';
    }
    if (n === 3) {
      if (!cpInfo) e.cp = 'Escribe un código postal válido de 5 dígitos.';
      else if (localidad().length < 2) e.localidad = 'Elige o escribe la localidad.';
      if (val('pCalle').length < 2) e.calle = 'Escribe la calle.';
      if (!val('pNumExt')) e.numExt = 'Escribe el número exterior (o S/N).';
    }
    return e;
  }

  const fila = (label, value) => `<div><dt>${label}</dt><dd>${value ? esc(value) : '—'}</dd></div>`;
  const bloque = (titulo, n, filas) => `
    <section class="wiz-sum">
      <header><h4>${titulo}</h4><button type="button" class="link-btn" data-ir="${n}">Editar</button></header>
      <dl class="ficha__grid">${filas.join('')}</dl>
    </section>`;
  function resumen() {
    $('#wizResumen', root).innerHTML = [
      bloque('Credencial', 2, [fila('Vigencia', val('pVigencia')), fila('Sección', fmtSeccion(val('pSeccion')))]),
      bloque('Datos personales', 2, [
        fila('Apellido paterno', val('pPaterno')),
        fila('Apellido materno', val('pMaterno')),
        fila('Nombre(s)', val('pNombres')),
        fila('Clave de elector', val('pClave')),
        fila('CURP', val('pCurp')),
        fila('Teléfono (WhatsApp)', fmtPhone(val('pTelefono'))),
      ]),
      bloque('Domicilio', 3, [
        fila('Calle', val('pCalle')),
        fila('No. Ext.', val('pNumExt')),
        fila('No. Int.', val('pNumInt')),
        fila('Fracc.', val('pFracc')),
        fila('Localidad', localidad()),
        fila('Código postal', val('pCp')),
        fila('Municipio', val('pMunicipio')),
        fila('Estado', val('pEstado')),
      ]),
    ].join('');
  }

  function ir(n) {
    paso = n;
    pasos.forEach((s) => (s.hidden = Number(s.dataset.paso) !== n));
    barra.setAttribute('aria-valuenow', String(n));
    barra.querySelectorAll('.wiz-bar__track span').forEach((s, i) => s.classList.toggle('is-on', i < n));
    $('#wizLabel', root).textContent = `Paso ${n} de ${PASOS.length} · ${PASOS[n - 1]}`;
    if (n !== 1) cerrarCamara?.();
    if (n === 4) resumen();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  form.addEventListener('click', (e) => {
    const foto = e.target.closest('[data-foto="camara"]');
    if (foto) return tomarFoto(foto.dataset.lado);
    const editar = e.target.closest('[data-ir]');
    if (editar) return ir(Number(editar.dataset.ir));
    const w = e.target.closest('[data-wiz]')?.dataset.wiz;
    if (w === 'atras') return ir(paso - 1);
    if (w === 'sig') {
      const errs = revisar(paso);
      setErrors(errs);
      if (Object.keys(errs).length) return;
      ir(paso + 1);
    }
  });
  ir(1);

  // ---------- Edición: datos y fotos guardados ----------
  const actual = route.actual;
  if (actual) {
    const d = actual.domicilio || {};
    const poner = (id, v) => {
      const el = $(`#${id}`, root);
      el.value = v ?? '';
    };
    poner('pVigencia', actual.vigencia);
    poner('pSeccion', fmtSeccion(actual.seccion));
    poner('pPaterno', actual.paterno);
    poner('pMaterno', actual.materno);
    poner('pNombres', actual.nombres);
    poner('pClave', actual.claveElector);
    poner('pCurp', actual.curp);
    poner('pTelefono', actual.telefono);
    poner('pCalle', d.calle);
    poner('pNumExt', d.numExt);
    poner('pNumInt', d.numInt);
    poner('pFracc', d.fracc);
    poner('pCp', d.cp);
    cp.dispatchEvent(new Event('input'));
    for (const [id, lado] of [
      ['pFrente', 'frente'],
      ['pReverso', 'reverso'],
    ]) {
      const box = $(`#${id}Box`, root);
      box.innerHTML = `<img src="/api/promovidos/${actual.id}/ine/${lado}" alt="Foto guardada: ${lado} de la INE">`;
      box.hidden = false;
      box.closest('.ine-field').classList.add('has-photo');
    }
  }

  // ---------- Guardar ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (paso !== 4) return;
    const btn = form.querySelector('[type="submit"]');
    const body = {
      ...Object.fromEntries(new FormData(form)),
      // Al editar solo se envían las fotos reemplazadas
      ineFrente: fotos.ineFrente,
      ineReverso: fotos.ineReverso,
      localidad: localidad(),
    };
    const etiqueta = actual ? 'Guardar cambios' : 'Guardar promovido';
    formErr.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    let saved = null;
    try {
      saved = actual
        ? await api(`/api/promovidos/${actual.id}`, { method: 'PUT', body })
        : await api('/api/promovidos', { method: 'POST', body });
    } catch (err) {
      const f = err.data?.fields;
      if (f && Object.keys(f).length) {
        // Regresa al primer paso con error y lo marca
        ir(Math.min(...Object.keys(f).map((k) => PASO_DE[k] || 4)));
        setErrors(f);
      } else formErr.textContent = navigator.onLine ? err.message : 'Sin conexión. Intenta de nuevo cuando estés en línea.';
    } finally {
      btn.disabled = false;
      btn.textContent = etiqueta;
    }
    if (!saved) return;
    if (actual) {
      toast(saved.cambios ? 'Cambios guardados' : 'No hubo cambios que guardar');
      navigate(`/promovidos/${actual.id}`);
      return;
    }
    toast(`Promovido registrado (en revisión): ${saved.nombre}`);
    // Listo para la siguiente captura
    form.reset();
    fotos.ineFrente = fotos.ineReverso = null;
    root.querySelectorAll('.ine-preview').forEach((b) => {
      b.hidden = true;
      b.innerHTML = '';
    });
    root.querySelectorAll('.ine-field').forEach((f) => f.classList.remove('has-photo'));
    limpiarCP();
    setErrors();
    ir(1);
  });

  // Al salir de la pantalla se apaga la cámara
  return () => cerrarCamara?.();
}

// Estatus de revisión del promovido (lo valida su Responsable de Sección directo)
const ESTATUS = {
  en_revision: { texto: 'En revisión', clase: 'estatus--revision' },
  validado: { texto: 'Validado', clase: 'estatus--validado' },
  rechazado: { texto: 'Rechazado', clase: 'estatus--rechazado' },
};
const chipEstatus = (e) => {
  const x = ESTATUS[e] || ESTATUS.en_revision;
  return `<span class="estatus ${x.clase}">${x.texto}</span>`;
};

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
                <span class="promo-item__top"><strong>${esc(p.nombre)}</strong>${chipEstatus(p.estatus)}</span>
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
// Ficha del promovido: datos, fotos de la INE, historial de cambios y observaciones.
// La ve la rama del promotor hasta el CPV; editan y conversan solo el promotor que lo
// capturó y su Responsable de Sección.
// ===========================================================================
const icono = (d) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONO_ENVIAR = icono('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>');
const ICONO_HISTORIAL = icono('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>');
const ICONO_PDF = icono('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15l3 3 3-3"/>');
const ICONO_OBS = icono('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>');

function itemHistorial(h) {
  const detalle =
    h.accion === 'creado'
      ? '<p class="hist__txt">Registró al promovido.</p>'
      : `<ul class="hist__cambios">${h.cambios
          .map((c) =>
            c.campo.startsWith('Foto')
              ? `<li><span>${esc(c.campo)}</span> reemplazada</li>`
              : `<li><span>${esc(c.campo)}:</span> <s>${c.antes ? esc(c.antes) : '(vacío)'}</s> → <strong>${c.despues ? esc(c.despues) : '(vacío)'}</strong></li>`
          )
          .join('')}</ul>`;
  return `<li class="hist__item">
      <div class="hist__head"><strong>${esc(h.autor)}</strong><time datetime="${h.at}">${esc(fmtDateTime(h.at))}</time></div>
      ${detalle}
    </li>`;
}

const mensaje = (m) => `
  <li class="obs__msg ${m.propia ? 'is-propia' : ''}" data-id="${m.id}">
    <p class="obs__burbuja">${esc(m.texto).replace(/\n/g, '<br>')}</p>
    <span class="obs__meta">${m.propia ? 'Tú' : esc(m.autor)} · <time datetime="${m.at}">${esc(fmtDateTime(m.at))}</time></span>
  </li>`;

export async function viewPromovido(route, params, state) {
  const [p, hist] = await Promise.all([api(`/api/promovidos/${params[0]}`), api(`/api/promovidos/${params[0]}/historial`)]);
  route.promovido = p;
  const d = p.domicilio || {};
  const dato = (label, value, cls = '') => `<div><dt>${label}</dt><dd class="${cls}">${value || '—'}</dd></div>`;
  const direccion = [d.calle, d.numExt && `No. ${d.numExt}`, d.numInt && `Int. ${d.numInt}`].filter(Boolean).join(' ');
  const fotoIne = (lado, label) => `
    <figure class="ine-view">
      <img src="/api/promovidos/${p.id}/ine/${lado}" alt="${label} de la INE de ${esc(p.nombre)}">
      <figcaption>${label}</figcaption>
    </figure>`;
  const volver = state?.me?.role?.key === 'promotor' ? { href: '/promovidos', texto: 'Promovidos' } : { href: '/', texto: 'Panel' };
  return `
    <div class="promo-ficha">
      <a class="back-link" href="${volver.href}" data-link>${ICONS.back}<span>${volver.texto}</span></a>
      <div class="page-head page-head--actions">
        <div>
          <h2>${esc(p.nombre)}</h2>
          <p>${chipEstatus(p.estatus)} Sección ${fmtSeccion(p.seccion)} · registrado el ${fmtDate(p.createdAt)}${p.promotor ? ` por ${esc(p.promotor)}` : ''}${p.revisadoPor ? ` · revisado por ${esc(p.revisadoPor)}` : ''}</p>
        </div>
        <div class="promo-ficha__acciones">
          <a class="btn btn--secondary" href="/api/promovidos/${p.id}/pdf" download title="Descargar la ficha en PDF (sin historial ni observaciones)">${ICONO_PDF}<span>PDF</span></a>
          ${p.puedeEditar ? `<a class="btn btn--secondary" href="/promovidos/${p.id}/editar" data-link>${ICONS.edit}<span>Editar</span></a>` : ''}
        </div>
      </div>

      <div class="promo-ficha__grid ${p.puedeObservar ? '' : 'is-sola'}">
        <div class="promo-ficha__main">
          <section class="card form-card" aria-labelledby="pv1">
            <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.camera}</span><h3 id="pv1">Credencial para votar (INE)</h3></header>
            <div class="ine-views">${fotoIne('frente', 'Frente')}${fotoIne('reverso', 'Reverso')}</div>
            <dl class="ficha__grid">
              ${dato('Clave de elector', esc(p.claveElector), 'mono')}
              ${dato('CURP', esc(p.curp), 'mono')}
              ${dato('Vigencia', esc(p.vigencia))}
              ${dato('Sección', fmtSeccion(p.seccion))}
              ${dato('Teléfono (WhatsApp)', p.telefono ? `<a href="https://wa.me/52${esc(p.telefono)}" target="_blank" rel="noopener">${esc(fmtPhone(p.telefono))}</a>` : '')}
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
          <section class="card form-card" aria-labelledby="pv3">
            <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONO_HISTORIAL}</span><h3 id="pv3">Historial de cambios</h3></header>
            ${hist.length ? `<ol class="hist">${hist.map(itemHistorial).join('')}</ol>` : '<p class="muted">Sin movimientos.</p>'}
          </section>
        </div>

        ${
          p.puedeObservar
            ? `<aside class="card obs" aria-labelledby="obsT">
            <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONO_OBS}</span><h3 id="obsT">Observaciones</h3></header>
            <p class="obs__nota">Solo las ven el promotor y su responsable de sección.</p>
            <ol class="obs__lista" id="obsLista" aria-live="polite"><li class="obs__vacio">Cargando…</li></ol>
            <form class="obs__form" id="obsForm" novalidate>
              <label class="sr-only" for="obsTexto">Escribe una observación</label>
              <textarea class="input obs__texto" id="obsTexto" rows="1" maxlength="1000" placeholder="Escribe una observación"></textarea>
              <button class="obs__enviar" type="submit" aria-label="Enviar observación" title="Enviar">${ICONO_ENVIAR}</button>
            </form>
            <p class="field__error" id="obsErr" role="alert"></p>
          </aside>`
            : ''
        }
      </div>
    </div>`;
}

export function mountPromovido(root, route) {
  const p = route.promovido;
  if (!p?.puedeObservar) return undefined;
  const lista = $('#obsLista', root);
  const form = $('#obsForm', root);
  const texto = $('#obsTexto', root);
  const errEl = $('#obsErr', root);
  let ultimo = '';

  const pintar = (msgs) => {
    const firma = msgs.map((m) => m.id).join(',');
    if (firma === ultimo) return;
    ultimo = firma;
    const alFinal = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
    lista.innerHTML = msgs.length ? msgs.map(mensaje).join('') : '<li class="obs__vacio">Aún no hay observaciones.</li>';
    if (alFinal || msgs.at(-1)?.propia) lista.scrollTop = lista.scrollHeight;
  };
  const cargar = () =>
    api(`/api/promovidos/${p.id}/observaciones`)
      .then(pintar)
      .catch(() => {});
  cargar();
  // Se actualiza mientras la ficha está abierta
  const timer = setInterval(() => document.visibilityState === 'visible' && cargar(), 15000);

  // El campo crece con el texto; Enter envía y Mayús+Enter hace salto de línea
  const ajustar = () => {
    texto.style.height = 'auto';
    texto.style.height = `${Math.min(texto.scrollHeight, 140)}px`;
  };
  texto.addEventListener('input', ajustar);
  texto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = texto.value.trim();
    if (!t) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    errEl.textContent = '';
    try {
      await api(`/api/promovidos/${p.id}/observaciones`, { method: 'POST', body: { texto: t } });
      texto.value = '';
      ajustar();
      await cargar();
    } catch (err) {
      errEl.textContent = navigator.onLine ? err.message : 'Sin conexión. Intenta de nuevo.';
    } finally {
      btn.disabled = false;
      texto.focus();
    }
  });
  return () => clearInterval(timer);
}
