// Notificaciones dentro de la app (campana de la barra superior), por cuenta.
// Se generan desde los módulos (p. ej. promovidos) y nunca deben tumbar la operación que las origina.
const { query } = require('./db');
const push = require('./push');

const MAX_LISTA = 60;

// Crea la misma notificación para varias cuentas (sin repetir y sin avisarse a sí mismo)
async function notificar(destinos, { tipo, titulo, cuerpo = '', url = null, autorId = null }) {
  const ids = [...new Set(destinos.filter((id) => id && id !== autorId))];
  if (!ids.length) return;
  try {
    await query(
      // Solo cuentas que existen: una cuenta recién eliminada no debe impedir que avisen los demás
      `INSERT INTO notificaciones (user_id, tipo, titulo, cuerpo, url)
       SELECT u.id, $2, $3, $4, $5 FROM users u WHERE u.id = ANY($1::uuid[])`,
      [ids, tipo, String(titulo).slice(0, 200), String(cuerpo).slice(0, 300), url]
    );
    // También al celular (sin esperar: no frena la operación que la origina)
    push.enviar(ids, { titulo: String(titulo).slice(0, 120), cuerpo: String(cuerpo).slice(0, 200), url: url || '/notificaciones' }).catch(() => {});
  } catch (err) {
    console.error('No se pudo crear la notificación:', err.message);
  }
}

async function conteo(userId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM notificaciones WHERE user_id = $1 AND leida_at IS NULL', [userId]);
  return rows[0].n;
}

async function lista(userId) {
  const { rows } = await query(
    'SELECT id, tipo, titulo, cuerpo, url, leida_at, created_at FROM notificaciones WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
    [userId, MAX_LISTA]
  );
  return {
    noLeidas: await conteo(userId),
    items: rows.map((r) => ({
      id: String(r.id),
      tipo: r.tipo,
      titulo: r.titulo,
      cuerpo: r.cuerpo,
      url: r.url,
      leida: Boolean(r.leida_at),
      at: r.created_at.toISOString(),
    })),
  };
}

async function marcarLeida(userId, id) {
  if (!/^\d+$/.test(String(id))) return;
  await query('UPDATE notificaciones SET leida_at = now() WHERE id = $1 AND user_id = $2 AND leida_at IS NULL', [id, userId]);
}

async function marcarTodas(userId) {
  await query('UPDATE notificaciones SET leida_at = now() WHERE user_id = $1 AND leida_at IS NULL', [userId]);
}

module.exports = { notificar, conteo, lista, marcarLeida, marcarTodas };
