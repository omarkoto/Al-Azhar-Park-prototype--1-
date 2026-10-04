#!/bin/sh
# Apply pending database migrations, then start the API. If a migration fails the container exits
# (and the orchestrator keeps the old version running) instead of serving against a half-migrated schema.
set -e

echo "Applying database migrations…"
npx prisma migrate deploy

echo "Starting API…"
exec node dist/main.js
