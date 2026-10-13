// Notificaciones push (llegan al celular aunque la app esté cerrada).
// Las llaves VAPID se generan una sola vez y se guardan en la configuración del sistema.
// En iPhone funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o posterior).
const webpush = require('web-push');
const { query } = require('./db');
const settings = require('./settings');

const KEY = 'push.vapid';
let listo = false;

async function init() {
  let v = settings.get(KEY);
  if (!v?.publicKey) {
    v = webpush.generateVAPIDKeys();
    await settings.set(KEY, v);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:notificaciones@legislab.app', v.publicKey, v.privateKey);
  listo = true;
}

const clavePublica = () => settings.get(KEY)?.publicKey || null;

async function suscribir(userId, sub, userAgent = '') {
  const endpoint = String(sub?.endpoint || '');
  const keys = sub?.keys;
  if (!/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) return false;
  await query(
    `INSERT INTO push_suscripciones (user_id, endpoint, keys, user_agent) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, keys = $3, user_agent = $4, created_at = now()`,
    [userId, endpoint.slice(0, 1000), { p256dh: String(keys.p256dh), auth: String(keys.auth) }, String(userAgent).slice(0, 300)]
  );
  return true;
}

async function desuscribir(userId, endpoint) {
  await query('DELETE FROM push_suscripciones WHERE user_id = $1 AND endpoint = $2', [userId, String(endpoint || '')]);
}

// Envía a todos los dispositivos de esas cuentas; las suscripciones vencidas se borran solas
async function enviar(userIds, { titulo, cuerpo = '', url = '/' }) {
  if (!listo || !userIds.length) return;
  const { rows } = await query('SELECT id, endpoint, keys FROM push_suscripciones WHERE user_id = ANY($1::uuid[])', [userIds]);
  const payload = JSON.stringify({ titulo, cuerpo, url });
  await Promise.all(
    rows.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 86400 }).catch(async (err) => {
        if (err.statusCode === 404 || err.statusCode === 410) await query('DELETE FROM push_suscripciones WHERE id = $1', [s.id]).catch(() => {});
      })
    )
  );
}

module.exports = { init, clavePublica, suscribir, desuscribir, enviar };
