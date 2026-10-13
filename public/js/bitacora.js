// Bitácora (super administrador): todas las acciones registradas, con filtro por tipo y por persona.
import { $, esc, fmtDateTime, api, ICONS } from './lib.js';

const NOMBRES = {
  login: 'Inicio de sesión',
  'user.create': 'Creó una cuenta',
  'user.update': 'Actualizó una cuenta',
  'user.delete': 'Eliminó una rama',
  'user.transfer': 'Transfirió dependientes',
  'user.backup': 'Descargó un respaldo',
  'user.password_reset': 'Restableció la contraseña de otro',
  'zona.create': 'Creó una zona',
  'zona.update': 'Actualizó una zona',
  'responsable.create': 'Alta de Responsable de Sección',
  'responsable.update': 'Actualizó un Responsable de Sección',
  'promovido.create': 'Capturó un promovido',
  'promovido.update': 'Modificó un promovido',
  'promovido.view': 'Consultó la ficha de un promovido',
  'promovido.pdf': 'Descargó el PDF de un promovido',
  'promovido.aprobar': 'Aprobó un promovido',
  'promovido.rechazar': 'Rechazó un promovido',
  'material.articulo': 'Agregó un artículo de material',
  'material.orden': 'Creó una orden de material',
  'config.update': 'Cambió el factor de conversión',
  'settings.whatsapp': 'Cambió la configuración de WhatsApp',
  'settings.whatsapp_test': 'Probó WhatsApp',
  'password.reset_requested': 'Pidió recuperar su contraseña',
  'password.reset': 'Recuperó su contraseña',
  'god_mode.start': 'Entró en modo dios',
  'god_mode.stop': 'Salió del modo dios',
  'privacidad.update': 'Publicó el aviso de privacidad',
  'ejemplo.borrar': 'Borró los datos de ejemplo',
  'admin.reset': 'Restableció el acceso del administrador',
  'cuentas.importar': 'Importó cuentas',
};
const nombre = (a) => NOMBRES[a] || a;

const fila = (r) => `<tr>
  <td class="num bit-fecha">${esc(fmtDateTime(r.at))}</td>
  <td>${esc(nombre(r.accion))}</td>
  <td><strong>${esc(r.quien || '—')}</strong>${r.como ? `<small>como ${esc(r.como)}</small>` : ''}</td>
  <td>${r.cuenta ? esc(r.cuenta) : '<span class="muted">—</span>'}</td>
</tr>`;

export async function viewBitacora(route) {
  const d = await api('/api/bitacora');
  route.acciones = d.acciones || [];
  route.inicial = d;
  return `
    <div class="bit">
      <div class="toolbar">
        <label class="field--inline"><span class="sr-only">Buscar por persona</span><span class="field__icon" aria-hidden="true">${ICONS.search}</span>
          <input class="input input--icon" type="search" id="bitQ" placeholder="Buscar por persona" autocomplete="off"></label>
        <label><span class="sr-only">Tipo de acción</span>
          <select class="input" id="bitAccion"><option value="">Todas las acciones</option>${route.acciones
            .map((a) => [a, nombre(a)])
            .sort((x, y) => x[1].localeCompare(y[1], 'es'))
            .map(([a, n]) => `<option value="${esc(a)}">${esc(n)}</option>`)
            .join('')}</select></label>
      </div>
      <div class="table-wrap"><table class="table bit-tabla">
        <thead><tr><th scope="col">Fecha</th><th scope="col">Acción</th><th scope="col">Quién</th><th scope="col">Sobre</th></tr></thead>
        <tbody id="bitFilas">${d.registros.map(fila).join('')}</tbody>
      </table></div>
      <div class="bit-mas"><button class="btn btn--secondary" type="button" id="bitMas" ${d.mas ? '' : 'hidden'}>Cargar más</button></div>
    </div>`;
}

export function mountBitacora(root, route) {
  let ultimo = route.inicial.registros.at(-1)?.id || null;
  const cargar = async (reset) => {
    const q = $('#bitQ', root).value.trim();
    const accion = $('#bitAccion', root).value;
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(accion ? { accion } : {}), ...(!reset && ultimo ? { antes: ultimo } : {}) });
    const d = await api(`/api/bitacora?${params}`);
    const filas = $('#bitFilas', root);
    if (reset) filas.innerHTML = '';
    filas.insertAdjacentHTML('beforeend', d.registros.map(fila).join('') || (reset ? '<tr><td colspan="4" class="muted">Sin registros.</td></tr>' : ''));
    ultimo = d.registros.at(-1)?.id || ultimo;
    $('#bitMas', root).hidden = !d.mas;
  };
  let t = null;
  $('#bitQ', root).addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => cargar(true), 350);
  });
  $('#bitAccion', root).addEventListener('change', () => cargar(true));
  $('#bitMas', root).addEventListener('click', () => cargar(false));
}
