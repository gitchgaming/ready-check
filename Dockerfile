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
# A branch deploy (npm run deploy:branch) uploads deploy-info.json; keep it, if
# present, where the runtime stage copies it (src/lib/lanes.ts).
RUN mkdir -p deploy && if [ -f deploy-info.json ]; then mv deploy-info.json deploy/; fi

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
COPY --from=build /app/deploy ./deploy
COPY --from=build /app/docker-start.sh ./
COPY assets ./assets

# Railway: mount a volume at /data and set DATABASE_URL=file:/data/prod.db
# (staging: file:/data/staging.db and DEPLOY_LANES=1).
CMD ["sh", "docker-start.sh"]
