FROM node:26-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
COPY assets ./assets

# Railway: mount a volume at /data and set DATABASE_URL=file:/data/prod.db
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/deploy-commands.js && (node dist/deploy-emojis.js || true) && node dist/index.js"]
