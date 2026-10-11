#!/bin/sh
# Primer arranque: si el volumen de datos está vacío y hay datos iniciales, se copian.
# En los siguientes despliegues el volumen ya tiene datos y no se toca.
set -e
DATA_DIR="${VERTEX_DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/db.json" ] && [ -d /app/seed-data ] && [ -n "$(ls -A /app/seed-data 2>/dev/null)" ]; then
  echo "VERTEX: volumen vacío, copiando datos iniciales…"
  cp -R /app/seed-data/. "$DATA_DIR/"
fi
exec "$@"
