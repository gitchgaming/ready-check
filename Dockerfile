FROM node:26-alpine AS build
WORKDIR /app
# openssl: Prisma's migration engine. python3/make/g++: fallback for building
# better-sqlite3's native module if no prebuilt binary matches this platform.
RUN apk add --no-cache openssl python3 make g++
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime image: only production dependencies (already compiled for this
# platform in the build stage), the compiled bot, and what migrations need.
FROM node:26-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/package*.json /app/prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY assets ./assets

# Railway: mount a volume at /data and set DATABASE_URL=file:/data/prod.db
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/deploy-commands.js && (node dist/deploy-emojis.js || true) && node dist/index.js"]
