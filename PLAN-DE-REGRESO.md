# Plan de regreso (rollback) de VERTEX

Qué hacer si una versión nueva en **producción** (https://vertexapp.org) sale mal.
Producción se construye desde la rama **`estable`** (Easypanel: proyecto `vertex`, servicio `vertexapp`).
Prueba (https://vertex.legislab.app) se construye desde `main` y se despliega sola cuando pasan las pruebas.

---

## 1. ¿Cuándo regresar?

Regresar **de inmediato** (sin esperar a corregir) si después de un despliegue:

- la app no carga, no deja iniciar sesión o la captura de promovidos falla para todos;
- se pierden o se muestran mal datos (promovidos, estructura, material, agenda);
- alguien ve datos que no le corresponden.

Si el problema es menor (un texto, un estilo, una pantalla secundaria), se **corrige hacia adelante**:
se arregla en `main`, pasa por prueba y se lleva a `estable`.

Decide: **Rubén**. Ejecuta: **Claude** (o Rubén desde Easypanel si Claude no está disponible).

---

## 2. Regresar el código (lo normal: 5 minutos, sin perder datos)

Cada versión que sale a producción queda marcada con una **etiqueta** en Git (`v1.1.0`, `v2.0.0`…).

1. Mover la rama `estable` a la versión anterior:

   ```bash
   git fetch origin --tags
   git push origin v1.1.0^{commit}:refs/heads/estable --force-with-lease=estable
   ```

   (cambiar `v1.1.0` por la etiqueta a la que se regresa)

2. Desplegar producción: webhook `dea8…` (o el botón **Implementar** de `vertex › vertexapp`).
3. Verificar (sección 5).

**Por qué no se pierden datos:** las migraciones de base de datos solo **agregan** tablas o columnas. El código
anterior ignora lo que no conoce, así que funciona con la base nueva. Las capturas hechas mientras corría la
versión nueva **se conservan**; solo dejan de verse las funciones nuevas hasta volver a desplegarla.

> Regla para la 2.0 en adelante: **ninguna migración borra ni renombra** tablas o columnas en la misma versión que
> deja de usarlas. Primero se publica el código que ya no las usa y, en una versión posterior, se limpian.
> Así el regreso de código siempre es seguro.

---

## 3. Regresar la base de datos (solo si hubo datos dañados)

Solo cuando el problema **dañó o borró datos** (no por un error de pantalla). **Se pierde todo lo capturado
desde el respaldo**, así que es la última opción.

1. Poner la app en pausa: en Easypanel, `vertex › vertexapp` → **Detener**.
2. Hacer un respaldo del estado actual (aunque esté dañado), para poder rescatar capturas después:
   `vertex › Postgres › Backups` → crear respaldo.
3. Restaurar el último respaldo **anterior** al despliegue problemático (respaldo diario o el que se hace
   justo antes de cada lanzamiento).
4. Regresar el código a la versión que corresponde a ese respaldo (sección 2).
5. Iniciar la app y verificar (sección 5).
6. Rescatar del respaldo dañado lo capturado después (Claude puede comparar ambos y recuperar lo que sirva).

**Fotos de la INE en Cloudflare R2** (si están activadas): no se borran al restaurar la base. Las fotos de
promovidos que ya no existen en la base restaurada quedan sin uso en el bucket, sin riesgo.

---

## 4. Antes de cada lanzamiento (para que el regreso sea posible)

- [ ] `npm test` pasa (GitHub Actions lo corre en cada cambio de `main`).
- [ ] La versión estuvo al menos un día en prueba sin errores.
- [ ] **Respaldo manual** de la base de producción justo antes de desplegar (`vertex › Postgres › Backups`).
- [ ] Etiqueta en Git de la versión que **sale** y de la que **estaba**:

  ```bash
  git tag -a v2.0.0 -m "VERTEX 2.0.0" <commit> && git push origin v2.0.0
  ```

- [ ] Anotar en esta página la etiqueta anterior a la que se regresaría.

Versión actual en producción: **1.1.0** (rama `estable`). Etiqueta pendiente de crear: `v1.1.0`.

---

## 5. Verificar después de regresar (o de desplegar)

1. https://vertexapp.org/sw.js muestra la `VERSION` esperada.
2. Logs de `vertex › vertexapp`: «VERTEX escuchando en …» y ningún error de migración.
3. Iniciar sesión como Super admin y como un CPV: el panel carga.
4. Un promotor puede capturar (o al menos abrir la captura) y la bandeja del Responsable muestra promovidos.
5. Configuración › Novedades muestra la versión esperada.

Los teléfonos toman la versión anterior la próxima vez que se abra la app (el service worker se actualiza solo
cuando cambia su archivo).

---

## 6. Después

- Escribir qué pasó y por qué en la lista de lanzamiento.
- Corregir en `main`, agregar una prueba automática que lo habría detectado y volver a pasar por prueba.
