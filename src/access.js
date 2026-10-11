// Reglas de acceso de la estructura multinivel.
//  - Cada nivel ve y crea únicamente a su inmediato inferior (las cuentas que dependen de él).
//    El super administrador ve solo a los Coordinadores de Promoción del Voto; los niveles de abajo
//    se recorren entrando a cada cuenta en modo dios, nivel por nivel.
//  - Cada nivel crea solo el nivel inmediato inferior, que queda colgando de quien lo crea.
const { childRoleOf } = require('./roles');

function visibleUsers(actor, allUsers) {
  return allUsers.filter((u) => u.parentId === actor.id);
}

function canView(actor, target, allUsers) {
  if (actor.id === target.id) return true;
  return visibleUsers(actor, allUsers).some((u) => u.id === target.id);
}

function creatableRole(actor) {
  return childRoleOf(actor.role);
}

// Cadena jerárquica desde la cuenta superior hasta `user` (incluido)
function chainOf(user, allUsers) {
  const byId = new Map(allUsers.map((u) => [u.id, u]));
  const chain = [];
  const seen = new Set();
  for (let u = user; u && !seen.has(u.id); u = byId.get(u.parentId)) {
    seen.add(u.id);
    chain.unshift(u);
  }
  return chain;
}

module.exports = { visibleUsers, canView, creatableRole, chainOf };
