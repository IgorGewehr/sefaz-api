# =====================================================================
# Multi-stage build:
#   builder → installs all deps + compiles api + worker
#   api     → prod runtime for the HTTP server (with psql for migrations)
#   worker  → prod runtime for the BullMQ worker
# =====================================================================

FROM node:20-slim AS builder

WORKDIR /app

# Prisma needs OpenSSL at install time to pick the correct binary target.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY apps ./apps
COPY libs ./libs

RUN npx prisma generate
RUN npm run build

# --- API runtime ---
FROM node:20-slim AS api

# psql is used by start-api.sh to apply prisma/sql/rls.sql; openssl is required
# by Prisma; ca-certificates so Node can verify TLS to SEFAZ.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# Compiled apps + libs and the runtime helpers (start script + JS seed).
COPY --from=builder /app/dist ./dist
COPY scripts/start-api.sh /app/scripts/start-api.sh
COPY scripts/seed-runtime.js /app/scripts/seed-runtime.js
RUN chmod +x /app/scripts/start-api.sh

EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "require('http').get('http://localhost:3333/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"
CMD ["sh", "/app/scripts/start-api.sh"]

# --- Worker runtime ---
FROM node:20-slim AS worker

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/apps/worker/main"]
