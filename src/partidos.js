// Catálogo de partidos políticos. "OTRO" permite capturar un nombre libre (independientes u otros).
const PARTIDOS = [
  { key: 'MORENA', name: 'MORENA', color: '#a6192e' },
  { key: 'PAN', name: 'PAN', color: '#0055a5' },
  { key: 'PRI', name: 'PRI', color: '#00843d' },
  { key: 'PVEM', name: 'PVEM', color: '#50b748' },
  { key: 'PT', name: 'PT', color: '#e2231a' },
  { key: 'MC', name: 'Movimiento Ciudadano', color: '#ff8300' },
  { key: 'PAZ', name: 'Partido PAZ', color: '#7e3bbf' },
  { key: 'SOMOS', name: 'SOMOS', color: '#0a84c6' },
  { key: 'PRD', name: 'PRD', color: '#f2b705' },
  { key: 'OTRO', name: 'Otro / Indep.', color: '#94a3b8' },
];

const KEYS = new Set(PARTIDOS.map((p) => p.key));

module.exports = { PARTIDOS, isPartido: (k) => KEYS.has(k) };
