// Conexión a PostgreSQL (DATABASE_URL) y esquema versionado.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    'VERTEX: falta la variable DATABASE_URL (cadena de conexión a PostgreSQL).\n' +
      '  Desarrollo: revisa el archivo .env del proyecto.\n' +
      '  Easypanel: agrega DATABASE_URL en Environment con la URL interna del servicio de base de datos.'
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  ssl: process.env.DB_SSL === '1' ? { rejectUnauthorized: false } : undefined,
});
pool.on('error', (err) => console.error('PostgreSQL: error en conexión inactiva', err.message));

const query = (text, params) => pool.query(text, params);

// Ejecuta fn(client) dentro de una transacción
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Cambios de esquema en orden. Nunca se editan los ya aplicados: se agregan nuevos.
const MIGRATIONS = [
  {
    id: 1,
    name: 'esquema inicial',
    sql: `
      CREATE TABLE users (
        id          uuid PRIMARY KEY,
        role        text NOT NULL,
        parent_id   uuid REFERENCES users(id) ON DELETE CASCADE,
        username    text UNIQUE,
        name        text NOT NULL,
        data        jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz
      );
      CREATE INDEX users_parent_idx ON users(parent_id);
      CREATE INDEX users_role_idx ON users(role);

      CREATE TABLE sessions (
        token_hash  text PRIMARY KEY,
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        god_as      uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        expires_at  timestamptz NOT NULL
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);

      CREATE TABLE audit (
        id       bigserial PRIMARY KEY,
        at       timestamptz NOT NULL DEFAULT now(),
        action   text NOT NULL,
        by_user  uuid,
        as_user  uuid,
        data     jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX audit_action_idx ON audit(action, as_user);

      CREATE TABLE avatars (
        user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        image       bytea NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE geo_states (
        clave       integer PRIMARY KEY,
        meta        jsonb NOT NULL,
        catalog     jsonb NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE geo_layers (
        clave    integer NOT NULL REFERENCES geo_states(clave) ON DELETE CASCADE,
        layer    text NOT NULL,
        geojson  text NOT NULL,
        PRIMARY KEY (clave, layer)
      );

      CREATE TABLE padron_states (
        clave       integer PRIMARY KEY,
        meta        jsonb NOT NULL,
        data        jsonb NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE padron_meta (
        id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        last_import  jsonb
      );

      CREATE TABLE promovidos (
        id           uuid PRIMARY KEY,
        promotor_id  uuid REFERENCES users(id) ON DELETE SET NULL,
        seccion      integer,
        data         jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX promovidos_promotor_idx ON promovidos(promotor_id);
    `,
  },
  {
    id: 2,
    name: 'configuración del sistema y restablecimiento de contraseña',
    sql: `
      CREATE TABLE settings (
        key         text PRIMARY KEY,
        value       jsonb NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now(),
        updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE password_resets (
        id          uuid PRIMARY KEY,
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash   text NOT NULL,
        attempts    integer NOT NULL DEFAULT 0,
        expires_at  timestamptz NOT NULL,
        used_at     timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX password_resets_user_idx ON password_resets(user_id, created_at DESC);
    `,
  },
  {
    id: 3,
    name: 'captura de promovidos (INE)',
    sql: `
      ALTER TABLE promovidos ADD COLUMN responsable_id uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE promovidos ADD COLUMN clave_elector text;
      ALTER TABLE promovidos ADD COLUMN curp text;
      -- Una persona solo puede estar promovida una vez
      CREATE UNIQUE INDEX promovidos_clave_elector_uq ON promovidos(clave_elector);
      CREATE UNIQUE INDEX promovidos_curp_uq ON promovidos(curp);
      CREATE INDEX promovidos_responsable_idx ON promovidos(responsable_id);

      CREATE TABLE promovido_ine (
        promovido_id  uuid NOT NULL REFERENCES promovidos(id) ON DELETE CASCADE,
        lado          text NOT NULL CHECK (lado IN ('frente', 'reverso')),
        image         bytea NOT NULL,
        PRIMARY KEY (promovido_id, lado)
      );
    `,
  },
  {
    id: 4,
    name: 'estatus de revisión de promovidos',
    sql: `
      -- Todo promovido entra «en revisión»; lo valida su Responsable de Sección directo
      ALTER TABLE promovidos ADD COLUMN estatus text NOT NULL DEFAULT 'en_revision'
        CHECK (estatus IN ('en_revision', 'validado', 'rechazado'));
      ALTER TABLE promovidos ADD COLUMN revisado_por uuid REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE promovidos ADD COLUMN revisado_at timestamptz;
      CREATE INDEX promovidos_estatus_idx ON promovidos(responsable_id, estatus);
    `,
  },
];

async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await query('SELECT id FROM schema_migrations');
  const done = new Set(rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await tx(async (c) => {
      await c.query(m.sql);
      await c.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
    });
    console.log(`PostgreSQL: migración ${m.id} aplicada (${m.name})`);
  }
  await enablePostgis();
}

// PostGIS: se activa solo si la imagen del servidor lo trae (p. ej. postgis/postgis).
// La app funciona sin él; se usará para consultas geográficas (ubicar la sección por GPS).
let postgis = false;
async function enablePostgis() {
  const { rows } = await query("SELECT 1 FROM pg_available_extensions WHERE name = 'postgis'");
  if (!rows.length) {
    console.log('PostgreSQL: PostGIS no está disponible en este servidor (opcional por ahora).');
    return;
  }
  try {
    await query('CREATE EXTENSION IF NOT EXISTS postgis');
    const v = await query('SELECT postgis_lib_version() AS v');
    postgis = true;
    console.log(`PostgreSQL: PostGIS ${v.rows[0].v} activo.`);
  } catch (err) {
    console.log(`PostgreSQL: PostGIS disponible pero no se pudo activar (${err.message}).`);
  }
}
const hasPostgis = () => postgis;

module.exports = { pool, query, tx, migrate, hasPostgis };
