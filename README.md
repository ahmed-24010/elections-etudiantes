# Plateforme d'élections étudiantes

Angular 20 + NestJS 11 + MySQL/Prisma + S3 (MinIO). Documentation dans [docs/](docs/).

## Démarrage

```bash
cp .env.example .env        # puis renseigner les secrets JWT et mots de passe
docker compose up --build   # db, minio, backend (migrations auto), frontend
```

- Frontend : http://localhost:4200 — API : http://localhost:3000/api — Swagger : http://localhost:3000/api/docs
- Premier super-admin : `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` dans `.env`, puis `npm run prisma:seed` dans `backend/`.

## Développement sans Docker pour l'app

```bash
docker compose up -d db minio
cd backend && npm install && npx prisma migrate deploy && npm run start:dev
cd frontend && npm install && npm start
```

## Tests

```bash
cd backend && npm test && npm run test:e2e        # e2e sans base (Prisma simulé)
cd frontend && npx ng test --watch=false --browsers=ChromeHeadless
```

Prérequis Node : ≥ 22.12 (Angular 20).
