// Ficha del promovido en PDF: datos, fotos de la INE y domicilio.
// No incluye el historial de cambios ni las observaciones.
const PDFDocument = require('pdfkit');

const ESTATUS = { en_revision: 'En revisión', validado: 'Validado', rechazado: 'Rechazado' };
const ZONA = 'America/Mexico_City';
const fecha = (iso) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA });
const fechaHora = (d) =>
  d.toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: ZONA });
const telefono = (t) => (t && t.length === 10 ? `${t.slice(0, 2)} ${t.slice(2, 6)} ${t.slice(6)}` : t || '');

const TINTA = '#0a0a0a';
const GRIS = '#737373';
const LINEA = '#e5e5e5';

/**
 * @param {object} p  detalle del promovido (src/promovidos.js → detalle)
 * @param {{ frente: Buffer|null, reverso: Buffer|null }} fotos
 * @param {string} generadoPor  nombre de quien descarga
 * @returns {Promise<Buffer>}
 */
function generar(p, fotos, generadoPor) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 48,
      info: { Title: `Ficha de promovido - ${p.nombre}`, Author: 'VERTEX', Subject: 'Ficha de promovido' },
    });
    const partes = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const izq = doc.page.margins.left;
    const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Encabezado
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA).text('VERTEX', izq, 48, { characterSpacing: 2 });
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Ficha de promovido', izq, 50, { width: ancho, align: 'right' });
    doc.moveTo(izq, 68).lineTo(izq + ancho, 68).lineWidth(1).strokeColor(LINEA).stroke();

    // Nombre y estado
    doc.font('Helvetica-Bold').fontSize(20).fillColor(TINTA).text(p.nombre, izq, 84, { width: ancho });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(GRIS)
      .text(
        [`Estatus: ${ESTATUS[p.estatus] || 'En revisión'}`, `Sección ${p.seccion}`, `Registrado el ${fecha(p.createdAt)}${p.promotor ? ` por ${p.promotor}` : ''}`].join('   ·   '),
        { width: ancho }
      );

    const titulo = (t) => {
      doc.moveDown(1.2);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS).text(t.toUpperCase(), { characterSpacing: 1 });
      const y = doc.y + 4;
      doc.moveTo(izq, y).lineTo(izq + ancho, y).lineWidth(1).strokeColor(LINEA).stroke();
      doc.y = y + 10;
    };

    // Rejilla de datos a dos columnas (etiqueta arriba, valor abajo)
    const datos = (pares) => {
      const col = (ancho - 24) / 2;
      for (let i = 0; i < pares.length; i += 2) {
        const y = doc.y;
        let alto = 0;
        [pares[i], pares[i + 1]].forEach((par, j) => {
          if (!par) return;
          const x = izq + j * (col + 24);
          doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(par[0], x, y, { width: col });
          doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA).text(par[1] || '—', x, doc.y + 1, { width: col });
          alto = Math.max(alto, doc.y - y);
        });
        doc.y = y + alto + 10;
      }
    };

    // Credencial: fotos lado a lado
    titulo('Credencial para votar (INE)');
    const anchoFoto = (ancho - 16) / 2;
    const altoFoto = anchoFoto / (85.6 / 54);
    const yFotos = doc.y;
    [
      ['Frente', fotos.frente],
      ['Reverso', fotos.reverso],
    ].forEach(([etiqueta, buf], i) => {
      const x = izq + i * (anchoFoto + 16);
      if (buf) {
        try {
          doc.image(buf, x, yFotos, { fit: [anchoFoto, altoFoto], align: 'center', valign: 'center' });
        } catch {
          doc.rect(x, yFotos, anchoFoto, altoFoto).fillColor('#f5f5f5').fill();
        }
      } else doc.rect(x, yFotos, anchoFoto, altoFoto).fillColor('#f5f5f5').fill();
      doc.rect(x, yFotos, anchoFoto, altoFoto).lineWidth(0.5).strokeColor(LINEA).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(etiqueta, x, yFotos + altoFoto + 4, { width: anchoFoto });
    });
    doc.x = izq;
    doc.y = yFotos + altoFoto + 24;
    datos([
      ['Clave de elector', p.claveElector],
      ['CURP', p.curp],
      ['Vigencia', String(p.vigencia || '')],
      ['Sección', String(p.seccion)],
      ['Teléfono (WhatsApp)', telefono(p.telefono)],
    ]);

    // Domicilio
    const d = p.domicilio || {};
    titulo('Domicilio');
    datos([
      ['Calle y número', [d.calle, d.numExt && `No. ${d.numExt}`, d.numInt && `Int. ${d.numInt}`].filter(Boolean).join(' ')],
      ['Fracc.', d.fracc],
      ['Localidad', d.localidad],
      ['Código postal', d.cp],
      ['Municipio', d.municipio],
      ['Estado', d.estado],
    ]);

    // Pie
    const pie = doc.page.height - doc.page.margins.bottom - 24;
    doc.moveTo(izq, pie - 8).lineTo(izq + ancho, pie - 8).lineWidth(1).strokeColor(LINEA).stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GRIS)
      .text(`Generado el ${fechaHora(new Date())} por ${generadoPor}. Contiene datos personales: manéjalo con confidencialidad.`, izq, pie, {
        width: ancho,
        lineBreak: true,
      });

    doc.end();
  });
}

module.exports = { generar };
