# Élections étudiantes

Plateforme de gestion des élections étudiantes (Angular 20 + NestJS 11 + MySQL 8.4 + Prisma 6).

- Conception : voir le dossier `docs/`
- Règles pour l'agent de code : `CLAUDE.md`
- Avancement : `docs/07-MVP-ROADMAP.md`

## Lancer le projet en 3 commandes

Prérequis : Docker Desktop.

```bash
cp .env.example .env     # 1. puis remplacer les valeurs "change-me" et générer les 2 secrets JWT
docker compose up -d --build   # 2.
# 3. ouvrir http://localhost:4200
```

La page d'accueil s'affiche en arabe (RTL) ; le sélecteur de langue passe au français (LTR).
Elle indique l'état de l'API et de la base.

| Service | Adresse |
|---|---|
| Frontend | http://localhost:4200 |
| API | http://localhost:4200/api/v1 via le frontend (santé : `/health`) ; accès direct : http://localhost:3000/api/v1 |
| Swagger | http://localhost:4200/api/docs (hors production) |
| MySQL | `127.0.0.1:3306` |
| S3 (SeaweedFS) | `127.0.0.1:9000` |

Repartir d'une base vide : `docker compose down -v` puis `docker compose up -d --build`.

## Sans Docker pour l'application

```bash
docker compose up -d db s3
cd backend && npm ci && npx prisma generate && npm run start:dev   # lit DATABASE_URL (voir .env.example)
cd frontend && npm ci && npm start   # proxy.conf.json redirige /api vers localhost:3000
```

Les migrations sont appliquées par `prisma migrate deploy` avec `MIGRATE_DATABASE_URL` (voir `CLAUDE.md`).

## Tests

```bash
cd backend && npm run lint && npm test && npm run test:e2e
cd frontend && npm run lint && npm test
```

Prérequis Node : ≥ 22.12 (Angular 20).
