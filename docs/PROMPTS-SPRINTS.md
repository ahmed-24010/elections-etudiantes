# Consignes à donner à l'agent de code, sprint par sprint

Copiez la consigne du sprint dans une **nouvelle session** de l'agent. Une session = un sprint, ou une partie de sprint.
Après chaque session : vérifiez la démo vous-même, relisez le résumé de l'agent, puis cochez les tâches dans `docs/07-MVP-ROADMAP.md`.

---

## Avant le Sprint 1 — à faire vous-même (30 minutes)

1. Créer un dépôt GitHub vide, par exemple `elections-etudiantes`.
2. Y déposer :
   - `CLAUDE.md` à la racine ;
   - `docs/00-DECISIONS.md`, `01-ARCHITECTURE.md`, `02-DATABASE.md`, `03-ROLES-PERMISSIONS.md`, `07-MVP-ROADMAP.md` ;
   - `schema.prisma` dans `docs/` (déplacé dans `backend/prisma/` au Sprint 1 : c'est désormais la seule copie).
3. Ouvrir une session de l'agent sur ce dépôt.

---

## Sprint 1 — Squelette

```text
Lis CLAUDE.md, puis docs/01-ARCHITECTURE.md, docs/00-DECISIONS.md et la section
"Sprint 1" de docs/07-MVP-ROADMAP.md.

Réalise le Sprint 1 entièrement, sans aucune fonctionnalité métier :
- backend NestJS dans backend/ avec la structure de dossiers de 01 §6
  (modules vides), config validée au démarrage, Prisma avec le schema.prisma
  déplacé dans backend/prisma/, migration "init", GET /api/v1/health
  (API + base), Swagger sur /api/docs hors production, nestjs-pino avec
  request ID, filtre d'erreurs global, ValidationPipe global, Helmet, CORS,
  throttler ;
- script SQL des comptes MySQL app_migrate / app_runtime / app_readonly
  selon 02 §10 ;
- frontend Angular dans frontend/ avec la structure de 01 §5, Bootstrap 5
  avec RTL, Transloco (ar.json et fr.json), sélecteur de langue qui change
  dir="rtl"/"ltr", trois layouts vides (public, étudiant, admin), page
  d'accueil affichant l'état de /health ;
- docker-compose.yml : mysql, backend, frontend, minio ;
- .env.example documenté ;
- CI GitHub Actions : lint, tests, build pour backend et frontend ;
- README.md : lancer le projet en 3 commandes.

Avant de commencer, présente-moi ton plan et les versions que tu choisis.
À la fin, vérifie que "docker compose up" fonctionne sur une base vide,
mets à jour la section Commandes de CLAUDE.md, et résume ce qui a été fait.
```

**Votre vérification :** `docker compose up`, la page s'affiche, le changement de langue inverse le sens de la page, et le statut indique « API OK, base OK ».

---

## Sprint 2 — Authentification et rôles

```text
Lis CLAUDE.md, docs/03-ROLES-PERMISSIONS.md en entier, docs/02-DATABASE.md
§4.1 et §9, et la section "Sprint 2" de docs/07-MVP-ROADMAP.md.

Réalise le Sprint 2. Points d'attention :
- refresh token en cookie HttpOnly, rotation et révocation de la famille
  en cas de réutilisation ;
- les rôles ne sont PAS dans le JWT : relus à chaque requête (03 §7.4) ;
- permissions.ts unique, PermissionGuard, @RequirePermission, @ScopeFrom,
  @Public, StepUpGuard (2FA TOTP < 10 min) ;
- audit_logs avec chaîne de hachage ;
- test qui fait échouer la CI si une route n'a ni @RequirePermission
  ni @Public ;
- tests d'autorisation de 03 §8 applicables à ce sprint.

Commence par me présenter ton plan. Arrête-toi et demande-moi si une règle
de 03 te semble ambiguë.
```

**Votre vérification :** un SUPER_ADMIN crée un INSTITUTION_ADMIN, qui active sa 2FA et se connecte. Une révocation de rôle prend effet immédiatement.

---

## Sprint 3 — Structure académique et vérification

```text
Lis CLAUDE.md, docs/02-DATABASE.md §4.2, §4.3 et §10,
docs/03-ROLES-PERMISSIONS.md §5.1, §5.3 et §6, et la section "Sprint 3"
de docs/07-MVP-ROADMAP.md.

Réalise le Sprint 3. Points d'attention :
- upload : contrôle du type réel du fichier (magic bytes), 5 Mo max,
  nom généré par le serveur, stockage privé MinIO, URL signée de 5 minutes ;
- l'INSTITUTION_ADMIN ne voit pas les attestations : seul le vérificateur
  et l'étudiant lui-même ;
- un vérificateur ne valide pas sa propre inscription ;
- tests d'isolation entre institutions (404).

Commence par me présenter ton plan.
```

**Votre vérification :** un étudiant dépose son attestation, le vérificateur la valide, l'étudiant voit « Compte vérifié ». Un admin d'une autre institution ne voit rien.

---

## Sprint 4 — Élections, éligibilité, candidatures

```text
Lis CLAUDE.md, docs/00-DECISIONS.md, docs/02-DATABASE.md §4.4, §5 et §7,
docs/03-ROLES-PERMISSIONS.md §5.4, §5.5 et §6, et la section "Sprint 4"
de docs/07-MVP-ROADMAP.md.

Réalise le Sprint 4, SANS le vote (Sprint 5). Points d'attention :
- éligibilité exactement selon 02 §5 (ET dans une règle, OU entre règles) ;
- les 5 exemples de 02 §5 deviennent des tests automatisés ;
- comité : 3 membres minimum avant ouverture du vote (D-03) ;
- un seul poste par étudiant et par élection (D-05) ;
- membre du comité ≠ candidat dans la même élection ;
- le comité voit le NOMBRE d'éligibles, jamais leurs noms (D-02).

Commence par me présenter ton plan.
```

**Votre vérification :** deux étudiants de groupes différents voient des élections différentes. Un candidat est validé par le comité.

**⚠️ Avant le Sprint 5 :** `docs/04-ELECTION-VOTING-FLOW.md` doit exister et être relu. Demandez-le-moi pendant ce sprint.

---

## Sprint 5 — Vote (le plus important)

À lancer en **deux sessions séparées**.

**Session A — les tests d'abord**

```text
Lis CLAUDE.md (en particulier "Règles absolues — vote secret"),
docs/02-DATABASE.md §6 en entier, docs/04-ELECTION-VOTING-FLOW.md, et la
section "Sprint 5" de docs/07-MVP-ROADMAP.md.

N'écris PAS encore le service de vote. Écris uniquement les tests
listés dans la section "Tests obligatoires" du Sprint 5, contre une vraie
base MySQL de test (pas de mock pour la transaction), y compris :
- 50 requêtes simultanées du même étudiant → exactement 1 bulletin ;
- erreur au milieu de la transaction → ni participation ni bulletin ;
- aucune réponse API ne contient studentId avec un choix ;
- invariant participants = bulletins après 1 000 votes simulés.

Les tests doivent échouer pour l'instant. Montre-moi la liste des tests.
```

**Session B — le code**

```text
Lis CLAUDE.md et docs/02-DATABASE.md §6. Les tests du module voting
existent déjà. Implémente le Sprint 5 pour les faire passer, en suivant
exactement la transaction de 02 §6.3. Ne modifie pas les tests sans me
demander. À la fin, liste toutes les modifications touchant au vote.
```

**Votre vérification :** 20 comptes de test votent. Ouvrez la base vous-même : il est impossible de relier un bulletin à un étudiant.

---

## Sprint 6 — Résultats et tableau de bord

```text
Lis CLAUDE.md, docs/00-DECISIONS.md (D-01, D-12), docs/02-DATABASE.md
§6.4, §6.6, §8 et §9, docs/03-ROLES-PERMISSIONS.md §5.7 et §5.8, et la
section "Sprint 6" de docs/07-MVP-ROADMAP.md.

Réalise le Sprint 6. Points d'attention :
- résultats NON publiés si l'invariant participants = bulletins échoue ;
- résultats par poste uniquement (D-12) ;
- égalité → proposer au comité un second tour lié (parentElectionId, round) ;
- sauvegarde MySQL ET test de restauration documenté dans le README.

Commence par me présenter ton plan.
```

**Votre vérification :** une élection complète, de la création au PDF du procès-verbal.

---

## Conseils pour travailler avec l'agent

- **Demandez toujours un plan d'abord.** Corriger un plan prend 2 minutes, corriger du code prend 2 heures.
- **Une session = un objectif.** Des sessions trop longues font perdre les règles de vue.
- **Testez la démo vous-même.** « Les tests passent » ne veut pas dire que ça marche.
- **Relisez tout ce qui touche au vote** ligne par ligne, même si l'agent dit que c'est bon.
- **Si l'agent prend une décision non prévue**, ajoutez-la à `docs/00-DECISIONS.md`.
- **Si l'agent répète une erreur**, ajoutez une règle à `CLAUDE.md`.
