#!/bin/sh
# Entry-point for the API container. Postgres is already healthy when this runs
# (compose depends_on), so we go straight into migrate → RLS → seed → start.
set -eu

echo "[start-api] applying Prisma migrations…"
npx prisma migrate deploy

echo "[start-api] applying Row Level Security policies (idempotent)…"
# `set_config` GUC, ALTER … ENABLE RLS and CREATE POLICY are all idempotent
# enough that re-running on each boot is safe. We swallow CREATE POLICY
# errors (already exists) so the container doesn't crash on restart.
PGPASSWORD=sefaz psql -h postgres -U sefaz -d sefaz \
    -v ON_ERROR_STOP=0 -f prisma/sql/rls.sql >/dev/null 2>&1 || true

echo "[start-api] seeding bootstrap tenant + API key (idempotent)…"
node /app/scripts/seed-runtime.js || true

echo "[start-api] launching NestJS HTTP server on :${PORT:-3333}"
exec node dist/apps/api/main
