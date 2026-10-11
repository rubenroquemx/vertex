// Carpeta de datos persistentes (en Docker se monta como volumen en /app/data).
const path = require('path');

const DATA_DIR = process.env.VERTEX_DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = { DATA_DIR };
