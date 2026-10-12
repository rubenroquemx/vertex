// Exporta todas las cuentas de la base configurada en .env a data/exportes/cuentas-AAAA-MM-DD-HHMM.json
// Uso: npm run exportar-cuentas
// El archivo contiene contraseñas cifradas, teléfonos y correos: no lo compartas ni lo subas a git.
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { DATA_DIR } = require('../src/paths');
const { exportar } = require('../src/cuentas-io');
const { pool } = require('../src/db');

(async () => {
  const datos = await exportar();
  const dir = path.join(DATA_DIR, 'exportes');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const file = path.join(dir, `cuentas-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(datos));
  const porRol = datos.users.reduce((m, u) => ((m[u.role] = (m[u.role] || 0) + 1), m), {});
  console.log(`Exportadas ${datos.users.length} cuentas y ${datos.avatars.length} fotos de perfil.`);
  console.log('Por nivel:', porRol);
  console.log(`Archivo: ${file}`);
  await pool.end();
})().catch((err) => {
  console.error('No se pudo exportar:', err.message);
  process.exit(1);
});
