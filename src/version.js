// Versiones de VERTEX y su registro de cambios (de la más reciente a la más antigua).
// Para publicar una versión: agregarla al inicio de VERSIONES y poner el mismo número en package.json.
// En Configuración (CPV y super administrador) solo se muestran la versión actual y la anterior.
const VERSIONES = [
  {
    version: '1.1.0',
    fecha: '2026-10-21',
    titulo: 'Material, mapa de la sección, asistencia y lectura de la INE',
    cambios: [
      {
        area: 'Material electoral',
        textos: [
          'El Responsable de Sección ve su Inventario primero: lo que tiene en existencia y lo que ya entregó a la gente.',
          'Nuevo tablero «Por recibir | Activaciones»: cada activación reporta qué y cuánto se repartió, fecha, hora y lugar (ligada a un evento de la agenda o fuera de agenda), con mínimo 5 fotos.',
          'Recibir una orden ya la cierra; la evidencia ahora está en las activaciones. El Coordinador de Zona ve las activaciones de cada Responsable.',
        ],
      },
      {
        area: 'Mi sección',
        textos: [
          'Responsables y Promotores tienen el mapa de su sección.',
          'Se pueden marcar puntos de interés (pin naranja, con nombre y descripción) y el Responsable ubica las casillas (pin verde). Los ve todo el equipo de la sección.',
        ],
      },
      {
        area: 'Agenda',
        textos: [
          'Coordinadores de Zona, Responsables y Promotores solo ven lugar, fecha y hora de inicio de los eventos (en recorridos, el punto de inicio); los reportes y los eventos pasados quedan para el CPV y para quien reporta.',
          'La estructura confirma su asistencia y, al terminar el evento, envía una selfie para que cuente. Sin selfie en 72 horas, la asistencia se retira. El CPV ve quién confirmó y quién la acreditó.',
        ],
      },
      {
        area: 'Captura de promovidos',
        textos: [
          'Lectura de la INE (prueba): al tomar las fotos se prellenan los datos (en azul) para revisarlos con la credencial.',
          'La CURP se valida igual en el teléfono, con o sin internet, que en el servidor, y el aviso dice qué carácter revisar.',
          'Aprobados que ya no se pueden abrir y botón de informe junto a «Capturar promovido».',
        ],
      },
      {
        area: 'Paneles y cuentas',
        textos: [
          'Nombre(s) y apellidos por separado en todas las cuentas y saludo «Hola, nombre» en cada panel.',
          'Panel del Responsable: promotores de mejor desempeño y los que necesitan apoyo; en «Promotores», barra de avance y acceso a los promovidos de cada uno.',
          'Notificaciones en el celular para toda la app, con invitación para activarlas desde el panel.',
        ],
      },
      {
        area: 'Celular',
        textos: [
          'Barra inferior más baja, sin botón +, negra en tema claro y blanca en tema oscuro; los mapas ya no se enciman sobre ella.',
          'La campana se pone roja y se mueve cuando hay notificaciones sin ver.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    fecha: '2026-10-19',
    titulo: 'Clientes independientes, directorio y escala para entidades grandes',
    cambios: [
      {
        area: 'Estructura',
        textos: [
          'Cada CPV es un cliente independiente: una persona es única solo dentro de la estructura de su CPV.',
          'Directorio del CPV: todas las personas de su estructura con zona, sección, de quién dependen, promovidos y contacto, con filtros y descarga en CSV.',
        ],
      },
      {
        area: 'Agenda',
        textos: [
          'Solo el CPV crea asambleas y recorridos, elige a quién van dirigidos y quién los reporta.',
          'Lista de asistencia obligatoria en el reporte, cotejada contra la estructura y las estructuras externas.',
        ],
      },
      {
        area: 'Estructuras externas',
        textos: ['El CPV carga en Excel las listas de otras estructuras y ve cuántas personas coinciden con la suya.'],
      },
      {
        area: 'Rendimiento',
        textos: ['Preparado para entidades grandes (como la CDMX, cerca de un millón de promovidos): las pantallas cargan al momento y las fotos de la INE pesan menos.'],
      },
      {
        area: 'Sitio y cotizador',
        textos: [
          'Página informativa de VERTEX en la raíz del sitio, para quien no ha iniciado sesión.',
          'Cotizador semipúblico con precio según el tipo de elección y el territorio.',
        ],
      },
    ],
  },
];

const actual = () => VERSIONES[0];
// Solo la versión actual y la anterior
const recientes = () => VERSIONES.slice(0, 2);

module.exports = { VERSIONES, actual, recientes };
