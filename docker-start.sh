#!/bin/sh
# Container entry point (see Dockerfile). prepare-db picks the database: on
# staging, the lane's (src/lib/lanes.ts); elsewhere DATABASE_URL unchanged.
set -e
DATABASE_URL="$(node dist/prepare-db.js)"
export DATABASE_URL
npx prisma migrate deploy
node dist/deploy-commands.js
# Icons are cosmetic, so a failed emoji upload doesn't stop boot.
node dist/deploy-emojis.js || true
exec node dist/index.js
