# ApexFinance production image: Node 22 + Debian Chromium for server-side PDFs.
FROM node:22-bookworm-slim

# Chromium renders invoice/receipt PDFs; fonts give PDFs sane fallbacks; tini reaps
# Chromium child processes and forwards signals so `docker stop` shuts down cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CHROME_BIN=/usr/bin/chromium \
    DATABASE_PATH=/app/storage/apexfinance.sqlite

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY client ./client
COPY scripts ./scripts

# Database, generated PDFs and backups live on a volume owned by the unprivileged node user
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
VOLUME ["/app/storage"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
