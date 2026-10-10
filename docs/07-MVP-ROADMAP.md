# 07 — Roadmap du MVP

## Plateforme de gestion des élections étudiantes

**Version :** 1.0
**Date :** 09/10/2026
**Hypothèse :** un développeur principal, sprints de **2 semaines**
**Durée estimée :** 14 semaines (Sprint 0 à Sprint 6) + 2 semaines de pilote

---

## 1. Vue d'ensemble

| Sprint | Semaines | Thème | Résultat visible | Document à écrire en parallèle |
|---|---|---|---|---|
| 0 | 1 | Préparation | Décisions validées, outils prêts | — |
| 1 | 2-3 | Squelette | `docker compose up` lance tout, page d'accueil AR/FR | — |
| 2 | 4-5 | Authentification et rôles | Inscription, connexion, rôles, 2FA admin | 05-API (auth, users) |
| 3 | 6-7 | Structure académique et vérification | L'admin crée la structure, l'étudiant dépose son attestation, le vérificateur valide | 06-SECURITY (upload, fichiers) |
| 4 | 8-9 | Élections, éligibilité, candidatures | Le comité crée une élection ; l'étudiant voit **ses** élections et se porte candidat | **04-ELECTION-VOTING-FLOW (obligatoire avant le Sprint 5)** |
| 5 | 10-11 | Vote | Vote secret, unique, testé sous concurrence | 05-API (voting) |
| 6 | 12-13 | Résultats et tableau de bord | Clôture automatique, décompte, résultats, PDF simple | 06-SECURITY (finalisation) |
| Pilote | 14-15 | Élection test réelle | 10 à 20 personnes votent pour de vrai | Retour d'expérience |

**Règle :** un sprint n'est terminé que si sa « définition de terminé » (§10) est respectée. On ne commence pas le sprint suivant avec des tests rouges.

---

## 2. Sprint 0 — Préparation (1 semaine)

**Objectif :** pouvoir écrire la première ligne de code sans hésiter.

- [x] 01-ARCHITECTURE, 02-DATABASE, 03-ROLES-PERMISSIONS
- [x] Décisions validées (00-DECISIONS)
- [ ] Choisir la bibliothèque UI (A-03). Recommandation : **Bootstrap 5**, qui fournit une version RTL officielle
- [ ] Installer : Node.js LTS, Docker Desktop, Git, VS Code (extensions Prisma, Angular, ESLint)
- [ ] Créer le dépôt Git (GitHub ou GitLab), branche `main` protégée
- [ ] Copier les documents dans `docs/`

---

## 3. Sprint 1 — Squelette (semaines 2-3)

**Objectif :** toute la chaîne fonctionne de bout en bout, sans fonctionnalité métier.

### Backend
- [x] Projet NestJS dans `backend/`, structure de dossiers de 01 §6
- [x] Configuration par variables d'environnement (`@nestjs/config`), validation au démarrage
- [x] Prisma + `backend/prisma/schema.prisma` (modèle de 02), première migration `init`
- [x] Script SQL des comptes MySQL (`app_migrate`, `app_runtime`, `app_readonly`) — 02 §10
- [x] Endpoint `GET /api/v1/health` (API + base)
- [x] Swagger sur `/api/docs` (désactivé en production)
- [x] Logs structurés avec request ID (`nestjs-pino`)
- [x] Filtre d'erreurs global, `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`)
- [x] Helmet, CORS, rate limiting global (`@nestjs/throttler`)

### Frontend
- [x] Projet Angular dans `frontend/`, structure de 01 §5
- [x] Bootstrap 5 + RTL
- [x] i18n à l'exécution avec **Transloco** : fichiers `ar.json` et `fr.json`, sélecteur de langue
- [x] Changement de `dir="rtl"` / `dir="ltr"` sur `<html>` selon la langue
- [x] CSS en propriétés logiques (`margin-inline-start` plutôt que `margin-left`)
- [x] Trois layouts vides : public, étudiant, admin
- [x] Page d'accueil qui affiche l'état de `/health`

### Infrastructure
- [x] `docker-compose.yml` : `mysql`, `backend`, `frontend`, `s3` (stockage S3 local : SeaweedFS à la place de MinIO, D-17)
- [x] `.env.example` documenté, `.env` dans `.gitignore`
- [x] CI (GitHub Actions) : lint + tests + build backend et frontend à chaque push
- [x] `README.md` : comment lancer le projet en 3 commandes

