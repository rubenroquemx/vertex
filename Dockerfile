# VERTEX — imagen de producción
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    VERTEX_DATA_DIR=/app/data

WORKDIR /app

# Dependencias (sin las de desarrollo); se instalan antes para aprovechar la caché
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código de la aplicación (lo excluido está en .dockerignore). Si el paquete trae
# seed-data/ (datos iniciales) se incluye; si no, la app arranca vacía.
COPY . .
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/data /app/seed-data && chown -R node:node /app

USER node
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health >/dev/null || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
