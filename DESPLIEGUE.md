# Despliegue de VERTEX en Easypanel

La app se construye con el **Dockerfile** incluido (Node 22). Escucha en el puerto **3000**
y guarda todo (usuarios, cartografía, padrón, fotos) en **`/app/data`**, que debe ser un
volumen persistente.

## 1. Fuente del código

En tu app de Easypanel, en **Source**, sube el `.zip` (opción de subir archivo) **o**
conecta un repositorio Git con el contenido de este paquete.

## 2. Construcción

- **Build:** `Dockerfile` (ruta: `Dockerfile`, en la raíz del paquete).

## 3. Variables de entorno

| Variable | Valor | Para qué |
|----------|-------|----------|
| `NODE_ENV` | `production` | Ya viene en la imagen; apaga los accesos de desarrollo |
| `DATABASE_URL` | URL **interna** del servicio Postgres (`postgres://usuario:contraseña@proyecto_servicio:5432/vertex`) | **Obligatoria.** Sin ella la app no arranca |
| `VERTEX_ADMIN_USER` | p. ej. `rroque` | Usuario del Super administrador (por defecto `admin`). 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo |
| `VERTEX_ADMIN_PASSWORD` | una contraseña segura | Contraseña inicial del Super administrador (mín. 8 caracteres, con letras y números). Se aplica **solo en el primer arranque** |
| `VERTEX_ADMIN_RESET` | `1` | Opcional, para **recuperar el acceso**: reaplica usuario y contraseña de las variables aunque el admin ya exista. Quítala después de desplegar |
| `PORT` | `3000` | Opcional (ya es el valor por defecto) |

## 4. Base de datos

Crea en el mismo proyecto un servicio **Postgres** (de preferencia con la imagen
`postgis/postgis:16-3.4`), base `vertex`, y copia su **URL interna** en `DATABASE_URL`.
Al arrancar, la app crea sus tablas, activa PostGIS si está disponible y, si la base está
vacía y el volumen tiene datos de la versión anterior (`db.json`), los **importa** y deja
`db.json.migrado` como respaldo. Programa los respaldos en el servicio Postgres (**Backups**).

## 4b. Fotos de la INE en almacenamiento de objetos (recomendado para operación grande)

Cada promovido guarda dos fotos de la INE (~150 KB). Con cientos de miles de promovidos suman
decenas o cientos de GB: conviene guardarlas en **Cloudflare R2** (o cualquier servicio compatible
con S3) en lugar de PostgreSQL.

1. En Cloudflare › **R2**, crea un bucket **privado** (p. ej. `vertex-fotos`). No le actives acceso público:
   la app sirve las fotos solo a quien tiene permiso de verlas.
2. En **R2 › Manage API tokens**, crea un token con permiso **Object Read & Write** limitado a ese bucket.
3. Agrega estas variables en Easypanel (Environment) y vuelve a desplegar:

| Variable | Valor |
|----------|-------|
| `ALMACEN_ENDPOINT` | `https://<ID de cuenta>.r2.cloudflarestorage.com` |
| `ALMACEN_BUCKET` | `vertex-fotos` |
| `ALMACEN_ACCESS_KEY` | Access Key ID del token |
| `ALMACEN_SECRET_KEY` | Secret Access Key del token |
| `ALMACEN_REGION` | Opcional (R2 usa `auto`) |

Al arrancar con estas variables, las fotos nuevas van directo al bucket y las que ya estaban en la base
se pasan solas, por lotes y en segundo plano (el registro muestra cuántas pasaron). Las fotos que se
reemplazan o se borran se eliminan del bucket automáticamente.

- **No quites las variables** una vez activado: sin ellas la app no puede mostrar las fotos que ya están en el bucket.
- El espacio que dejan las fotos en PostgreSQL se reutiliza para datos nuevos; para devolverlo al disco
  hay que ejecutar `VACUUM FULL promovido_ine` en una ventana sin uso (bloquea la tabla mientras corre).
- Sin estas variables todo sigue como antes: las fotos se guardan en PostgreSQL.

## 5. Volumen



En **Mounts / Volúmenes** agrega un volumen montado en:

```
/app/data
```

Sin este volumen, cada redespliegue borraría usuarios, mapas y padrón.

## 6. Dominio

En **Domains**, asigna tu dominio con HTTPS y apunta al **puerto 3000**.
La app requiere HTTPS en producción (la sesión usa cookies seguras).

## 7. Desplegar

Pulsa **Deploy**. Cuando el estado sea saludable, abre el dominio.

## Datos iniciales (`seed-data/`)

El paquete incluye una copia de los datos de desarrollo: cuentas (Super admin, CPV, zonas),
la cartografía de Tabasco y el padrón 2025. **Solo se copian la primera vez**, cuando el
volumen `/app/data` está vacío; después nunca se sobrescriben.

- Con datos iniciales, el usuario `admin` conserva **la misma contraseña que usas en tu
  equipo** (`data/CREDENCIAL_ADMIN.txt` o la que hayas puesto en "Mi perfil").
  `VERTEX_ADMIN_PASSWORD` no aplica en ese caso.
- Para arrancar **vacío**, borra la carpeta `seed-data/` del paquete (o déjala vacía) antes
  de subirlo; entonces se crea solo el `admin` con `VERTEX_ADMIN_PASSWORD`, y la cartografía
  y el padrón se cargan desde **Bases de datos**.

## Actualizaciones

Sube el nuevo paquete y vuelve a desplegar. El volumen `/app/data` conserva los datos.

## Antes de la operación real

- Respaldos automáticos del volumen `/app/data` (Easypanel permite programarlos).
- Proveedor de mapas base (OpenStreetMap no permite uso intensivo).
- Aviso de privacidad antes de capturar datos personales de promovidos.
