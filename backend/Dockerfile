FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Saved lab report PDFs (PDF_CACHE_DIR). docker-compose mounts ./data/reports here;
# the host folder must belong to uid 1000 (this "node" user) — see README.
RUN mkdir -p /app/data/reports && chown -R node:node /app/data && chmod 700 /app/data/reports
# Run as the image's unprivileged "node" user, not root.
USER node

EXPOSE 5001

CMD ["node", "src/index.js"]
