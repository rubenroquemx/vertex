# Lanzamiento de VERTEX 2.0 — lista de revisión

Versión actual en producción: **1.1.0** (21 oct 2026). Objetivo: anunciar la **2.0.0** cuando todo lo
marcado como **bloqueante** esté cumplido. Ordenado de mayor a menor riesgo.

Quién: **R** = Rubén (pruebas en campo y decisiones) · **C** = Claude (código, pruebas automáticas, despliegue).

---

## 1. Pruebas en campo (bloqueante)

Lo que se construyó del 19 al 21 de octubre solo se ha probado en local con datos de ejemplo.

- [ ] **Lector de la INE** (R): capturar 10 INE reales en el servidor de prueba, de modelos distintos
      (con y sin holograma, buena y poca luz). Anotar qué campos salieron bien y cuáles no.
      Criterio: el reverso acierta la vigencia en 8 de 10 y el frente la clave de elector y la CURP en 7 de 10;
      si no, se ajusta o se deja apagado para la 2.0.
- [ ] **Captura sin internet de punta a punta** (R): capturar 3 promovidos en modo avión, volver a tener
      señal y confirmar que se envían solos y llegan a la bandeja del Responsable.
- [ ] **Confirmación de asistencia con selfie** (R): un evento real (o de prueba con hora cercana) con 2 o 3
      personas: confirmar, enviar selfie, recibir el aviso al terminar y comprobar que a las 72 horas se
      retira a quien no envió selfie.
- [ ] **Notificaciones push** (R): activarlas en un Android y en un iPhone con la app instalada en la pantalla
      de inicio; confirmar que llegan con la app cerrada y que al tocarlas abren la pantalla correcta.
- [ ] **Activaciones de material** (R): un Responsable recibe una orden, reporta una activación con 5 fotos y
      su Coordinador de Zona la ve con lo repartido.
- [ ] **Mi sección** (R): crear y borrar puntos de interés y una casilla desde el celular, como Responsable y
      como Promotor.
- [ ] **Vista restringida de la agenda** (R): con un Coordinador de Zona, un Responsable y un Promotor,
      comprobar que no ven reportes ni eventos pasados, y que quien reporta sí ve todo.

## 2. Pruebas automáticas mínimas (bloqueante) — hechas el 21 oct

`npm test` corre 29 pruebas en menos de 2 segundos (`node --test`, sin dependencias nuevas). Las de
integración usan un esquema temporal en el Postgres de desarrollo que se crea y se borra en cada corrida;
sin base de datos se omiten y corren solo las 18 unitarias.

- [x] **Validación de promovidos** (C): CURP válidas e inválidas con su mensaje, clave de elector, sección y
      duplicados por CPV; el teléfono y el servidor validan la CURP exactamente igual (`test/curp.test.js`).
- [x] **Envíos sin internet** (C): un envío repetido con el mismo identificador del teléfono no duplica.
- [x] **Existencias de material** (C): órdenes, recepciones y activaciones; lo por recibir no se reparte; dos
      activaciones al mismo tiempo que exceden la existencia: solo pasa una.
- [x] **Plazos de asistencia** (C): fin del evento (hora de fin o 3 h), selfie desde que inicia y hasta 72 h
      después, aviso al terminar y retiro sin selfie, con sus notificaciones.
- [x] **Permisos** (C): vista restringida de la agenda, eventos pasados, selfies, puntos y casillas.
- [x] **Lector de la INE** (C): zona de lectura mecánica y frente con dígitos verificadores y correcciones.
- [ ] Correr `npm test` antes de cada despliegue (C).

## 3. Seguridad (bloqueante)

- [x] **Paquetes con alertas altas** (C, 21 oct): `sharp` 0.35.5, `adm-zip` 0.6.1 y `uuid` 11.1.1 (forzado dentro
      de `exceljs`); `npm audit` en 0. Probado en local: compresión de fotos, lector de la INE, ZIP con carpetas y ZIP
      interno, respaldo en ZIP y listas de Excel. Falta importar una cartografía real (R, en el servidor de prueba).
- [x] **Revisión de seguridad de lo nuevo** (C, 21 oct): permisos correctos en activaciones, puntos, asistencia,
      selfies, lista de asistencia y lector de la INE. Reforzado: tope de 20 lecturas de la INE por minuto por cuenta y
      cola máxima; fotos que declaran más de 60 MP se rechazan sin decodificarse; máximo 300 puntos por sección;
      selfie con identificador inválido responde 404; activación de una cuenta sin CPV da un mensaje claro.
- [ ] **Aviso de privacidad** (R): actualizarlo si hace falta para la selfie de asistencia y la lectura
      automática de la INE.
- [x] **Quitar `VERTEX_ADMIN_RESET`** (R): quitada de producción (vertex › vertexapp) y de prueba (legislab › vertex)
      el 21 oct; antes, en cada arranque la contraseña del Super admin volvía a la de las variables de entorno.

## 4. Despliegue y datos (bloqueante)

- [x] **Separar prueba y producción** (C/R): rama `estable` creada (21 oct) y producción configurada en Easypanel
      para construir desde ella; `main` sigue para prueba. Producción solo se actualiza al pasar de `main` a `estable`.
- [x] **Respaldos de producción** (R): respaldo hecho y respaldo diario programado en Easypanel (21 oct).
- [ ] **Respaldo antes del lanzamiento** (R): uno más justo antes de desplegar la 2.0.
- [x] **Migraciones** (C): el arranque de producción registra la 18 aplicada (implica la 16 y la 17, que se aplican en orden).
- [ ] **Plan de regreso** (C): cómo volver a la 1.1.0 si algo sale mal (commit, imagen y respaldo).

## 5. Producto y comunicación

- [x] **Registro de cambios** en Configuración del CPV y del Super admin (versión actual y anterior).
- [ ] **Número de versión** (C): marcar 2.0.0 en la app y en su registro de cambios.
- [ ] **Notas de la 2.0** (R/C): resumen en lenguaje sencillo para CPV y coordinadores.
- [ ] **Guías breves** (R): cómo usar Activaciones, Mi sección, confirmación de asistencia y el lector de la INE.
- [ ] **Página informativa** (R/C): capturas y textos con las funciones nuevas.

## 6. Pendientes menores (no bloquean)

- [ ] Datos de ejemplo: promovidos asignados a otro Responsable (caso de Gerardo Mendoza) y órdenes recibidas sin artículos.
- [ ] Vigilante de archivos en desarrollo (Windows) que reinicia el servidor solo.
- [ ] Nombres leídos del reverso de la INE: el relleno «<<<» a veces se lee como letras (hoy se usan los del frente).

---

## Criterio para anunciar la 2.0

Todo lo **bloqueante** (secciones 1 a 4) cumplido, pruebas automáticas pasando, respaldo hecho y una
semana sin errores reportados en el servidor de prueba con uso real.
