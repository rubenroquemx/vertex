// Rama de una cuenta (ella y todos sus subordinados, en cualquier nivel): resumen, respaldo y eliminación.
const fs = require('fs');
const AdmZip = require('adm-zip');
const { users, avatars, sessions } = require('./store');
const { getRole, ROLES } = require('./roles');
const territory = require('./territory');
const { PARTIDOS } = require('./partidos');

const BACKUP_VERSION = 1;

// La cuenta raíz seguida de todos sus descendientes (recorrido por niveles)
function branchOf(rootId) {
  const all = users.all();
  const root = all.find((u) => u.id === rootId);
  if (!root) return [];
  const children = new Map();
  for (const u of all) {
    if (!children.has(u.parentId)) children.set(u.parentId, []);
    children.get(u.parentId).push(u);
  }
  const result = [root];
  for (let i = 0; i < result.length; i++) result.push(...(children.get(result[i].id) || []));
  return result;
}

function summary(rootId) {
  const branch = branchOf(rootId);
  if (!branch.length) return null;
  const [root, ...subs] = branch;
  const porNivel = ROLES.map((r) => ({ role: r.key, name: r.name, plural: r.plural, count: subs.filter((u) => u.role === r.key).length })).filter(
    (r) => r.count > 0
  );
  return { user: { id: root.id, name: root.name, role: root.role, roleName: getRole(root.role).name }, subordinados: subs.length, porNivel };
}

// --- Respaldo ----------------------------------------------------------------
// Datos completos de una cuenta, sin la contraseña
function exportUser(u) {
  const { passwordHash, ...rest } = u;
  return { ...rest, roleName: getRole(u.role).name, tienePassword: Boolean(passwordHash) };
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function territorioTexto(t) {
  if (!t) return '';
  const r = territory.resolve(t).resumen;
  return r ? `${r.entidad} · ${r.tipo}: ${r.nombre}` : `${t.tipo} ${t.clave} (entidad ${t.entidad})`;
}

function backupZip(rootId, { by }) {
  const branch = branchOf(rootId);
  if (!branch.length) return null;
  const byId = new Map(branch.map((u) => [u.id, u]));
  const partidoName = new Map(PARTIDOS.map((p) => [p.key, p.name]));
  const createdAt = new Date().toISOString();
  const zip = new AdmZip();

  const data = {
    vertexBackup: BACKUP_VERSION,
    createdAt,
    createdBy: by,
    root: branch[0].id,
    accounts: branch.map(exportUser),
  };
  zip.addFile('respaldo.json', Buffer.from(JSON.stringify(data, null, 2), 'utf8'));

  // CSV para abrir en Excel (BOM UTF-8 para acentos)
  const header = ['Nivel', 'Nombre', 'Usuario', 'Teléfono', 'Correo', 'Depende de', 'Candidato', 'Partidos', 'Territorio', 'Alta', 'ID'];
  const rows = branch.map((u) => [
    getRole(u.role).name,
    u.name,
    u.username || '',
    u.phone || '',
    u.email || '',
    byId.get(u.parentId)?.name || users.get(u.parentId)?.name || '',
    u.candidato || '',
    (u.partidos || []).map((k) => (k === 'OTRO' ? u.partidoOtro || 'Otro' : partidoName.get(k) || k)).join(' + '),
    territorioTexto(u.territorio),
    u.createdAt ? u.createdAt.slice(0, 10) : '',
    u.id,
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  zip.addFile('cuentas.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, 'utf8')]));

  for (const u of branch) {
    if (u.avatarAt && fs.existsSync(avatars.file(u.id))) zip.addFile(`fotos/${u.id}.jpg`, fs.readFileSync(avatars.file(u.id)));
  }

  zip.addFile(
    'LEEME.txt',
    Buffer.from(
      [
        `Respaldo VERTEX de ${branch[0].name} (${getRole(branch[0].role).name}) y su rama.`,
        `Generado: ${createdAt} por ${by}.`,
        `Cuentas incluidas: ${branch.length} (1 titular + ${branch.length - 1} subordinados).`,
        '',
        'cuentas.csv   Lista de cuentas para abrir en Excel.',
        'respaldo.json Datos completos para restaurar en VERTEX.',
        'fotos/        Fotos de perfil (nombre = ID de la cuenta).',
        '',
        'Por seguridad, las contraseñas no se incluyen.',
      ].join('\r\n'),
      'utf8'
    )
  );
  return { buffer: zip.toBuffer(), count: branch.length, root: branch[0] };
}

// --- Eliminación ---------------------------------------------------------------
function removeBranch(rootId) {
  const branch = branchOf(rootId);
  const ids = new Set(branch.map((u) => u.id));
  for (const id of ids) {
    avatars.remove(id);
    sessions.destroyAllFor(id);
  }
  users.removeMany(ids);
  return branch.length;
}

module.exports = { branchOf, summary, backupZip, removeBranch };
