// Cotejo de personas dentro del árbol de un CPV (fragmentos SQL compartidos).
// Una persona coincide si comparte clave de elector o CURP. Todo se limita al CPV indicado:
// sus promovidos, sus estructuras externas y los eventos de su agenda.
//   alias: tabla con columnas clave_elector y curp · cpv: parámetro SQL con el id del CPV (p. ej. '$1')

// ¿Está entre los promovidos del árbol del CPV?
const enArbol = (alias, cpv) => `EXISTS (
  SELECT 1 FROM promovidos pr
  JOIN users rs_ ON rs_.id = pr.responsable_id JOIN users z_ ON z_.id = rs_.parent_id
  WHERE z_.parent_id = ${cpv} AND (pr.clave_elector = ${alias}.clave_elector OR pr.curp = ${alias}.curp))`;

// ¿Está en alguna estructura externa (paralela) del CPV?
const enExternas = (alias, cpv) => `EXISTS (
  SELECT 1 FROM estructura_externa_personas y_ JOIN estructuras_externas ey_ ON ey_.id = y_.estructura_id
  WHERE ey_.cpv_id = ${cpv} AND (y_.clave_elector = ${alias}.clave_elector OR y_.curp = ${alias}.curp))`;

// Asistencias de la persona a eventos del CPV (asambleas y recorridos distintos), para un LEFT JOIN LATERAL
const asistencias = (alias, cpv) => `(
  SELECT count(DISTINCT a_.evento_id) FILTER (WHERE ev_.tipo = 'asamblea')::int AS asambleas,
         count(DISTINCT a_.evento_id) FILTER (WHERE ev_.tipo = 'recorrido')::int AS recorridos
  FROM evento_asistentes a_ JOIN eventos ev_ ON ev_.id = a_.evento_id
  WHERE ev_.cpv_id = ${cpv} AND (a_.clave_elector = ${alias}.clave_elector OR a_.curp = ${alias}.curp))`;

module.exports = { enArbol, enExternas, asistencias };
