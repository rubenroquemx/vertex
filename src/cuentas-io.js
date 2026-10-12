// Exportar todas las cuentas a un archivo (respaldo o para replicarlas en otro entorno).
// Incluye contraseñas cifradas y fotos de perfil. NO incluye promovidos, cartografía,
// padrón, configuración ni bitácora.
const { query } = require('./db');

const FORMATO = 'vertex-cuentas';
const VERSION = 1;

async function exportar() {
  const u = await query('SELECT id, role, parent_id, username, name, data, created_at, updated_at FROM users ORDER BY created_at');
  const a = await query('SELECT user_id, image, updated_at FROM avatars');
  return {
    formato: FORMATO,
    version: VERSION,
    exportadoEn: new Date().toISOString(),
    users: u.rows.map((r) => ({
      id: r.id,
      role: r.role,
      parentId: r.parent_id,
      username: r.username,
      name: r.name,
      data: r.data,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
    })),
    avatars: a.rows.map((r) => ({ userId: r.user_id, image: r.image.toString('base64'), updatedAt: r.updated_at.toISOString() })),
  };
}

module.exports = { exportar };