**Démo de fin de sprint :** `docker compose up`, la page s'affiche en arabe puis en français, et indique « API OK, base OK ».

---

## 4. Sprint 2 — Authentification et rôles (semaines 4-5)

**Objectif :** chaque utilisateur se connecte et le backend sait exactement ce qu'il a le droit de faire.

- [x] Module `auth` : inscription étudiant, connexion, déconnexion
- [x] Hash Argon2id des mots de passe
- [x] Access token JWT court (15 min) + refresh token en cookie `HttpOnly`, rotation, détection de réutilisation (`familyId`)
- [x] Rate limiting renforcé sur `/auth/*`
- [x] Module `users` : profil, changement de mot de passe
- [x] `role_assignments` : attribution et révocation (03 §5.2)
- [x] `permissions.ts`, `JwtAuthGuard`, `PermissionGuard`, décorateurs `@RequirePermission`, `@ScopeFrom`, `@Public` (03 §7)
- [x] 2FA TOTP pour les rôles administratifs + `StepUpGuard` (D-10)
- [x] Module `audit` : écriture avec chaîne de hachage (02 §9)
- [x] Seed : un SUPER_ADMIN, une institution de test
- [x] Angular : pages connexion / inscription, interceptor JWT, refresh automatique, guards de route
- [x] **Tests :** les 10 tests d'autorisation de 03 §8 (ceux qui concernent ce sprint), test « route sans décorateur = CI rouge »

**Démo :** un SUPER_ADMIN crée un INSTITUTION_ADMIN, qui active sa 2FA et se connecte.

---

## 5. Sprint 3 — Structure académique et vérification (semaines 6-7)

**Objectif :** un étudiant passe de « compte créé » à « inscription vérifiée ».

