# CLAUDE.md — Instructions pour l'agent de code

Plateforme de gestion des élections étudiantes : Angular + NestJS + MySQL + Prisma.
Ce fichier est lu automatiquement à chaque session. Il contient les règles **permanentes** du projet.

## Documents de référence

La conception complète est dans `docs/`. **Lire le document concerné avant de coder un module.**

| Fichier | Contenu | À lire pour |
|---|---|---|
| `docs/00-DECISIONS.md` | Décisions validées. **Fait foi en cas de conflit.** | Tout |
| `docs/01-ARCHITECTURE.md` | Stack, structure des dossiers, modules | Toute création de fichier ou module |
| `docs/02-DATABASE.md` | Tables, éligibilité, **vote secret (§6)** | Prisma, éligibilité, vote, résultats |
| `docs/03-ROLES-PERMISSIONS.md` | Matrice des permissions, guards | Tout endpoint |
| `docs/07-MVP-ROADMAP.md` | Sprints, tâches, définition de terminé | Planifier le travail |

`backend/prisma/schema.prisma` est la **seule** source de vérité du modèle de données (aucune copie dans `docs/`).

Si une demande contredit ces documents : **s'arrêter et signaler la contradiction**, ne pas choisir seul.

## Structure du dépôt

```text
docs/        documents de conception
backend/     NestJS (src/<module>/ : controller, service, dto, tests)
frontend/    Angular (src/app/core, shared, features, layout)
docker-compose.yml
```

## Commandes

```bash
cp .env.example .env                       # une fois, puis remplacer les valeurs "change-me" et les secrets JWT
docker compose up -d --build               # tout lancer (db, s3, backend, frontend)
docker compose down -v                     # tout arrêter ET effacer les volumes (base vide au prochain up)
cd backend && npm run lint && npm run test # lint + tests unitaires
cd backend && npm run test:e2e             # tests e2e (Prisma simulé tant qu'aucun test ne cible la vraie base)
cd backend && npm run build
cd backend && npx prisma validate          # avec DATABASE_URL défini
cd backend && npx prisma migrate dev       # nouvelle migration (base locale ; voir note ci-dessous)
cd frontend && npm run lint && npm test    # lint + tests Karma (ChromeHeadless, sans watch)
cd frontend && npm run build
```

- Adresses : frontend http://localhost:4200 ; l'API passe par le frontend (nginx puis `proxy.conf.json` pour `ng serve`) : http://localhost:4200/api/v1, Swagger http://localhost:4200/api/docs, santé `GET /api/v1/health`. Le frontend n'appelle jamais une URL absolue.
- Les migrations Docker sont appliquées au démarrage du backend avec le compte `app_migrate` ; l'application tourne avec `app_runtime` (droits réduits, 02 §10).
- `prisma migrate dev` a besoin de créer une base « shadow » : le compte `app_migrate` n'en a pas le droit. Utiliser une base locale avec un compte root, ou écrire la migration à la main puis `prisma migrate deploy`.
- Stockage S3 local : SeaweedFS (le service s'appelle `s3`), car MinIO n'est plus distribué en image prête à l'emploi.

Mettre cette section à jour si les commandes changent.

## Règles absolues — vote secret

Ne **jamais** enfreindre ces règles, même si une demande semble l'exiger :

1. `ballots` et `ballot_choices` ne contiennent **aucune** colonne `studentId`, `userId`, IP, user-agent, session, ni **aucun horodatage**.
2. Identifiants UUID v4 aléatoires sur ces tables. Jamais d'auto-incrément.
3. Aucune relation entre `voting_participations` et `ballots`.
4. Le vote se fait dans **une seule transaction** (02 §6.3). Le vote unique repose sur la clé primaire de `voting_participations`, pas sur un `if (hasVoted)`.
5. Ne jamais journaliser le corps de `POST /voting/:id/ballot`, ni écrire un choix de vote dans `audit_logs`.
6. Aucun endpoint ne renvoie un `studentId` avec un choix de vote, ni une liste nominative de votants (D-02).
7. Toute modification du module `voting` ou de ces tables doit être **signalée explicitement** dans le résumé de fin de tâche.

## Règles backend

- Chaque route porte `@RequirePermission(...)` ou `@Public()`. Une route sans décorateur fait échouer la CI.
- La portée (institution, élection) se lit **depuis la ressource en base**, jamais depuis le client.
- Ressource d'une autre institution → **404**, pas 403.
- La logique métier va dans les services, pas dans les controllers.
- DTO + `class-validator` sur toute entrée. `ValidationPipe` avec `whitelist` et `forbidNonWhitelisted`.
- Actions sensibles (03 : symbole 🔐) → `StepUpGuard` (2FA récente) + écriture dans `audit_logs`.
- Changement de schéma → migration Prisma. Ne jamais modifier une migration déjà appliquée.
- Jamais de secret dans le code. Nouvelle variable → l'ajouter à `.env.example`.
- Ne jamais logger : mots de passe, tokens, documents, choix de vote.

## Règles frontend

- Aucun texte en dur : tout passe par Transloco, avec la clé dans `ar.json` **et** `fr.json`.
- CSS en propriétés logiques (`margin-inline-start`, `padding-inline-end`), jamais `left`/`right` fixes. L'interface doit fonctionner en RTL et en LTR.
- Reactive Forms pour tous les formulaires.
- Les guards Angular sont un confort d'affichage, pas une sécurité.

## Manière de travailler

- Travailler **un module à la fois**, sur une branche `feat/<module>`.
- Écrire les tests en même temps que le code. Pour le vote : écrire les tests de concurrence **avant** le code.
- Avant de déclarer une tâche terminée : lint, tests et build passent.
- Petits commits clairs, en français ou en anglais, de façon cohérente.
- Fin de tâche : résumer ce qui a été fait, ce qui reste, et toute décision prise qui n'était pas dans `docs/`.
- En cas de doute sur une règle métier : **demander**, ne pas inventer.
