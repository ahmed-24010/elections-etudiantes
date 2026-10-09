# Debian "slim" (glibc) et non Alpine : argon2 fournit des binaires précompilés pour glibc.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
# Vérifie au build que argon2 se charge réellement dans l'image finale.
RUN node -e "require('argon2').hash('x').then(()=>console.log('argon2 OK'))"
USER node
EXPOSE 3000
# Migrations avec le compte app_migrate, puis l'application avec le compte app_runtime (DATABASE_URL).
CMD ["sh", "-c", "DATABASE_URL=\"$MIGRATE_DATABASE_URL\" npx prisma migrate deploy && node dist/main"]
