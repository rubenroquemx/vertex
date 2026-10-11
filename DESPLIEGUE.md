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
| `VERTEX_ADMIN_USER` | p. ej. `rroque` | Usuario del Super administrador (por defecto `admin`). 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo |
| `VERTEX_ADMIN_PASSWORD` | una contraseña segura | Contraseña inicial del Super administrador (mín. 8 caracteres, con letras y números). Se aplica **solo en el primer arranque** |
| `VERTEX_ADMIN_RESET` | `1` | Opcional, para **recuperar el acceso**: reaplica usuario y contraseña de las variables aunque el admin ya exista. Quítala después de desplegar |
| `PORT` | `3000` | Opcional (ya es el valor por defecto) |

## 4. Volumen (¡indispensable!)

En **Mounts / Volúmenes** agrega un volumen montado en:

```
/app/data
```

Sin este volumen, cada redespliegue borraría usuarios, mapas y padrón.

## 5. Dominio

En **Domains**, asigna tu dominio con HTTPS y apunta al **puerto 3000**.
La app requiere HTTPS en producción (la sesión usa cookies seguras).

## 6. Desplegar

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
- Migración a PostgreSQL + PostGIS (los datos viven hoy en archivos JSON).
- Proveedor de mapas base (OpenStreetMap no permite uso intensivo).
- Aviso de privacidad antes de capturar datos personales de promovidos.
