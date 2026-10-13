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
  {
    id: 5,
    name: 'historial y observaciones de promovidos',
    sql: `
      CREATE TABLE promovido_historial (
        id            bigserial PRIMARY KEY,
        promovido_id  uuid NOT NULL REFERENCES promovidos(id) ON DELETE CASCADE,
        user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
        user_name     text NOT NULL,
        accion        text NOT NULL,
        cambios       jsonb NOT NULL DEFAULT '[]'::jsonb,
        at            timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX promovido_historial_idx ON promovido_historial(promovido_id, at);

      CREATE TABLE promovido_observaciones (
        id            bigserial PRIMARY KEY,
        promovido_id  uuid NOT NULL REFERENCES promovidos(id) ON DELETE CASCADE,
        user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
        user_name     text NOT NULL,
        texto         text NOT NULL,
        at            timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX promovido_observaciones_idx ON promovido_observaciones(promovido_id, at);

      -- Los promovidos que ya existían quedan con su alta en el historial
      INSERT INTO promovido_historial (promovido_id, user_id, user_name, accion, at)
        SELECT p.id, p.promotor_id, COALESCE(u.name, 'Promotor'), 'creado', p.created_at
        FROM promovidos p LEFT JOIN users u ON u.id = p.promotor_id;
    `,
  },
  {
    id: 6,
    name: 'notificaciones',
    sql: `
      CREATE TABLE notificaciones (
        id          bigserial PRIMARY KEY,
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tipo        text NOT NULL,
        titulo      text NOT NULL,
        cuerpo      text NOT NULL DEFAULT '',
        url         text,
        leida_at    timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX notificaciones_user_idx ON notificaciones(user_id, created_at DESC);
      CREATE INDEX notificaciones_no_leidas_idx ON notificaciones(user_id) WHERE leida_at IS NULL;
    `,
  },
  {
    id: 7,
    name: 'material electoral',
    sql: `
      -- Catálogo de artículos del CPV (gorras, banderas, volantes…)
      CREATE TABLE material_articulos (
        id          uuid PRIMARY KEY,
        cpv_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        nombre      text NOT NULL,
        unidad      text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX material_articulos_nombre_uq ON material_articulos(cpv_id, lower(nombre));

      -- Entradas de existencias al inventario del CPV
      CREATE TABLE material_entradas (
        id           bigserial PRIMARY KEY,
        cpv_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        articulo_id  uuid NOT NULL REFERENCES material_articulos(id) ON DELETE CASCADE,
        cantidad     integer NOT NULL CHECK (cantidad > 0),
        user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
        at           timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX material_entradas_idx ON material_entradas(cpv_id, articulo_id);

      -- Órdenes de entrega de un nivel a su subordinado directo (varios artículos por orden)
      CREATE TABLE material_ordenes (
        id             uuid PRIMARY KEY,
        numero         bigserial UNIQUE,
        cpv_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        de_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        para_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'recibida', 'comprobada')),
        nota           text NOT NULL DEFAULT '',
        created_at     timestamptz NOT NULL DEFAULT now(),
        recibida_at    timestamptz,
        comprobada_at  timestamptz
      );
      CREATE INDEX material_ordenes_de_idx ON material_ordenes(de_id);
      CREATE INDEX material_ordenes_para_idx ON material_ordenes(para_id);
      CREATE INDEX material_ordenes_cpv_idx ON material_ordenes(cpv_id);

      CREATE TABLE material_orden_items (
        orden_id     uuid NOT NULL REFERENCES material_ordenes(id) ON DELETE CASCADE,
        articulo_id  uuid NOT NULL REFERENCES material_articulos(id) ON DELETE CASCADE,
        cantidad     integer NOT NULL CHECK (cantidad > 0),
        PRIMARY KEY (orden_id, articulo_id)
      );
      CREATE INDEX material_orden_items_art_idx ON material_orden_items(articulo_id);

      -- Fotos de evidencia del Responsable de Sección (mínimo 5 por orden)
      CREATE TABLE material_evidencias (
        id        bigserial PRIMARY KEY,
        orden_id  uuid NOT NULL REFERENCES material_ordenes(id) ON DELETE CASCADE,
        user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
        image     bytea NOT NULL,
        at        timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX material_evidencias_idx ON material_evidencias(orden_id, id);
    `,
  },
  {
    id: 8,
    name: 'historial: «Validado» pasa a «Aprobado»',
    sql: `
      UPDATE promovido_historial SET cambios = replace(cambios::text, '"Validado"', '"Aprobado"')::jsonb
        WHERE cambios::text LIKE '%"Validado"%';
      -- Consultas del historial por autor (corrección de observaciones)
      CREATE INDEX IF NOT EXISTS promovido_historial_autor_idx ON promovido_historial(promovido_id, user_id, at);
    `,
  },
  {
    id: 9,
    name: 'notificaciones push',
    sql: `
      CREATE TABLE push_suscripciones (
        id          bigserial PRIMARY KEY,
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint    text NOT NULL UNIQUE,
        keys        jsonb NOT NULL,
        user_agent  text NOT NULL DEFAULT '',
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX push_suscripciones_user_idx ON push_suscripciones(user_id);
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