- [ ] Module `institutions` : CRUD facultés, filières, niveaux, années, groupes (INSTITUTION_ADMIN)
- [ ] Module `students` : profil, déclaration de l'inscription de l'année
- [ ] Module `storage` : upload vers MinIO/S3, contrôle MIME réel (pas seulement l'extension), taille max 5 Mo, nom généré par le serveur, URL signée de 5 minutes
- [ ] Module `verification` : file d'attente du vérificateur, consultation de l'attestation, validation / rejet avec motif
- [ ] Conflit d'intérêts : un vérificateur ne valide pas sa propre inscription (03 §6)
- [ ] Notifications simples dans l'application (validation, rejet)
- [ ] Angular : écrans admin (structure), écran étudiant (dépôt), écran vérificateur (file + document + décision)
- [ ] **Tests :** isolation entre institutions (404), upload d'un fichier malveillant renommé en `.pdf` refusé

**Démo :** un étudiant dépose son attestation, le vérificateur la valide, l'étudiant voit « Compte vérifié ».

---

## 6. Sprint 4 — Élections, éligibilité, candidatures (semaines 8-9)

**Objectif :** chaque étudiant voit exactement les élections qui le concernent.

- [ ] Module `elections` : création, positions, calendrier, statuts (02 §7)
- [ ] Attribution du comité ; contrôle **3 membres minimum** avant ouverture du vote (D-03)
- [ ] Module `eligibility` : règles (02 §5), calcul des éligibles, nombre d'éligibles affiché au comité
- [ ] « Mes élections » pour l'étudiant
- [ ] Module `candidates` : candidature (photo, programme), retrait, validation par le comité
- [ ] Règles : un seul poste par élection (D-05) ; membre du comité ≠ candidat (03 §6) ; candidat éligible
- [ ] Angular : création d'élection (formulaire en étapes), liste et page d'un candidat, écran de validation du comité
- [ ] **Tests :** les 5 exemples d'éligibilité de 02 §5 en tests automatisés
- [ ] **Écrire et relire 04-ELECTION-VOTING-FLOW avant la fin du sprint**

**Démo :** deux étudiants de groupes différents se connectent ; chacun voit des élections différentes. Un candidat est validé.

---

## 7. Sprint 5 — Vote (semaines 10-11)

**Objectif :** voter est sûr, unique et secret. **C'est le sprint le plus important.**

- [ ] Ouverture du vote : gel de `voter_roll` (02 §5), verrouillage des règles et candidats
- [ ] Module `voting` : transaction de vote exactement comme 02 §6.3
- [ ] Bulletins sans horodatage ni lien vers l'étudiant (02 §6.2)
- [ ] Filtrage des logs : le body de `POST /voting/:id/ballot` n'est jamais journalisé
- [ ] Clôture automatique à `votingEndsAt` (tâche planifiée `@nestjs/schedule`) + clôture manuelle (2FA)
- [ ] Taux de participation en direct pour le comité, en chiffres uniquement (D-02)
- [ ] Angular : bulletin (un poste par étape, vote blanc), écran de confirmation avant envoi, écran « Votre vote est enregistré »
- [ ] **Tests obligatoires :**
  - [ ] 50 requêtes de vote simultanées du même étudiant → exactement 1 bulletin
  - [ ] Vote avant ouverture, après clôture → refusé
  - [ ] Vote d'un étudiant absent de `voter_roll` → refusé
  - [ ] Candidat non validé, position d'une autre élection, trop de choix → refusé, rien n'est écrit
  - [ ] Erreur au milieu de la transaction → ni participation, ni bulletin
  - [ ] Aucune réponse API ne contient un `studentId` avec un choix (03 §8 test 9)
  - [ ] Invariant participants = bulletins après 1 000 votes simulés

**Démo :** 20 comptes de test votent ; le compteur de participation monte ; aucune table ne permet de savoir qui a voté pour qui.

---

## 8. Sprint 6 — Résultats et tableau de bord (semaines 12-13)

**Objectif :** une élection va jusqu'au bout, résultats publiés.

- [ ] Module `results` : décompte, contrôle de l'invariant, empreinte SHA-256 de l'urne (02 §8)
- [ ] Détection d'égalité → message au comité, création assistée du second tour (D-01)
- [ ] Publication des résultats (2FA), résultats par poste uniquement (D-12)
- [ ] Tableau de bord admin : élections en cours, participation, vérifications en attente
- [ ] Module `reports` : procès-verbal PDF simple (sans QR, ajouté en Phase 3)
- [ ] Consultation du journal d'audit + vérification de la chaîne
- [ ] Sauvegarde automatique de MySQL, **test de restauration**
- [ ] Revue de sécurité : relecture de 06-SECURITY, contrôle des dépendances (`npm audit`)

**Démo :** une élection complète, de la création au PDF du procès-verbal.

---

## 9. Pilote (semaines 14-15)

- [ ] Déploiement sur un serveur de test en HTTPS
- [ ] Une vraie élection avec 10 à 20 personnes (amis, camarades)
- [ ] Observer sans aider : où les gens bloquent-ils ?
- [ ] Questionnaire court après le vote
- [ ] Liste des corrections, classées : bloquant / important / confort
- [ ] Décision : prêt pour une institution pilote (A-01), ou un sprint de correction en plus

---

## 10. Définition de « terminé » (pour chaque sprint)

Un sprint est terminé seulement si :

1. la démo fonctionne avec `docker compose up` sur une machine propre ;
2. tous les tests passent en CI ;
3. chaque nouvel endpoint a une permission déclarée et apparaît dans Swagger ;
4. chaque texte de l'interface existe en arabe **et** en français ;
5. les actions sensibles écrivent dans `audit_logs` ;
6. les documents `docs/` sont à jour si une décision a changé.

---

## 11. Après le MVP (Phase 3)

| Fonctionnalité | Prérequis |
|---|---|
| OCR des attestations | POC comparatif de 3 moteurs sur de vrais documents arabes et français (D-14) |
| QR de vérification du procès-verbal | Module `reports` du Sprint 6 |
| Import de la base officielle des étudiants | Accord avec une institution |
| Protocole cryptographique de vote | Revue de sécurité dédiée (D-13) |
| Rôle observateur | — (D-09) |
| Application mobile | API stable |
| Notifications SMS / e-mail | Choix d'un fournisseur |

---

## 12. Risques principaux

| Risque | Effet | Parade |
|---|---|---|
| Le sprint Vote déborde | Retard global | 04 écrit en avance ; tests de concurrence écrits **avant** le code |
| L'interface RTL prend plus de temps que prévu | Retard du Sprint 1 | Bootstrap RTL + propriétés CSS logiques dès le départ |
| Aucune institution pilote | Pas de retour réel | Le pilote avec des camarades reste possible ; démarcher dès le Sprint 4 |
| Dépendance à une seule personne | Projet bloqué en cas d'absence | Documents à jour, README clair, CI automatique |
