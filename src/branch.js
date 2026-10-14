// Rama de una cuenta (ella y todos sus subordinados, en cualquier nivel): resumen, respaldo y eliminación.
const AdmZip = require('adm-zip');
const { users, avatars, promovidos: cachePromovidos } = require('./store');
const { query } = require('./db');
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

// Promovidos que pertenecen a la rama (capturados por sus promotores o asignados a sus responsables)
async function promovidosDeRama(ids) {
  const { rows } = await query(
    `SELECT p.id, p.promotor_id, p.responsable_id, p.seccion, p.data, p.clave_elector, p.curp, p.estatus, p.created_at
     FROM promovidos p WHERE p.promotor_id = ANY($1::uuid[]) OR p.responsable_id = ANY($1::uuid[]) ORDER BY p.created_at`,
    [ids]
  );
  return rows;
}

// Cuentas del mismo nivel y del mismo superior que pueden recibir a los dependientes.
// El CPV no se transfiere: cada uno tiene su propio territorio y candidato.
function destinosTransferencia(target) {
  if (!target || target.role === 'coord_promocion' || target.role === 'superadmin') return [];
  return users
    .all()
    .filter((u) => u.id !== target.id && u.role === target.role && u.parentId === target.parentId && !u.disabled)
    .map((u) => ({ id: u.id, name: u.name, zona: u.zona?.nombre || null, secciones: u.territorio?.secciones || [] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
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

async function backupZip(rootId, { by }) {
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

  // Promovidos de la rama: datos completos y, si no son demasiados, las fotos de su INE
  const prom = await promovidosDeRama(branch.map((u) => u.id));
  const nombreDe = (id) => byId.get(id)?.name || users.get(id)?.name || '';
  const pHeader = ['Nombre(s)', 'Apellido paterno', 'Apellido materno', 'Clave de elector', 'CURP', 'Sección', 'Vigencia', 'Teléfono', 'Calle', 'No. Ext.', 'No. Int.', 'Fracc.', 'Localidad', 'CP', 'Municipio', 'Estado', 'Estatus', 'Promotor', 'Responsable', 'Alta', 'ID'];
  const pRows = prom.map((p) => {
    const d = p.data || {};
    const dom = d.domicilio || {};
    return [d.nombres, d.paterno, d.materno, p.clave_elector, p.curp, p.seccion, d.vigencia, d.telefono, dom.calle, dom.numExt, dom.numInt, dom.fracc, dom.localidad, dom.cp, dom.municipio, dom.estado, p.estatus, nombreDe(p.promotor_id), nombreDe(p.responsable_id), p.created_at.toISOString().slice(0, 10), p.id];
  });
  zip.addFile('promovidos.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from([pHeader, ...pRows].map((r) => r.map(csvCell).join(',')).join('\r\n'), 'utf8')]));
  zip.addFile('promovidos.json', Buffer.from(JSON.stringify(prom.map((p) => ({ ...p, created_at: p.created_at.toISOString() })), null, 2), 'utf8'));
  const CON_FOTOS = 500;
  if (prom.length && prom.length <= CON_FOTOS) {
    for (let i = 0; i < prom.length; i += 100) {
      const ids = prom.slice(i, i + 100).map((p) => p.id);
      const { rows: fotos } = await query('SELECT promovido_id, lado, image FROM promovido_ine WHERE promovido_id = ANY($1::uuid[])', [ids]);
      for (const f of fotos) {
        const ext = f.image.toString('ascii', 0, 4) === 'RIFF' ? 'webp' : 'jpg';
        zip.addFile(`ine/${f.promovido_id}-${f.lado}.${ext}`, f.image);
      }
    }
  }

  for (const u of branch) {
    if (!u.avatarAt) continue;
    const img = await avatars.get(u.id);
    if (img) zip.addFile(`fotos/${u.id}.jpg`, img);
  }

  zip.addFile(
    'LEEME.txt',
    Buffer.from(
      [
        `Respaldo VERTEX de ${branch[0].name} (${getRole(branch[0].role).name}) y su rama.`,
        `Generado: ${createdAt} por ${by}.`,
        `Cuentas incluidas: ${branch.length} (1 titular + ${branch.length - 1} subordinados).`,
        '',
        'cuentas.csv     Lista de cuentas para abrir en Excel.',
        'respaldo.json   Datos completos para restaurar en VERTEX.',
        'fotos/          Fotos de perfil (nombre = ID de la cuenta).',
        `promovidos.csv  Promovidos de la rama (${prom.length}) para abrir en Excel.`,
        'promovidos.json Datos completos de los promovidos.',
        prom.length > CON_FOTOS
          ? `ine/            No incluida: son más de ${CON_FOTOS} promovidos; las fotos de la INE se pierden al eliminar.`
          : 'ine/            Fotos de la INE (nombre = ID del promovido y lado).',
        '',
        'Contiene datos personales: guárdalo en un lugar seguro y bórralo cuando ya no se necesite.',
        '',
        'Por seguridad, las contraseñas no se incluyen.',
      ].join('\r\n'),
      'utf8'
    )
  );
  return { buffer: zip.toBuffer(), count: branch.length, root: branch[0] };
}

// --- Eliminación ---------------------------------------------------------------
// Las sesiones y fotos de las cuentas se borran en cascada en la base
async function removeBranch(rootId) {
  const branch = branchOf(rootId);
  const ids = branch.map((u) => u.id);
  // Primero sus promovidos (con sus fotos, historial y observaciones), para no dejar huérfanos
  const { rows } = await query('DELETE FROM promovidos WHERE promotor_id = ANY($1::uuid[]) OR responsable_id = ANY($1::uuid[]) RETURNING id', [ids]);
  cachePromovidos.olvidar(new Set(rows.map((r) => r.id)));
  await query('DELETE FROM notificaciones WHERE url = ANY($1)', [rows.map((r) => `/promovidos/${r.id}`)]);
  await users.removeMany(new Set(ids));
  return { cuentas: branch.length, promovidos: rows.length };
}

// Pasa los dependientes directos de `target` a `destino` (mismo nivel y mismo superior):
// subordinados, promovidos asignados, material y —en las zonas— su territorio.
async function transferirDependientes(target, destino) {
  const hijos = users.all().filter((u) => u.parentId === target.id);
  for (const h of hijos) await users.update(h.id, { parentId: destino.id });
  if (target.role === 'coord_zona') {
    const secciones = [...new Set([...(destino.territorio?.secciones || []), ...(target.territorio?.secciones || [])])].sort((a, b) => a - b);
    await users.update(destino.id, { territorio: { ...(destino.territorio || {}), tipo: 'secciones', metodo: 'manual', secciones } });
  }
  const { rowCount } = await query('UPDATE promovidos SET responsable_id = $2 WHERE responsable_id = $1', [target.id, destino.id]);
  for (const p of cachePromovidos.all()) if (p.responsableId === target.id) p.responsableId = destino.id;
  await query('UPDATE material_ordenes SET para_id = $2 WHERE para_id = $1', [target.id, destino.id]);
  await query('UPDATE material_ordenes SET de_id = $2 WHERE de_id = $1', [target.id, destino.id]);
  // Asambleas y recorridos: pasan a la cuenta que hereda la estructura
  for (const col of ['rs_id', 'zona_id', 'cpv_id']) await query(`UPDATE eventos SET ${col} = $2 WHERE ${col} = $1`, [target.id, destino.id]);
  return { subordinados: hijos.length, promovidos: rowCount };
}

// Borra a los dependientes de una cuenta (sus subordinados y sus promovidos), conservando la cuenta
async function borrarDependientes(target) {
  const ids = branchOf(target.id).map((u) => u.id);
  const { rows } = await query('DELETE FROM promovidos WHERE promotor_id = ANY($1::uuid[]) OR responsable_id = ANY($1::uuid[]) RETURNING id', [ids]);
  cachePromovidos.olvidar(new Set(rows.map((r) => r.id)));
  await query('DELETE FROM notificaciones WHERE url = ANY($1)', [rows.map((r) => `/promovidos/${r.id}`)]);
  const subs = ids.filter((id) => id !== target.id);
  await users.removeMany(new Set(subs));
  return { subordinados: subs.length, promovidos: rows.length };
}

module.exports = { branchOf, summary, backupZip, removeBranch, promovidosDeRama, destinosTransferencia, transferirDependientes, borrarDependientes };
