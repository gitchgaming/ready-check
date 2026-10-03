FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist

# Railway: mount a volume at /data and set DATABASE_URL=file:/data/prod.db
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
