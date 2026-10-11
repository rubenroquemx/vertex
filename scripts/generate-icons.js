// Genera los íconos PNG de la PWA a partir del ícono oficial de la marca.
// Fuente: public/brand/icono.svg (copia de RECURSOS/Icono.svg)
// Uso: npm run icons
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'public', 'brand', 'icono.svg');
const OUT = path.join(__dirname, '..', 'public', 'icons');

const TARGETS = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
];

(async () => {
  for (const [name, size] of TARGETS) {
    await sharp(SRC, { density: 300 }).resize(size, size).png().toFile(path.join(OUT, name));
    console.log(`${name} (${size}x${size})`);
  }
})();
