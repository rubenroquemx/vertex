// Aviso de privacidad: lo edita el super administrador y se publica en /aviso-de-privacidad
// (página pública, para compartirla con las personas que se promueven). Cada promovido guarda
// la versión del aviso que se le dio a conocer y la fecha de su consentimiento.
const settings = require('./settings');

const KEY = 'aviso.privacidad';

const BORRADOR = `BORRADOR — Este texto es una plantilla. Debe revisarlo y aprobarlo el área jurídica antes de capturar datos de personas reales.

AVISO DE PRIVACIDAD INTEGRAL

[Nombre del responsable], con domicilio en [domicilio], es responsable del tratamiento de los datos personales que nos proporcione, conforme a la Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados / Ley Federal de Protección de Datos Personales en Posesión de los Particulares (según corresponda).

¿Qué datos recabamos?
Nombre completo, clave de elector, CURP, sección electoral, vigencia de la credencial, imagen de la credencial para votar (frente y reverso), domicilio y número de teléfono.

¿Para qué los usamos?
[Finalidades: p. ej., organización y seguimiento de la estructura de promoción, contacto con usted.]

¿Con quién los compartimos?
[Transferencias, o indicar que no se transfieren.]

¿Cómo ejercer sus derechos ARCO (acceso, rectificación, cancelación y oposición) o revocar su consentimiento?
[Medio de contacto, plazos y requisitos.]

Cambios a este aviso
Cualquier cambio se publicará en esta misma página.

Última actualización: [fecha].`;

function aviso() {
  const a = settings.get(KEY);
  return a?.texto ? a : { texto: BORRADOR, version: 0, actualizado: null, borrador: true };
}

async function guardar(texto, userId) {
  const t = String(texto || '').trim();
  if (t.length < 200) return { error: 'El aviso de privacidad parece incompleto (mínimo 200 caracteres).' };
  const actual = settings.get(KEY);
  const nuevo = { texto: t.slice(0, 30000), version: (actual?.version || 0) + 1, actualizado: new Date().toISOString() };
  await settings.set(KEY, nuevo, userId);
  return { aviso: nuevo };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Página pública (sin sesión): texto plano con saltos de línea
function pagina() {
  const a = aviso();
  const parrafos = esc(a.texto)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aviso de privacidad · VERTEX</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; background: #f5f5f5; color: #0a0a0a; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  article { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  h1 { font-size: 24px; margin: 0 0 8px; }
  .meta { color: #595959; font-size: 14px; margin: 0 0 20px; }
  .borrador { background: #fef3c7; color: #78350f; padding: 12px 16px; border-radius: 12px; font-weight: 700; }
  @media (prefers-color-scheme: dark) { body { background: #0d0d0d; color: #f5f5f5; } article { background: #1a1a19; } .meta { color: #b5b5b5; } }
</style></head>
<body><main><article>
<h1>Aviso de privacidad</h1>
<p class="meta">${a.version ? `Versión ${a.version} · actualizado el ${new Date(a.actualizado).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Sin publicar'}</p>
${a.borrador ? '<p class="borrador">Este aviso aún no ha sido aprobado: es una plantilla.</p>' : ''}
${parrafos}
</article></main></body></html>`;
}

module.exports = { aviso, guardar, pagina };
