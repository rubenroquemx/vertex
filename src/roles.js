// Niveles de la estructura, de mayor a menor jerarquía.
// Cada nivel solo puede crear el nivel inmediato inferior y solo ve su propia rama.
const ROLES = [
  { key: 'superadmin', name: 'Super administrador', plural: 'Super administradores' },
  { key: 'coord_promocion', name: 'Coordinador de Promoción del Voto', plural: 'Coordinadores de Promoción del Voto' },
  { key: 'coord_zona', name: 'Coordinador de Zona', plural: 'Coordinadores de Zona' },
  { key: 'resp_seccion', name: 'Responsable de Sección', plural: 'Responsables de Sección' },
  { key: 'promotor', name: 'Promotor Territorial', plural: 'Promotores Territoriales' },
].map((r, level) => ({ ...r, level }));

const BY_KEY = new Map(ROLES.map((r) => [r.key, r]));

const getRole = (key) => BY_KEY.get(key) || null;
const childRoleOf = (key) => {
  const role = getRole(key);
  return role ? ROLES[role.level + 1] || null : null;
};

module.exports = { ROLES, getRole, childRoleOf };
