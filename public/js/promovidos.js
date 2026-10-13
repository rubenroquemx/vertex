// Promovidos del Promotor Territorial: captura (INE + datos + domicilio) y lista.
// La sección y la vigencia se validan aquí para avisar al momento, y de nuevo en el servidor.
import { ICONS, $, esc, fmtNum, fmtSeccion, fmtDate, fmtDateTime, fmtPhone, api, fieldErrorSetter, toast, navigate } from './lib.js';
import { I, debounce } from './coordinador.js';
import { camaraDisponible, abrirCamara, ajustarEnGuia } from './ine-camara.js';
import { kv, pendientes, sesion, buscarCPLocal, esErrorDeRed, sincronizar, pedirEnvioEnSegundoPlano } from './offline.js';

const sinSeccion = (msg, titulo = 'Aún no puedes capturar promovidos') => `
  <div class="empty">
    <span aria-hidden="true">${ICONS.map}</span>
    <strong>${esc(titulo)}</strong>
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
const PASOS = ['Frente de la INE', 'Reverso de la INE', 'Datos generales', 'Domicilio', 'Verificación'];
const ULTIMO = PASOS.length;
const PASO_DE = {
  consentimiento: 5,
  ineFrente: 1,
  ineReverso: 2,
  vigencia: 3,
  seccion: 3,
  paterno: 3,
  materno: 3,
  nombres: 3,
  claveElector: 3,
  curp: 3,
  telefono: 3,
  cp: 4,
  localidad: 4,
  calle: 4,
  numExt: 4,
  numInt: 4,
  fracc: 4,
};
const CLAVE_RE = /^[A-Z]{6}\d{8}[HMX]\d{3}$/;
const CURP_RE = /^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z\d]\d$/;

// `editando`: id del promovido al editar (cancelar regresa a su ficha)
const acciones = (paso, editando = null) => `
  <div class="wiz-actions">
    ${paso === 1 ? `<a class="btn btn--secondary" href="/promovidos${editando ? `/${editando}` : ''}" data-link>Cancelar</a>` : '<button type="button" class="btn btn--secondary" data-wiz="atras">Atrás</button>'}
    ${paso === ULTIMO ? `<button class="btn" type="submit">${editando ? 'Guardar cambios' : 'Guardar promovido'}</button>` : '<button type="button" class="btn" data-wiz="sig">Siguiente</button>'}
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
    if (!p.puedeEditar) {
      return sinSeccion(
        p.bloqueadoPorAprobacion
          ? 'Este promovido ya fue aprobado y no se puede modificar. Si hay que corregir algo, pídeselo a tu Responsable de Sección en las observaciones.'
          : 'Solo el promotor que lo capturó y su Responsable de Sección pueden editar este registro.',
        'No se puede modificar'
      );
    }
    route.actual = p;
    ctx = { seccion: p.seccionPermitida, vigenciaMin: p.vigenciaMin, eleccion: p.eleccion };
  } else {
    try {
      ctx = await api('/api/promovidos/contexto');
      kv.set('contexto', ctx);
    } catch (err) {
      if (err.status === 409) return sinSeccion(err.message);
      // Sin internet: se captura con el contexto guardado la última vez que hubo señal
      ctx = esErrorDeRed(err) ? await kv.get('contexto') : null;
      if (!ctx) {
        if (esErrorDeRed(err)) return sinSeccion('Para capturar sin internet, primero abre la app una vez con conexión.', 'Sin conexión');
        throw err;
      }
    }
    // Corrección de un promovido guardado en el teléfono que el servidor rechazó
    const idPendiente = new URLSearchParams(location.search).get('pendiente');
    route.pendiente = idPendiente ? (await pendientes.get(idPendiente)) || null : null;
  }
  route.ctx = ctx;
  return `
    <div class="wiz">
      <div class="wiz-bar" role="progressbar" aria-label="Avance de la captura" aria-valuemin="1" aria-valuemax="${PASOS.length}" aria-valuenow="1">
        <div class="wiz-bar__track" style="--pasos: ${PASOS.length}" aria-hidden="true">${PASOS.map(() => '<span></span>').join('')}</div>
        <p class="wiz-bar__label" id="wizLabel">Paso 1 de ${PASOS.length} · ${PASOS[0]}</p>
      </div>

      <div class="wiz-aviso" id="wizAviso" hidden></div>
      <form id="promoForm" novalidate>
        <section class="card wiz-step" data-paso="1" aria-label="Paso 1: ${PASOS[0]}">
          <p class="wiz-step__help">${editando ? 'La foto guardada se conserva; tómala o cárgala de nuevo solo si quieres reemplazarla.' : 'Toma o carga la foto del frente de la INE y encuádrala en la guía: se guarda solo lo que queda dentro del marco.'}</p>
          ${campoFoto('pFrente', 'Frente de la INE')}
          <div class="ine-cam" id="pFrenteGuia" hidden></div>
          ${acciones(1, editando)}
        </section>

        <section class="card wiz-step" data-paso="2" aria-label="Paso 2: ${PASOS[1]}" hidden>
          <p class="wiz-step__help">${editando ? 'La foto guardada se conserva; tómala o cárgala de nuevo solo si quieres reemplazarla.' : 'Ahora la foto del reverso de la INE, también encuadrada en la guía.'}</p>
          ${campoFoto('pReverso', 'Reverso de la INE')}
          <div class="ine-cam" id="pReversoGuia" hidden></div>
          ${acciones(2, editando)}
        </section>

        <section class="card wiz-step" data-paso="3" aria-label="Paso 3: ${PASOS[2]}" hidden>
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
          ${acciones(3, editando)}
        </section>

        <section class="card wiz-step" data-paso="4" aria-label="Paso 4: ${PASOS[3]}" hidden>
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
          ${acciones(4, editando)}
        </section>

        <section class="card wiz-step" data-paso="5" aria-label="Paso 5: ${PASOS[4]}" hidden>
          <p class="wiz-step__help">Revisa que los datos coincidan con la credencial antes de guardar.</p>
          <div id="wizResumen"></div>
          ${
            editando
              ? ''
              : `<div class="consent">
            <label class="consent__check"><input type="checkbox" id="pConsent" name="consentimiento" value="1">
              <span>La persona conoce el <a href="/aviso-de-privacidad" target="_blank" rel="noopener">aviso de privacidad</a> y da su consentimiento para el tratamiento de sus datos.</span></label>
            <p class="field__error" id="pConsent-err"></p>
            <button type="button" class="link-btn consent__wa" id="pAvisoWa">Enviarle el aviso por WhatsApp</button>
          </div>`
          }
          <p class="form-error" id="pFormErr" role="alert"></p>
          ${acciones(5, editando)}
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
  // El consentimiento solo se pide al capturar (no al editar)
  if ($('#pConsent', root)) fields.consentimiento = 'pConsent';
  const setErrors = fieldErrorSetter(root, fields);
  const err = (id, msg) => ($(`#${id}-err`, root).textContent = msg || '');
  const val = (id) => $(`#${id}`, root).value.trim();
  const fotos = { ineFrente: null, ineReverso: null };

  // ---------- Fotos: cámara con guía o imagen cargada ----------
  const LADOS = { pFrente: { key: 'ineFrente', titulo: 'Frente de la INE' }, pReverso: { key: 'ineReverso', titulo: 'Reverso de la INE' } };
  // Cada paso de foto tiene su propia guía (cámara en vivo o ajuste de la imagen)
  const guia = (id) => $(`#${id}Guia`, root);
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
      cerrarCamara = await ajustarEnGuia(guia(id), {
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
      cerrarCamara = await abrirCamara(guia(id), {
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
      const camBox = guia(id);
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
      // Primero el catálogo guardado en el teléfono (funciona sin internet); si no está, el servidor
      const r = (await buscarCPLocal(v)) || (await api(`/api/cp/${v}`));
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
      limpiarCP(esErrorDeRed(e) ? 'Sin internet' : 'Código postal no encontrado');
      err('pCp', e.status === 404 ? 'No encontramos ese código postal.' : esErrorDeRed(e) ? 'Sin internet no se puede buscar este código postal; revisa que sea de tu estado.' : e.message);
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
    // Al editar, las fotos guardadas cuentan
    if (n === 1 && !fotos.ineFrente && !route.actual) e.ineFrente = 'Toma o carga la foto del frente.';
    if (n === 2 && !fotos.ineReverso && !route.actual) e.ineReverso = 'Toma o carga la foto del reverso.';
    if (n === 3) {
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
    if (n === 4) {
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
      bloque('Credencial', 3, [fila('Vigencia', val('pVigencia')), fila('Sección', fmtSeccion(val('pSeccion')))]),
      bloque('Datos personales', 3, [
        fila('Apellido paterno', val('pPaterno')),
        fila('Apellido materno', val('pMaterno')),
        fila('Nombre(s)', val('pNombres')),
        fila('Clave de elector', val('pClave')),
        fila('CURP', val('pCurp')),
        fila('Teléfono (WhatsApp)', fmtPhone(val('pTelefono'))),
      ]),
      bloque('Domicilio', 4, [
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
    // Al cambiar de paso se apaga la cámara
    cerrarCamara?.();
    cerrarCamara = null;
    if (n === ULTIMO) resumen();
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

  // ---------- Captura sin internet: borrador automático y corrección de pendientes ----------
  // Lo escrito (y las fotos) se guarda en el teléfono mientras se captura: si la app se cierra,
  // al volver se recupera.
  const nueva = !actual;
  const pendiente = route.pendiente || null;
  const campos = () => Object.fromEntries([...new FormData(form)].filter(([, v]) => typeof v === 'string'));
  const instantanea = () => ({ campos: campos(), fotos: { ...fotos }, localidad: localidad(), paso });
  const restaurar = (snap) => {
    for (const [k, v] of Object.entries(snap.campos || {})) {
      const el = form.elements.namedItem(k);
      if (el?.type === 'checkbox') el.checked = true;
      else if (el && 'value' in el && el.type !== 'file') el.value = v;
    }
    if (snap.fotos?.ineFrente) ponerFoto('pFrente', snap.fotos.ineFrente);
    if (snap.fotos?.ineReverso) ponerFoto('pReverso', snap.fotos.ineReverso);
    localidadInicial = snap.localidad || '';
    if (cp.value) cp.dispatchEvent(new Event('input'));
  };
  let guardarBorrador = () => {};
  const aviso = $('#wizAviso', root);
  if (nueva && pendiente) {
    restaurar(pendiente.snapshot);
    aviso.innerHTML = `<div class="notice notice--error">${ICONS.alert}<div><strong>Corrige este promovido guardado en tu teléfono.</strong> ${esc(pendiente.error || '')}</div></div>`;
    aviso.hidden = false;
    if (pendiente.fields) {
      setErrors(pendiente.fields);
      ir(Math.min(...Object.keys(pendiente.fields).map((k) => PASO_DE[k] || ULTIMO)));
    }
  } else if (nueva) {
    guardarBorrador = debounce(() => kv.set('borrador', { ...instantanea(), ownerId: sesion.userId, guardado: new Date().toISOString() }), 500);
    form.addEventListener('input', guardarBorrador);
    form.addEventListener('change', guardarBorrador);
    form.addEventListener('click', () => setTimeout(guardarBorrador, 0));
    kv.get('borrador').then((b) => {
      if (!b || b.ownerId !== sesion.userId) return;
      restaurar(b);
      if (b.paso) ir(Math.min(b.paso, ULTIMO));
      aviso.innerHTML = `<div class="notice">${ICONS.alert}<div><strong>Recuperamos la captura que no terminaste.</strong>
        <button type="button" class="link-btn" id="wizDescartar">Empezar de nuevo</button></div></div>`;
      aviso.hidden = false;
      $('#wizDescartar', root).addEventListener('click', () => {
        kv.del('borrador');
        aviso.hidden = true;
        limpiarTodo();
      });
    });
  }
  function limpiarTodo() {
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
  }

  // Aviso de privacidad por WhatsApp al teléfono de la persona
  $('#pAvisoWa', root)?.addEventListener('click', () => {
    const tel = val('pTelefono');
    const texto = `Hola ${val('pNombres')}, este es el aviso de privacidad sobre el uso de tus datos: ${location.origin}/aviso-de-privacidad`;
    window.open(`https://wa.me/${tel.length === 10 ? `52${tel}` : ''}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  });
  $('#pConsent', root)?.addEventListener('change', () => err('pConsent', ''));

  // Guarda la captura en el teléfono para enviarla cuando haya internet
  async function guardarEnTelefono(body) {
    // Una persona no puede estar dos veces entre los pendientes
    const dup = (await pendientes.todos(sesion.userId)).find(
      (p) => p.clientId !== body.clientId && (p.body.claveElector === body.claveElector || p.body.curp === body.curp)
    );
    if (dup) {
      formErr.textContent = `Esta persona ya está guardada en tu teléfono para enviarse (${dup.nombre}).`;
      return false;
    }
    await pendientes.poner({
      clientId: body.clientId,
      ownerId: sesion.userId,
      nombre: [body.nombres, body.paterno, body.materno].filter(Boolean).join(' ').toUpperCase(),
      creado: pendiente?.creado || body.capturadoAt,
      estado: 'pendiente',
      error: null,
      fields: null,
      body,
      snapshot: instantanea(),
    });
    pedirEnvioEnSegundoPlano();
    return true;
  }

  // ---------- Guardar ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (paso !== ULTIMO) return;
    const btn = form.querySelector('[type="submit"]');
    const body = {
      ...campos(),
      // Al editar solo se envían las fotos reemplazadas
      ineFrente: fotos.ineFrente,
      ineReverso: fotos.ineReverso,
      localidad: localidad(),
    };
    if (nueva) {
      body.consentimiento = Boolean($('#pConsent', root)?.checked);
      if (!body.consentimiento) {
        setErrors({ consentimiento: 'Confirma que la persona conoce el aviso de privacidad y da su consentimiento.' });
        return;
      }
      // Identificador propio de la captura: si el envío se repite, el servidor no la duplica
      body.clientId = pendiente?.clientId || route.clientId || (route.clientId = crypto.randomUUID());
      body.capturadoAt = pendiente?.body?.capturadoAt || new Date().toISOString();
    }
    const etiqueta = actual ? 'Guardar cambios' : 'Guardar promovido';
    formErr.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    let saved = null;
    let enTelefono = false;
    try {
      if (nueva && !navigator.onLine) throw Object.assign(new Error('Sin conexión'), { status: 0 });
      saved = actual
        ? await api(`/api/promovidos/${actual.id}`, { method: 'PUT', body })
        : await api('/api/promovidos', { method: 'POST', body });
    } catch (err) {
      const f = err.data?.fields;
      if (nueva && esErrorDeRed(err)) {
        // Sin internet: se guarda en el teléfono y se envía solo al recuperar la señal
        enTelefono = await guardarEnTelefono(body);
      } else if (f && Object.keys(f).length) {
        // Regresa al primer paso con error y lo marca
        ir(Math.min(...Object.keys(f).map((k) => PASO_DE[k] || ULTIMO)));
        setErrors(f);
      } else formErr.textContent = esErrorDeRed(err) ? 'Sin conexión: para editar necesitas internet.' : err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = etiqueta;
    }
    if (enTelefono) {
      kv.del('borrador');
      route.clientId = null;
      toast('Sin internet: guardado en tu teléfono. Se enviará solo al recuperar la señal.');
      if (pendiente) return navigate('/pendientes');
      limpiarTodo();
      return;
    }
    if (!saved) return;
    if (pendiente) {
      // El pendiente corregido ya se envió
      await pendientes.quitar(pendiente.clientId);
      kv.del('borrador');
      toast(`Promovido enviado: ${saved.nombre}`);
      sincronizar(sesion.userId);
      return navigate('/pendientes');
    }
    if (actual) {
      toast(saved.cambios ? 'Cambios guardados' : 'No hubo cambios que guardar');
      navigate(`/promovidos/${actual.id}`);
      return;
    }
    toast(`Promovido registrado (en revisión): ${saved.nombre}`);
    // Listo para la siguiente captura
    kv.del('borrador');
    route.clientId = null;
    limpiarTodo();
  });

  // Al salir de la pantalla se apaga la cámara
  return () => cerrarCamara?.();
}

// Estatus de revisión del promovido (lo valida su Responsable de Sección directo)
// Semáforo: verde aprobado · rojo con observaciones del responsable (o rechazado) · naranja en revisión
const ESTATUS = {
  validado: { texto: 'Aprobado', clase: 'estatus--aprobado' },
  observaciones: { texto: 'Con observaciones', clase: 'estatus--observaciones' },
  rechazado: { texto: 'Rechazado', clase: 'estatus--observaciones' },
  en_revision: { texto: 'En revisión', clase: 'estatus--revision' },
};
const chipEstatus = (p) => {
  const clave = p.estatus === 'validado' ? 'validado' : p.estatus === 'rechazado' ? 'rechazado' : p.conObservaciones ? 'observaciones' : 'en_revision';
  const x = ESTATUS[clave];
  return `<span class="estatus ${x.clase}">${x.texto}</span>`;
};

// ===========================================================================
// Lista del promotor: agrupada por estatus (primero lo que requiere atención) y alfabética
// ===========================================================================
const GRUPOS = [
  { clave: 'observaciones', titulo: 'Con observaciones', clase: 'is-observaciones' },
  { clave: 'revision', titulo: 'En revisión', clase: 'is-revision' },
  { clave: 'aprobado', titulo: 'Aprobados', clase: 'is-aprobado' },
];
const grupoDe = (p) => (p.estatus === 'validado' ? 'aprobado' : p.estatus === 'rechazado' || p.conObservaciones ? 'observaciones' : 'revision');
// Aviso de promovidos guardados en el teléfono sin enviar
async function avisoPendientes() {
  const n = (await pendientes.todos(sesion.userId)).length;
  return n
    ? `<a class="pend-aviso" href="/pendientes" data-link>${ICONS.upload}<span><strong>${fmtNum(n)}</strong> ${n === 1 ? 'promovido guardado' : 'promovidos guardados'} en tu teléfono por enviar</span><span aria-hidden="true">›</span></a>`
    : '';
}

export async function viewPromovidos() {
  let lista;
  try {
    lista = await api('/api/promovidos');
  } catch (err) {
    if (!esErrorDeRed(err)) throw err;
    return `${await avisoPendientes()}
      <div class="empty"><span aria-hidden="true">${ICONS.alert}</span><strong>Sin internet</strong>
        <span>La lista se verá cuando recuperes la señal. Mientras tanto puedes seguir capturando: se guarda en tu teléfono.</span>
        <a class="btn btn--sm" href="/promovidos/nuevo" data-link>${ICONS.plus}<span>Capturar promovido</span></a></div>`;
  }
  return `
    ${await avisoPendientes()}
    <div class="promo-lista__acciones">
      <a class="btn promo-new" href="/promovidos/nuevo" data-link>${ICONS.plus}<span>Nuevo promovido</span></a>
    </div>
    ${
      lista.length
        ? GRUPOS.map((g) => {
            const del = lista.filter((p) => grupoDe(p) === g.clave).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
            if (!del.length) return '';
            return `<section class="promo-grupo" aria-labelledby="g-${g.clave}">
              <h3 class="promo-grupo__titulo" id="g-${g.clave}"><span class="promo-dot ${g.clase}" aria-hidden="true"></span>${g.titulo}<span class="promo-grupo__n">${fmtNum(del.length)}</span></h3>
              <ul class="promo-list">${del
                .map(
                  (p) => `<li class="promo-fila"><a class="promo-item" href="/promovidos/${p.id}" data-link>
                    <span class="promo-ini ${g.clase}" aria-hidden="true">${esc(p.iniciales)}</span>
                    <span class="promo-item__txt">
                      <strong>${esc(p.nombre)}</strong>
                      <span class="promo-item__mod">Última modificación: ${esc(fmtDateTime(p.modificado))}</span>
                    </span>
                    <span class="sr-only">${g.titulo}</span>
                  </a>
                  <span class="promo-contacto">${
                    p.telefono
                      ? `<a class="icon-btn promo-contacto__btn" href="tel:+52${esc(p.telefono)}" title="Llamar" aria-label="Llamar a ${esc(p.nombre)}">${I.phone}</a>
                         <a class="icon-btn promo-contacto__btn" href="https://wa.me/52${esc(p.telefono)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp con ${esc(p.nombre)}">${I.whatsapp}</a>`
                      : `<span class="icon-btn promo-contacto__btn is-off" title="Sin teléfono" aria-label="Sin teléfono">${I.phone}</span>
                         <span class="icon-btn promo-contacto__btn is-off" title="Sin teléfono" aria-label="Sin teléfono">${I.whatsapp}</span>`
                  }</span></li>`
                )
                .join('')}</ul>
            </section>`;
          }).join('')
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
const ICONO_OK = icono('<path d="M20 6 9 17l-5-5"/>');
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
    <figure class="ine-view" data-lupa>
      <img src="/api/promovidos/${p.id}/ine/${lado}" alt="${label} de la INE de ${esc(p.nombre)}">
      <figcaption>${label}</figcaption>
    </figure>`;
  const rol = state?.me?.role?.key;
  const volver = ['promotor', 'resp_seccion'].includes(rol) ? { href: '/promovidos', texto: 'Promovidos' } : { href: '/', texto: 'Panel' };
  // Revisión del Responsable de Sección: aprobar o rechazar con motivo
  const revision = p.puedeRevisar
    ? `<section class="card rev-card" id="revCard" aria-labelledby="revT">
        <div class="rev-card__txt">
          <h3 id="revT">${p.estatus === 'rechazado' ? 'Rechazado: ¿ya está corregido?' : '¿Los datos coinciden con la INE?'}</h3>
          <p>Compara las fotos con la clave de elector, la CURP, la vigencia y el domicilio. Al aprobarlo, el promotor ya no podrá modificarlo.</p>
          <p class="rev-atajos">Atajos: <kbd>A</kbd> aprobar · <kbd>R</kbd> rechazar</p>
        </div>
        <div class="rev-card__acc" id="revAcc">
          <button class="btn btn--aprobar" type="button" id="revAprobar">${ICONO_OK}<span>Aprobar</span></button>
          ${p.estatus === 'rechazado' ? '' : `<button class="btn btn--secondary" type="button" id="revRechazar">${ICONS.close}<span>Rechazar</span></button>`}
        </div>
        <form class="rev-card__form" id="revForm" hidden novalidate>${menuMotivo('revM')}</form>
        <p class="form-error" id="revErr" role="alert"></p>
      </section>`
    : '';
  return `
    <div class="promo-ficha">
      <a class="back-link" href="${volver.href}" data-link>${ICONS.back}<span>${volver.texto}</span></a>
      <div class="page-head page-head--actions">
        <div>
          <h2>${esc(p.nombre)}</h2>
          ${p.bloqueadoPorAprobacion ? '<p class="promo-bloqueado">Aprobado: ya no se puede modificar. Si hay que corregir algo, pídeselo a tu Responsable de Sección.</p>' : ''}
          <p>${chipEstatus(p)} Sección ${fmtSeccion(p.seccion)} · registrado el ${fmtDate(p.createdAt)}${p.promotor ? ` por ${esc(p.promotor)}` : ''}${p.revisadoPor ? ` · revisado por ${esc(p.revisadoPor)}` : ''}</p>
        </div>
        <div class="promo-ficha__acciones">
          ${p.fotosOcultas ? '' : `<a class="btn btn--secondary" href="/api/promovidos/${p.id}/pdf" download title="Descargar la ficha en PDF (sin historial ni observaciones)">${ICONO_PDF}<span>PDF</span></a>`}
          ${p.puedeEditar ? `<a class="btn btn--secondary" href="/promovidos/${p.id}/editar" data-link>${ICONS.edit}<span>Editar</span></a>` : ''}
        </div>
      </div>

      ${revision}
      <div class="promo-ficha__grid ${p.puedeObservar ? '' : 'is-sola'}">
        <div class="promo-ficha__main">
          <section class="card form-card" aria-labelledby="pv1">
            <header class="form-card__head"><span class="form-card__icon" aria-hidden="true">${ICONS.camera}</span><h3 id="pv1">Credencial para votar (INE)</h3></header>
            ${
              p.fotosOcultas
                ? `<div class="notice">${ICONS.alert}<div>Las fotos de la INE no se muestran al super administrador (tampoco en modo dios).</div></div>`
                : `<div class="ine-views">${fotoIne('frente', 'Frente')}${fotoIne('reverso', 'Reverso')}</div>`
            }
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

// Menú del motivo de rechazo: opciones frecuentes u «Otra» con texto libre
const MOTIVOS = ['INE no vigente', 'Sección inválida'];
const menuMotivo = (id) => `
  <fieldset class="rev-motivos">
    <legend>¿Por qué se rechaza?</legend>
    ${MOTIVOS.map((m) => `<label class="rev-motivo"><input type="radio" name="${id}" value="${m}"><span>${m}</span></label>`).join('')}
    <label class="rev-motivo"><input type="radio" name="${id}" value="otra"><span>Otra</span></label>
    <input class="input rev-motivo__otra" type="text" maxlength="300" placeholder="Menciona el motivo" aria-label="Otro motivo" hidden>
    <p class="field__error" data-motivo-err role="alert"></p>
    <div class="rev-card__btns">
      <button class="btn btn--secondary btn--sm" type="button" data-motivo-cancelar>Cancelar</button>
      <button class="btn btn--destructive btn--sm" type="submit">Rechazar</button>
    </div>
  </fieldset>`;

// Conecta un menú de motivo; devuelve una función para limpiarlo
function conectarMotivo(form, { onCancelar, onEnviar }) {
  const otra = form.querySelector('.rev-motivo__otra');
  const errEl = form.querySelector('[data-motivo-err]');
  form.addEventListener('change', (e) => {
    if (e.target.type !== 'radio') return;
    errEl.textContent = '';
    otra.hidden = e.target.value !== 'otra';
    if (!otra.hidden) otra.focus();
  });
  form.querySelector('[data-motivo-cancelar]').addEventListener('click', onCancelar);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const elegido = form.querySelector('input[type="radio"]:checked');
    const motivo = !elegido ? '' : elegido.value === 'otra' ? otra.value.trim() : elegido.value;
    if (!elegido) errEl.textContent = 'Elige el motivo del rechazo.';
    else if (elegido.value === 'otra' && motivo.length < 5) errEl.textContent = 'Menciona el motivo (al menos 5 letras).';
    else onEnviar(motivo, e.submitter || form.querySelector('[type="submit"]'), errEl);
  });
  return () => {
    form.reset();
    otra.hidden = true;
    errEl.textContent = '';
  };
}

// Aprobar / rechazar; al terminar abre el siguiente pendiente de la bandeja
function montarRevision(root, p) {
  const card = $('#revCard', root);
  if (!card) return;
  const err = $('#revErr', root);
  const enviar = async (body, boton, errEl = err) => {
    err.textContent = '';
    boton.disabled = true;
    try {
      const r = await api(`/api/promovidos/${p.id}/revision`, { method: 'POST', body });
      toast(r.estatus === 'validado' ? `${p.nombre} aprobado` : `${p.nombre} rechazado`);
      navigate(r.siguiente ? `/promovidos/${r.siguiente}` : '/promovidos');
    } catch (e) {
      errEl.textContent = e.data?.fields?.motivo || e.message;
      boton.disabled = false;
    }
  };
  const rechazar = (motivo, boton, errEl) => enviar({ accion: 'rechazar', motivo }, boton, errEl);
  $('#revAprobar', root).addEventListener('click', (e) => enviar({ accion: 'aprobar' }, e.currentTarget));
  const form = $('#revForm', root);
  const limpiarForm = conectarMotivo(form, {
    onCancelar: () => {
      limpiarForm();
      form.hidden = true;
      $('#revAcc', root).hidden = false;
    },
    onEnviar: rechazar,
  });
  $('#revRechazar', root)?.addEventListener('click', () => {
    $('#revAcc', root).hidden = true;
    form.hidden = false;
    form.querySelector('input[type="radio"]').focus();
  });

  // Al bajar (tarjeta fuera de vista), los botones quedan abajo en pequeño: palomita y tache
  const mini = document.createElement('div');
  mini.className = 'rev-mini';
  mini.hidden = true;
  const puedeRechazar = Boolean($('#revRechazar', root));
  mini.innerHTML = `
    ${puedeRechazar ? `<form class="rev-mini__menu" id="revMiniMenu" hidden novalidate>${menuMotivo('revMiniM')}</form>` : ''}
    <div class="rev-mini__btns">
      <button class="rev-mini__btn rev-mini__btn--ok" type="button" title="Aprobar" aria-label="Aprobar a ${esc(p.nombre)}">${ICONO_OK}</button>
      ${puedeRechazar ? `<button class="rev-mini__btn rev-mini__btn--no" type="button" title="Rechazar" aria-label="Rechazar a ${esc(p.nombre)}" aria-expanded="false" aria-controls="revMiniMenu">${ICONS.close}</button>` : ''}
    </div>`;
  root.appendChild(mini);
  mini.querySelector('.rev-mini__btn--ok').addEventListener('click', (e) => enviar({ accion: 'aprobar' }, e.currentTarget));
  // La tachita abre el menú del motivo justo arriba de los botones
  const menu = $('#revMiniMenu', mini);
  const btnNo = mini.querySelector('.rev-mini__btn--no');
  let limpiarMenu = () => {};
  const cerrarMenu = () => {
    if (!menu) return;
    limpiarMenu();
    menu.hidden = true;
    btnNo.setAttribute('aria-expanded', 'false');
  };
  if (menu) limpiarMenu = conectarMotivo(menu, { onCancelar: cerrarMenu, onEnviar: rechazar });
  btnNo?.addEventListener('click', () => {
    if (!menu.hidden) return cerrarMenu();
    menu.hidden = false;
    btnNo.setAttribute('aria-expanded', 'true');
    menu.querySelector('input[type="radio"]').focus();
  });
  const io = new IntersectionObserver(([en]) => {
    mini.hidden = en.isIntersecting || en.boundingClientRect.top > 0;
    if (mini.hidden) cerrarMenu();
  });
  io.observe(card);
  // Atajos en computadora: A aprueba, R abre el motivo del rechazo
  const atajos = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      $('#revAprobar', root)?.click();
    } else if ((e.key === 'r' || e.key === 'R') && $('#revRechazar', root)) {
      e.preventDefault();
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      $('#revRechazar', root).click();
    }
  };
  document.addEventListener('keydown', atajos);
  return () => {
    io.disconnect();
    document.removeEventListener('keydown', atajos);
  };
}

// Lupa sobre las fotos de la INE: con el mouse sigue al puntero; en el celular se activa
// dejando el dedo sobre la foto (un deslizamiento rápido sigue desplazando la página)
const ZOOM = 2.6;
function montarLupa(root) {
  for (const fig of root.querySelectorAll('[data-lupa]')) {
    const img = fig.querySelector('img');
    const lente = document.createElement('div');
    lente.className = 'lupa';
    lente.hidden = true;
    lente.setAttribute('aria-hidden', 'true');
    fig.appendChild(lente);
    fig.querySelector('figcaption')?.insertAdjacentHTML('beforeend', ' <span class="lupa-ayuda lupa-ayuda--mouse">· pasa el mouse para ampliar</span><span class="lupa-ayuda lupa-ayuda--dedo">· mantén el dedo sobre la foto para ampliar</span>');

    const mover = (clientX, clientY, tactil) => {
      const box = img.getBoundingClientRect();
      const x = Math.min(Math.max(clientX - box.left, 0), box.width);
      const y = Math.min(Math.max(clientY - box.top, 0), box.height);
      const d = lente.offsetWidth;
      lente.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
      lente.style.backgroundSize = `${box.width * ZOOM}px ${box.height * ZOOM}px`;
      lente.style.backgroundPosition = `${-(x * ZOOM - d / 2)}px ${-(y * ZOOM - d / 2)}px`;
      // Con el dedo, la lente va arriba para que no la tape
      const offY = tactil ? -d * 0.75 : 0;
      lente.style.left = `${img.offsetLeft + x - d / 2}px`;
      lente.style.top = `${img.offsetTop + y - d / 2 + offY}px`;
    };
    const mostrar = () => img.complete && img.naturalWidth && (lente.hidden = false);
    const ocultar = () => (lente.hidden = true);

    // Mouse
    img.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && mostrar());
    img.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && mover(e.clientX, e.clientY, false));
    img.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && ocultar());

    // Dedo: mantener ~0.2 s sin moverse activa la lupa; mientras está activa no se desplaza la página
    let timer = null;
    let activa = false;
    let inicio = null;
    img.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0];
        inicio = { x: t.clientX, y: t.clientY };
        timer = setTimeout(() => {
          activa = true;
          mostrar();
          mover(inicio.x, inicio.y, true);
        }, 200);
      },
      { passive: true }
    );
    img.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches[0];
        if (activa) {
          e.preventDefault();
          mover(t.clientX, t.clientY, true);
        } else if (inicio && Math.hypot(t.clientX - inicio.x, t.clientY - inicio.y) > 8) {
          clearTimeout(timer);
        }
      },
      { passive: false }
    );
    const fin = () => {
      clearTimeout(timer);
      activa = false;
      ocultar();
    };
    img.addEventListener('touchend', fin);
    img.addEventListener('touchcancel', fin);
    // Evita el menú de «guardar imagen» al mantener el dedo
    img.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

export function mountPromovido(root, route) {
  const p = route.promovido;
  let quitarRevision = null;
  if (p) {
    quitarRevision = montarRevision(root, p) || null;
    montarLupa(root);
  }
  if (!p?.puedeObservar) return quitarRevision || undefined;
  const lista = $('#obsLista', root);
  const form = $('#obsForm', root);
  const texto = $('#obsTexto', root);
  const errEl = $('#obsErr', root);
  // null (no '') para que una lista vacía también se pinte la primera vez
  let ultimo = null;

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
  return () => {
    clearInterval(timer);
    quitarRevision?.();
  };
}
