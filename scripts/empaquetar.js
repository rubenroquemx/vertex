// Genera dist/vertex-easypanel.zip listo para desplegar en Easypanel (Dockerfile).
// Uso: node scripts/empaquetar.js            → con datos iniciales (seed-data/)
//      node scripts/empaquetar.js --vacio    → sin datos iniciales
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'dist', 'vertex-easypanel.zip');
const vacio = process.argv.includes('--vacio');

const zip = new AdmZip();
for (const f of ['Dockerfile', '.dockerignore', 'docker-entrypoint.sh', 'package.json', 'package-lock.json', 'server.js', 'DESPLIEGUE.md']) {
  zip.addLocalFile(path.join(ROOT, f));
}
zip.addLocalFolder(path.join(ROOT, 'src'), 'src');
zip.addLocalFolder(path.join(ROOT, 'public'), 'public');

// La carpeta seed-data debe existir aunque vaya vacía (el Dockerfile la copia)
zip.addFile('seed-data/.keep', Buffer.from(''));
if (!vacio && fs.existsSync(path.join(DATA, 'db.json'))) {
  // Sin sesiones de desarrollo
  const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
  db.sessions = {};
  zip.addFile('seed-data/db.json', Buffer.from(JSON.stringify(db, null, 2)));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  for (const f of walk(DATA)) {
    const rel = path.relative(DATA, f).split(path.sep).join('/');
    // Fuera: la base (ya agregada), la credencial del admin y temporales
    if (rel === 'db.json' || rel === 'CREDENCIAL_ADMIN.txt' || rel.endsWith('.tmp') || /\.(old|tmp)-/.test(rel)) continue;
    const dir = path.posix.dirname(rel);
    zip.addLocalFile(f, dir === '.' ? 'seed-data' : `seed-data/${dir}`);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
zip.writeZip(OUT);

const names = new AdmZip(OUT).getEntries().map((e) => e.entryName);
console.log(`Paquete: ${path.relative(ROOT, OUT)} · ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB · ${names.length} archivos`);
console.log('Datos iniciales:', vacio ? 'no' : [...new Set(names.filter((n) => n.startsWith('seed-data/') && !n.endsWith('.keep')).map((n) => n.split('/').slice(0, 2).join('/')))].join(', ') || 'ninguno');
if (names.some((n) => /CREDENCIAL/.test(n))) throw new Error('El paquete no debe incluir la credencial del admin');
