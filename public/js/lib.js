// Utilidades compartidas por los módulos de la interfaz.
// ---------------------------------------------------------------------------
// Íconos (SVG inline, trazo)
// ---------------------------------------------------------------------------
const icon = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICONS = {
  map: icon('<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>'),
  dashboard: icon('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
  tree: icon('<circle cx="12" cy="4" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="19" cy="20" r="2"/><path d="M12 6v8M5 18v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2M12 14v4"/>'),
  bitacora: icon('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>'),
  check: icon('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  calendar: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
  box: icon('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  users: icon('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M16 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  camera: icon('<path d="M3 8a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>'),
  upload: icon('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  trash: icon('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>'),
  database: icon('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  fileZip: icon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M10 6h1M10 9h1M10 12h1M10 15h2v3h-2z"/>'),
  back: icon('<path d="M15 18l-6-6 6-6"/>'),
  edit: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  logout: icon('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4"/>'),
  eye: icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  alert: icon('<path d="M12 3 2 21h20z"/><path d="M12 10v4M12 18h.01"/>'),
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (s, root = document) => root.querySelector(s);

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const initials = (name) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const fmtDate = (iso) => new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

// Avatar: foto si existe, si no las iniciales
const avatarInner = (u) => (u.avatarUrl ? `<img src="${esc(u.avatarUrl)}" alt="">` : esc(initials(u.name)));

const fmtPhone =(p) => (p && p.length === 10 ? `${p.slice(0, 2)} ${p.slice(2, 6)} ${p.slice(6)}` : p || '—');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // Sesión vencida a media navegación: la app regresa al inicio de sesión (ver app.js)
  if (res.status === 401 && !path.startsWith('/api/auth/') && path !== '/api/me') {
    window.dispatchEvent(new CustomEvent('vx:sesion-vencida'));
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Error de comunicación'), { status: res.status, data });
  return data;
}

const fmtNum = (n) => Number(n).toLocaleString('es-MX');
// Sección electoral siempre con 4 dígitos, como en la credencial del INE (420 → 0420)
const fmtSeccion = (s) => (s === null || s === undefined || s === '' ? '' : String(Number(s)).padStart(4, '0'));
const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- Formularios: errores junto a cada campo ----------
// fields: { nombreDelCampoEnLaApi: idDelInput }; cada input tiene un <p id="{id}-err">
function fieldErrorSetter(root, fields) {
  return (errs = {}) => {
    for (const [f, id] of Object.entries(fields)) {
      const input = $(`#${id}`, root);
      $(`#${id}-err`, root).textContent = errs[f] || '';
      if (errs[f]) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-errormessage', `${id}-err`);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-errormessage');
      }
    }
    const first = Object.keys(fields).find((f) => errs[f]);
    if (first) $(`#${fields[first]}`, root).focus();
  };
}

// Envía un formulario con estado de carga y manejo de errores por campo
async function submitWith(form, label, busyLabel, setErrors, formErr, action) {
  const submit = form.querySelector('[type="submit"]');
  setErrors();
  formErr.textContent = '';
  submit.disabled = true;
  submit.textContent = busyLabel;
  try {
    return await action();
  } catch (err) {
    if (err.data?.fields) setErrors(err.data.fields);
    else formErr.textContent = navigator.onLine ? err.message : 'Sin conexión. Intenta de nuevo cuando estés en línea.';
    return null;
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3500);
}

// Sube un archivo grande con progreso (XHR permite medir la subida)
function uploadFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.upload.onload = () => onProgress(1);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'No se pudo cargar el archivo.'));
    };
    xhr.onerror = () => reject(new Error('Sin conexión. Intenta de nuevo cuando estés en línea.'));
    xhr.send(file);
  });
}

// Estilos de las capas sobre OpenStreetMap (colores de marca)
const GEO_STYLE = {
  base: { color: '#3f3f46', weight: 0.8, opacity: 0.8, fillColor: '#171717', fillOpacity: 0.05 },
  hover: { color: '#0a0a0a', weight: 2.5, opacity: 1, fillOpacity: 0.25 },
  outline: { color: '#18181b', weight: 2.5, opacity: 0.9, fill: false, interactive: false },
};

// Control propio: volver a encuadrar toda la entidad
function homeControl(onClick) {
  const Ctl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', 'map-home', bar);
      btn.href = '#';
      btn.title = 'Ver toda la entidad';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Ver toda la entidad');
      btn.innerHTML = icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>');
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        onClick();
      });
      return bar;
    },
  });
  return new Ctl();
}


// Navegación interna sin recargar la página (la atiende el router de app.js)
const navigate = (path) => window.dispatchEvent(new CustomEvent('vx:navigate', { detail: path }));

// ---------------------------------------------------------------------------
// Paneles en el área de trabajo (VERTEX no usa ventanas modales)
// Muestra un <dialog> dentro de #view en lugar del contenido de la página; al cerrarse
// (dlg.close()) el contenido vuelve a mostrarse tal como estaba.
// ---------------------------------------------------------------------------
function abrirEnArea(dlg) {
  if (dlg.open) return;
  const area = document.getElementById('view');
  const origen = { parent: dlg.parentNode, next: dlg.nextSibling };
  const scroll = window.scrollY;
  const ocultos = [...area.children].filter((el) => el !== dlg && !el.hasAttribute('data-area-oculto'));
  ocultos.forEach((el) => el.setAttribute('data-area-oculto', ''));
  const volver = document.createElement('button');
  volver.type = 'button';
  volver.className = 'back-link area-back';
  volver.innerHTML = `${ICONS.back}<span>Volver</span>`;
  volver.addEventListener('click', () => dlg.close());
  area.prepend(volver, dlg);
  area.classList.add('is-area');
  dlg.classList.add('dialog--area');
  const onKey = (e) => e.key === 'Escape' && dlg.close();
  document.addEventListener('keydown', onKey);
  dlg.addEventListener(
    'close',
    () => {
      document.removeEventListener('keydown', onKey);
      volver.remove();
      dlg.classList.remove('dialog--area');
      area.classList.remove('is-area');
      ocultos.forEach((el) => el.removeAttribute('data-area-oculto'));
      if (origen.parent && origen.parent !== area && origen.parent.isConnected) origen.parent.insertBefore(dlg, origen.next);
      window.scrollTo(0, scroll);
    },
    { once: true }
  );
  dlg.show();
  window.scrollTo(0, 0);
  (dlg.querySelector('[autofocus], input:not([type=hidden]), select, textarea') || dlg).focus?.({ preventScroll: true });
}

export {
  icon,
  ICONS,
  $,
  esc,
  initials,
  fmtDate,
  fmtPhone,
  fmtNum,
  fmtSeccion,
  fmtDateTime,
  avatarInner,
  api,
  fieldErrorSetter,
  submitWith,
  toast,
  uploadFile,
  GEO_STYLE,
  homeControl,
  navigate,
  abrirEnArea,
};
