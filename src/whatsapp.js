// Envío de mensajes de WhatsApp mediante Evolution API.
// Configuración (settings "whatsapp"): { enabled, url, instance, apiKey, apiVersion: 'v2'|'v1', countryCode }
const settings = require('./settings');

const KEY = 'whatsapp';
const DEFAULTS = { enabled: false, url: '', instance: '', apiKey: '', apiVersion: 'v2', countryCode: '52' };
const TIMEOUT = 15000;

const config = () => ({ ...DEFAULTS, ...(settings.get(KEY) || {}) });
const listo = (c = config()) => Boolean(c.enabled && c.url && c.instance && c.apiKey);

class WhatsAppError extends Error {}

const base = (c) => c.url.trim().replace(/\/+$/, '');
const numero = (phone, c) => `${c.countryCode || ''}${String(phone || '').replace(/\D/g, '')}`;

async function call(c, method, path, body) {
  let res;
  try {
    res = await fetch(`${base(c)}${path}`, {
      method,
      headers: { apikey: c.apiKey, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'El servidor de Evolution API no respondió a tiempo.' : 'No se pudo conectar con el servidor de Evolution API. Revisa la URL.';
    throw new WhatsAppError(msg);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (res.status === 401 || res.status === 403) throw new WhatsAppError('La API key no es válida para este servidor.');
  if (res.status === 404) throw new WhatsAppError('No se encontró la instancia o la ruta en el servidor. Revisa el nombre de la instancia y la versión de la API.');
  if (!res.ok) {
    const detail = typeof data === 'object' ? JSON.stringify(data.response?.message || data.message || data).slice(0, 200) : String(data).slice(0, 200);
    throw new WhatsAppError(`Evolution API respondió ${res.status}: ${detail}`);
  }
  return data;
}

// Estado de la instancia: 'open' = conectada a WhatsApp
async function estado(c = config()) {
  if (!c.url || !c.instance || !c.apiKey) throw new WhatsAppError('Completa la URL, la instancia y la API key.');
  const data = await call(c, 'GET', `/instance/connectionState/${encodeURIComponent(c.instance)}`);
  const state = data?.instance?.state || data?.state || 'desconocido';
  return { state, conectado: state === 'open' };
}

async function enviarTexto(phone, text, c = config()) {
  if (!c.url || !c.instance || !c.apiKey) throw new WhatsAppError('El envío por WhatsApp no está configurado.');
  const number = numero(phone, c);
  if (number.length < 10) throw new WhatsAppError('El número de teléfono no es válido.');
  const body = c.apiVersion === 'v1' ? { number, options: { delay: 0, presence: 'composing' }, textMessage: { text } } : { number, text };
  return call(c, 'POST', `/message/sendText/${encodeURIComponent(c.instance)}`, body);
}

// Datos para la pantalla de configuración (la API key nunca se devuelve completa)
function publico() {
  const c = config();
  const m = settings.meta(KEY);
  return {
    enabled: c.enabled,
    url: c.url,
    instance: c.instance,
    apiVersion: c.apiVersion,
    countryCode: c.countryCode,
    hasKey: Boolean(c.apiKey),
    keyHint: c.apiKey ? `••••${c.apiKey.slice(-4)}` : '',
    listo: listo(c),
    actualizado: m,
  };
}

// Valida y combina cambios (apiKey vacía conserva la guardada)
function validar(body, actual = config()) {
  const errors = {};
  const url = String(body.url ?? actual.url).trim();
  const instance = String(body.instance ?? actual.instance).trim();
  const apiKey = String(body.apiKey || '').trim() || actual.apiKey;
  const apiVersion = body.apiVersion === 'v1' ? 'v1' : 'v2';
  const countryCode = String(body.countryCode ?? actual.countryCode).replace(/\D/g, '');
  const enabled = Boolean(body.enabled);
  if (url && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) errors.url = 'Escribe una URL válida (https://…).';
  if (instance && !/^[\w.-]{1,80}$/.test(instance)) errors.instance = 'Solo letras, números, punto, guion y guion bajo.';
  if (!/^\d{1,4}$/.test(countryCode)) errors.countryCode = 'Escribe la clave de país (México: 52).';
  if (enabled && (!url || !instance || !apiKey)) errors.enabled = 'Para activar el envío completa la URL, la instancia y la API key.';
  return { errors, config: { enabled, url, instance, apiKey, apiVersion, countryCode } };
}

module.exports = { KEY, config, listo, estado, enviarTexto, publico, validar, WhatsAppError };
