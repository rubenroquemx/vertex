// Cotizador de VERTEX (página semi pública: la clave del enlace va en la ruta /costos/<clave>).
// El cálculo lo hace el servidor; aquí solo se arma el formulario y se muestra el resultado.
const CLAVE = location.pathname.split('/').filter(Boolean)[1] || '';
const WA = '529932200146';
const $ = (s) => document.querySelector(s);
const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const MXN2 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM = new Intl.NumberFormat('es-MX');
const FECHA = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const FECHA_C = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const f = (iso) => FECHA.format(new Date(`${iso}T12:00:00Z`));
const fc = (iso) => FECHA_C.format(new Date(`${iso}T12:00:00Z`));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ETIQUETA = { federal: 'Distrito federal', local: 'Distrito local', municipal: 'Municipio' };
const DESC = {
  estatal: 'Toda la entidad',
  federal: 'Un distrito electoral federal',
  local: 'Un distrito electoral local',
  municipal: 'Un municipio o alcaldía',
};

let datos = null;
let ultima = null;

async function api(path, body) {
  const r = await fetch(`/api/costos/${encodeURIComponent(CLAVE)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'No se pudo calcular'), { data: j });
  return j;
}

const tipo = () => document.querySelector('input[name="tipo"]:checked')?.value || null;
const modo = () => document.querySelector('input[name="modo"]:checked').value;

function pintarTipos() {
  $('#czTipos').innerHTML = Object.entries(datos.tipos)
    .map(
      ([k, nombre]) => `<label class="cz-tipo"><input type="radio" name="tipo" value="${k}"><strong>${esc(nombre.split(' (')[0])}</strong><span>${esc(DESC[k])}</span></label>`
    )
    .join('');
}

function pintarEntidades() {
  const sel = $('#czEntidad');
  sel.innerHTML = datos.territorios.map((t) => `<option value="${t.clave}">${esc(t.nombre)} · ${NUM.format(t.ln)} en lista</option>`).join('');
}

function pintarTerritorios() {
  const t = tipo();
  const ent = datos.territorios.find((x) => String(x.clave) === $('#czEntidad').value);
  const campo = $('#czClaveCampo');
  const ayuda = $('#czListaAyuda');
  ayuda.textContent = ent?.corte ? `Lista nominal del INE con corte ${ent.corte}.` : '';
  if (!t || t === 'estatal' || !ent) {
    campo.hidden = true;
    return;
  }
  const lista = ent[t] || [];
  campo.hidden = false;
  $('#czClaveLbl').textContent = ETIQUETA[t];
  const sel = $('#czClave');
  const previo = sel.value;
  sel.innerHTML = lista.length
    ? `<option value="">Elige…</option>${lista.map((x) => `<option value="${x.clave}">${esc(x.nombre)} · ${NUM.format(x.ln)}</option>`).join('')}`
    : '<option value="">No hay datos de este nivel para la entidad</option>';
  if (lista.some((x) => String(x.clave) === previo)) sel.value = previo;
  if (!lista.length) ayuda.textContent = `No hay ${ETIQUETA[t].toLowerCase()}s cargados para ${ent.nombre}. Usa «Capturar lista nominal».`;
}

function limpiarErrores() {
  for (const id of ['tipo', 'entidad', 'clave', 'ln']) $(`#${id}-err`).textContent = '';
  $('#czErr').textContent = '';
}

function cuerpo() {
  const c = { tipo: tipo() };
  if (modo() === 'manual') {
    c.ln = $('#czLn').value.replace(/[^\d]/g, '');
    c.nombre = $('#czNombre').value.trim();
  } else {
    c.entidad = $('#czEntidad').value;
    if (c.tipo !== 'estatal') c.clave = $('#czClave').value;
  }
  return c;
}

// ¿Hay lo mínimo para cotizar? (evita errores mientras la persona todavía está eligiendo)
function completo(c) {
  if (!c.tipo) return false;
  if (modo() === 'manual') return Number(c.ln) >= 100;
  if (!c.entidad) return false;
  return c.tipo === 'estatal' || Boolean(c.clave);
}

let turno = 0;
let espera = 0;
function calcular() {
  clearTimeout(espera);
  espera = setTimeout(async () => {
    const c = cuerpo();
    limpiarErrores();
    if (!completo(c)) return mostrar(null);
    const yo = ++turno;
    $('#czRes').classList.add('is-cargando');
    try {
      const r = await api('/cotizar', c);
      if (yo === turno) mostrar(r);
    } catch (err) {
      if (yo !== turno) return;
      const campos = err.data?.fields || {};
      let puesto = false;
      for (const [k, v] of Object.entries(campos)) {
        const el = $(`#${k}-err`);
        if (el) {
          el.textContent = v;
          puesto = true;
        }
      }
      if (!puesto) $('#czErr').textContent = err.message;
      mostrar(null);
    } finally {
      if (yo === turno) $('#czRes').classList.remove('is-cargando');
    }
  }, 220);
}

function mostrar(r) {
  ultima = r;
  $('#czVacio').hidden = Boolean(r);
  $('#czOk').hidden = !r;
  if (!r) return;
  $('#rTipo').textContent = r.tipoNombre;
  $('#rTerr').textContent = r.territorio;
  $('#rLn').textContent = NUM.format(r.ln);
  $('#rTotal').textContent = MXN.format(r.subtotal);
  $('#rIva').textContent = `+ IVA ${r.ivaPct} %: ${MXN.format(r.iva)} · Total con IVA ${MXN.format(r.total)}`;
  $('#rInst').textContent = MXN.format(r.instalacion);
  $('#rMens').textContent = MXN.format(r.mensual);
  $('#rMeses').textContent = `${r.meses} ${r.meses === 1 ? 'mes' : 'meses'}`;
  $('#rElector').textContent = MXN2.format(r.porElector);
  $('#rPeriodo').innerHTML = `<strong>Contratando hoy</strong>, ${esc(f(r.inicio))}: servicio hasta el ${esc(f(r.fin))}, 30 días después de la elección.${
    r.minimoAplicado ? ` Se aplica el mínimo de ${r.minMeses} meses.` : ''
  }`;
  $('#rPrimer').textContent = `${MXN.format(r.pagos[0].monto)} + IVA`;
  $('#rCalN').textContent = `${r.pagos.length} pagos`;
  $('#rCal').innerHTML = r.pagos
    .map((p) => `<tr><td>${esc(fc(p.fecha))}</td><td>${esc(p.concepto)}</td><td class="num">${MXN.format(p.monto)}</td><td class="num">${MXN.format(p.monto + p.iva)}</td></tr>`)
    .join('');
  $('#rHoy').textContent = f(datos.hoy);
  const texto = [
    'Hola, me interesa contratar VERTEX con esta cotización:',
    `• ${r.tipoNombre}: ${r.territorio}`,
    `• Lista nominal: ${NUM.format(r.ln)}`,
    `• Contratando hoy (${f(r.inicio)}) · ${r.meses} meses`,
    `• Total: ${MXN.format(r.subtotal)} + IVA`,
    `• Primer pago: ${MXN.format(r.pagos[0].monto)} + IVA`,
  ].join('\n');
  $('#rWa').href = `https://wa.me/${WA}?text=${encodeURIComponent(texto)}`;
}

function cambiarModo() {
  const manual = modo() === 'manual';
  $('#modoLista').hidden = manual;
  $('#modoManual').hidden = !manual;
  calcular();
}

async function iniciar() {
  try {
    datos = await api('');
  } catch {
    $('#czApp').innerHTML = '<p class="cz-err">Este enlace ya no es válido. Pide uno nuevo a tu contacto de VERTEX.</p>';
    return;
  }
  pintarTipos();
  if (datos.territorios.length) {
    pintarEntidades();
  } else {
    // Sin padrón cargado: solo captura manual
    document.querySelector('input[name="modo"][value="manual"]').checked = true;
    $('#czModo').hidden = true;
    cambiarModo();
  }
  $('#czTipos').addEventListener('change', () => {
    pintarTerritorios();
    calcular();
  });
  $('#czModo').addEventListener('change', cambiarModo);
  $('#czEntidad').addEventListener('change', () => {
    pintarTerritorios();
    calcular();
  });
  $('#czClave').addEventListener('change', calcular);
  $('#czLn').addEventListener('input', (e) => {
    const n = e.target.value.replace(/[^\d]/g, '');
    e.target.value = n ? NUM.format(Number(n)) : '';
    calcular();
  });
  $('#czNombre').addEventListener('input', calcular);
  $('#rPrint').addEventListener('click', () => {
    $('#rCalWrap').open = true;
    window.print();
  });
  $('#czApp').setAttribute('aria-busy', 'false');
}

document.addEventListener('DOMContentLoaded', iniciar);
