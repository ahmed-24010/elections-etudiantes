# 01 --- Architecture technique

## Plateforme de gestion des élections étudiantes

**Version :** 1.0\
**Date :** 07/10/2026\
**Statut :** Architecture proposée --- à valider avant développement

------------------------------------------------------------------------

## 1. Objectif du projet

La plateforme est une application Web multi-institution permettant de
gérer le cycle complet des élections étudiantes :

1.  création et gestion des comptes étudiants ;
2.  vérification du statut et des informations académiques ;
3.  gestion des institutions, facultés, filières, niveaux et groupes ;
4.  création d'élections et définition des règles d'éligibilité ;
5.  dépôt et validation des candidatures ;
6.  vote électronique avec protection contre le vote multiple ;
7.  séparation technique entre l'identité du votant et son bulletin ;
8.  dépouillement et publication des résultats ;
9.  génération de procès-verbaux vérifiables ;
10. traçabilité des opérations administratives sensibles.

L'architecture doit permettre de commencer avec une seule institution
tout en étant capable d'évoluer vers plusieurs universités et instituts.

------------------------------------------------------------------------

# 2. Stack technique

## Frontend

-   Angular
-   TypeScript
-   RxJS
-   Angular Router
-   Reactive Forms
-   Angular HTTP Client
-   Bootstrap ou Angular Material
-   i18n arabe / français
-   Guards et interceptors

## Backend

-   Node.js
-   TypeScript
-   NestJS
-   REST API
-   DTO
-   class-validator
-   Swagger / OpenAPI
-   Jest
-   Supertest

## Base de données

-   MySQL
-   Prisma ORM
-   Prisma Migrate
-   Transactions SQL

## Fichiers

-   Storage S3-compatible
-   Les fichiers ne sont pas stockés directement dans MySQL.
-   La base conserve uniquement les métadonnées et références
    sécurisées.

## Authentification

-   Access token JWT
-   Refresh token
-   RBAC
-   2FA pour les comptes administratifs
-   Hashage sécurisé des mots de passe

## DevOps

-   Docker
-   Docker Compose pour le développement
-   Git
-   CI/CD
-   Variables d'environnement / secrets manager selon l'environnement

## OCR

L'OCR sera sélectionné après un POC comparant notamment :

-   qualité sur documents arabes ;
-   qualité sur documents français ;
-   tableaux et documents administratifs ;
-   taux d'erreur ;
-   coût ;
-   temps de traitement ;
-   possibilité d'auto-hébergement.

L'OCR est un composant d'assistance à la vérification et ne constitue
pas, à lui seul, la source officielle de vérité.

------------------------------------------------------------------------

# 3. Architecture globale

``` text
                         ┌──────────────────────────┐
                         │        Étudiant          │
                         │   Navigateur / Mobile    │
                         └────────────┬─────────────┘
                                      │ HTTPS
                                      ▼
                         ┌──────────────────────────┐
                         │     Angular Frontend     │
                         │                          │
                         │ Auth / Student / Voting  │
                         │ Admin / Elections / UI   │
                         └────────────┬─────────────┘
                                      │ REST / JSON
                                      ▼
                         ┌──────────────────────────┐
                         │      NestJS Backend      │
                         │                          │
                         │ Auth                     │
                         │ Students                 │
                         │ Verification             │
                         │ Institutions             │
                         │ Elections                │
                         │ Eligibility              │
                         │ Candidates               │
                         │ Voting                   │
                         │ Results                  │
                         │ Reports                  │
                         │ Audit                    │
                         └───────┬─────────┬────────┘
                                 │         │
                    ┌────────────┘         └─────────────┐
                    ▼                                    ▼
             ┌──────────────┐                    ┌──────────────┐
             │    Prisma    │                    │ S3 Storage   │
             │              │                    │              │
             │    MySQL     │                    │ Documents    │
             │              │                    │ Photos       │
             └──────────────┘                    │ Reports      │
                                                 └──────────────┘
                    │
                    ▼
             ┌──────────────┐
             │ OCR Service  │
             │  (Phase 2)  │
             └──────────────┘
```

------------------------------------------------------------------------

# 4. Principe d'architecture

Le backend sera organisé autour de modules métier indépendants.

``` text
Backend
│
├── auth
├── users
├── students
├── institutions
├── verification
├── elections
├── eligibility
├── candidates
├── voting
├── results
├── reports
├── audit
└── notifications
```

Chaque module doit contenir autant que possible :

``` text
module/
├── controller
├── service
├── dto
├── entities / models si nécessaire
├── guards / policies si nécessaire
└── tests
```

La logique métier ne doit pas être placée directement dans les
controllers.

Le controller reçoit et valide la requête, puis délègue au service.

------------------------------------------------------------------------

# 5. Architecture Frontend Angular

Structure recommandée :

``` text
src/app/
│
├── core/
│   ├── auth/
│   ├── guards/
│   ├── interceptors/
│   ├── services/
│   └── models/
│
├── shared/
│   ├── components/
│   ├── directives/
│   ├── pipes/
│   └── validators/
│
├── features/
│   ├── auth/
│   ├── student/
│   ├── verification/
│   ├── elections/
│   ├── candidates/
│   ├── voting/
│   ├── results/
│   └── admin/
│
├── layout/
│   ├── public/
│   ├── student/
│   └── admin/
│
└── app.routes.ts
```

## Règles frontend

-   Les guards protègent les routes, mais ne remplacent jamais
    l'autorisation backend.
-   Les permissions sont contrôlées côté serveur.
-   Les formulaires utilisent Reactive Forms.
-   Toutes les données provenant de l'utilisateur sont validées.
-   Les textes doivent être préparés pour l'arabe et le français.
-   L'interface doit être responsive.
-   Aucun secret backend ne doit être placé dans le frontend.

------------------------------------------------------------------------

# 6. Architecture Backend NestJS

Structure cible :

``` text
src/
│
├── main.ts
├── app.module.ts
│
├── auth/
├── users/
├── students/
├── institutions/
├── verification/
├── elections/
├── eligibility/
├── candidates/
├── voting/
├── results/
├── reports/
├── audit/
├── notifications/
│
├── common/
│   ├── guards/
│   ├── decorators/
│   ├── filters/
│   ├── interceptors/
│   ├── pipes/
│   └── exceptions/
│
└── config/
```

## Responsabilités

### Auth

-   inscription ;
-   connexion ;
-   refresh token ;
-   logout ;
-   récupération de compte ;
-   2FA administratif.

### Students

-   profil étudiant ;
-   informations académiques ;
-   statut de vérification.

### Institutions

-   institutions ;
-   facultés ;
-   départements ;
-   filières ;
-   niveaux ;
-   groupes ;
-   années universitaires.

### Verification

-   dépôt des documents ;
-   extraction OCR ;
-   vérification ;
-   approbation/rejet ;
-   historique.

### Elections

-   création ;
-   configuration ;
-   calendrier ;
-   statut ;
-   positions ;
-   règles.

### Eligibility

-   calcul des électeurs éligibles ;
-   vérification des règles ;
-   gestion des changements de statut.

### Candidates

-   candidature ;
-   documents ;
-   programme ;
-   validation ;
-   rejet.

### Voting

-   autorisation de vote ;
-   bulletin ;
-   contrôle du vote multiple ;
-   fermeture du scrutin.

### Results

-   dépouillement ;
-   statistiques ;
-   résultats ;
-   gagnants.

### Reports

-   procès-verbal ;
-   PDF ;
-   QR de vérification.

### Audit

-   opérations administratives sensibles ;
-   acteur ;
-   action ;
-   cible ;
-   date ;
-   résultat.

------------------------------------------------------------------------

# 7. Multi-institution

La plateforme doit être conçue comme un système multi-tenant logique.

``` text
Platform
│
├── Institution A
│   ├── Faculties
│   ├── Programs
│   ├── Students
│   └── Elections
│
└── Institution B
    ├── Faculties
    ├── Programs
    ├── Students
    └── Elections
```

Chaque ressource institutionnelle doit être rattachée à une institution.

Exemple :

``` text
institution_id
```

Les permissions backend doivent empêcher un administrateur de
l'institution A d'accéder aux données de l'institution B.

Le frontend ne doit jamais être considéré comme la protection de cette
isolation.

------------------------------------------------------------------------

# 8. Authentification et autorisation

## Authentification

``` text
Login
  ↓
Verify credentials
  ↓
Access Token + Refresh Token
  ↓
Authenticated request
```

## Autorisation

L'accès est contrôlé par :

``` text
User
 ↓
Role
 ↓
Permission
 ↓
Institution scope
 ↓
Resource
```

Exemple :

``` text
INSTITUTION_ADMIN
+
institution_id = A
```

peut gérer les élections de A mais pas celles de B.

------------------------------------------------------------------------

# 9. Rôles principaux

``` text
SUPER_ADMIN
INSTITUTION_ADMIN
ELECTION_COMMITTEE
VERIFICATION_OFFICER
STUDENT
```

## SUPER_ADMIN

Gestion globale de la plateforme.

## INSTITUTION_ADMIN

Gestion de son institution.

## ELECTION_COMMITTEE

Gestion des élections auxquelles elle est affectée.

## VERIFICATION_OFFICER

Vérification des étudiants et documents.

## STUDENT

Gestion de son profil, candidature et participation aux élections
autorisées.

Une matrice détaillée des permissions sera définie dans
`03-ROLES-PERMISSIONS.md`.

------------------------------------------------------------------------

# 10. Architecture du processus étudiant

``` text
Create account
      ↓
Login
      ↓
Student profile
      ↓
Upload registration certificate
      ↓
Document stored in S3
      ↓
Verification
      ↓
Official data comparison
      ↓
Approved / Rejected
      ↓
Student becomes eligible for elections according to rules
```

L'OCR peut être placé entre l'upload et la vérification :

``` text
Upload
  ↓
OCR
  ↓
Extracted data
  ↓
Comparison
  ↓
Human review if required
```

------------------------------------------------------------------------

# 11. Eligibility Engine

Les règles d'éligibilité sont des données configurables.

Exemple :

``` text
Election:
Président Groupe B

institution = X
faculty = Droit
program = Droit privé
level = L3
group = B
```

Le moteur vérifie :

``` text
Student
   ↓
Institution ?
   ↓
Faculty ?
   ↓
Program ?
   ↓
Level ?
   ↓
Group ?
   ↓
ELIGIBLE / NOT ELIGIBLE
```

Les règles ne doivent pas être codées en dur dans Angular ou dans un
controller.

------------------------------------------------------------------------

# 12. Architecture du vote

Le vote doit être conçu avec deux domaines logiques séparés :

``` text
A. Voter authorization
B. Anonymous ballot
```

### A --- Autorisation

Le système sait :

``` text
Student X
Election Y
Eligible = true
Already voted = false
```

Il autorise ensuite une opération de vote.

### B --- Bulletin

Le bulletin contient les informations nécessaires au dépouillement mais
ne doit pas contenir directement l'identité du votant.

``` text
Ballot
├── election_id
├── position_id
├── candidate_id
├── ballot_reference
└── created_at
```

La relation entre identité et choix doit être conçue pour empêcher une
reconstruction triviale du vote.

Une revue de sécurité spécifique devra être faite avant la mise en
production.

------------------------------------------------------------------------

# 13. Protection contre le vote multiple

Plusieurs protections sont nécessaires :

1.  contrôle applicatif ;
2.  contrainte unique en base ;
3.  transaction ;
4.  gestion de concurrence ;
5.  idempotence ;
6.  expiration de l'autorisation ;
7.  contrôle de l'état de l'élection.

Le système ne doit pas dépendre uniquement de :

``` text
if (hasVoted)
```

car deux requêtes concurrentes peuvent arriver simultanément.

------------------------------------------------------------------------

# 14. Storage

Les documents sont stockés dans un storage S3-compatible.

Exemple :

``` text
bucket/
├── registration-documents/
├── candidate-documents/
├── candidate-photos/
└── election-reports/
```

La base conserve :

``` text
file_id
storage_key
mime_type
size
checksum
uploaded_by
created_at
```

Les URLs publiques permanentes sont à éviter pour les documents
sensibles.

Le backend doit générer des accès temporaires ou servir les fichiers
après autorisation.

------------------------------------------------------------------------

# 15. Sécurité

La sécurité est une exigence fonctionnelle du projet.

## Backend

-   validation des DTO ;
-   authentification ;
-   RBAC ;
-   isolation institutionnelle ;
-   rate limiting ;
-   CORS configuré ;
-   headers de sécurité ;
-   gestion centralisée des erreurs ;
-   logs sécurisés ;
-   secrets hors du code source.

## Passwords

Les mots de passe doivent être hashés avec un algorithme moderne adapté
au stockage de mots de passe.

## Tokens

-   courte durée pour l'access token ;
-   refresh token sécurisé ;
-   rotation/révocation selon la stratégie retenue ;
-   stockage côté client avec une stratégie adaptée au contexte Web.

## Administration

2FA obligatoire ou fortement recommandé pour les rôles sensibles.

## Documents

-   validation MIME ;
-   limite de taille ;
-   extension contrôlée ;
-   nom de fichier généré par le serveur ;
-   antivirus/malware scanning lorsque disponible ;
-   stockage privé.

------------------------------------------------------------------------

# 16. Audit Log

Les opérations sensibles doivent être enregistrées.

Exemple :

``` text
actor_id
actor_role
institution_id
action
resource_type
resource_id
timestamp
result
ip_hash / réseau selon politique
metadata
```

Exemples d'actions :

``` text
STUDENT_APPROVED
STUDENT_REJECTED
ELECTION_CREATED
ELECTION_OPENED
ELECTION_CLOSED
CANDIDATE_APPROVED
CANDIDATE_REJECTED
ADMIN_ROLE_CHANGED
REPORT_GENERATED
```

Le choix du candidat par un étudiant ne doit pas être écrit dans un
audit log nominatif.

------------------------------------------------------------------------

# 17. Résultats

À la fermeture :

``` text
Election OPEN
      ↓
Close
      ↓
Freeze voting
      ↓
Count ballots
      ↓
Calculate statistics
      ↓
Finalize results
      ↓
Generate report
```

Statistiques :

-   nombre d'électeurs éligibles ;
-   nombre de participants ;
-   taux de participation ;
-   nombre de bulletins valides ;
-   résultats par candidat ;
-   éventuels bulletins invalides selon les règles de l'élection.

------------------------------------------------------------------------

# 18. Procès-verbal

Le backend pourra générer un PDF contenant :

-   institution ;
-   élection ;
-   période ;
-   nombre d'électeurs ;
-   nombre de participants ;
-   taux de participation ;
-   résultats ;
-   gagnants ;
-   identifiant unique du rapport ;
-   QR de vérification ;
-   hash/intégrité du document selon la stratégie retenue.

Le QR ne doit pas exposer de données personnelles sensibles.

------------------------------------------------------------------------

# 19. API

L'API sera REST.

Groupes principaux :

``` text
/api/v1/auth
/api/v1/users
/api/v1/students
/api/v1/institutions
/api/v1/verification
/api/v1/elections
/api/v1/eligibility
/api/v1/candidates
/api/v1/voting
/api/v1/results
/api/v1/reports
/api/v1/audit
```

Toutes les API protégées devront vérifier côté backend :

``` text
Authentication
Authorization
Institution scope
Input validation
Resource ownership/access
```

La documentation sera générée avec OpenAPI/Swagger.

------------------------------------------------------------------------

# 20. Environnements

Minimum :

``` text
development
staging
production
```

Exemple :

``` text
Developer
   ↓
Docker Compose
   ↓
Development

Git push
   ↓
CI
   ↓
Tests
   ↓
Staging
   ↓
Validation
   ↓
Production
```

Les secrets et bases de données doivent être séparés entre les
environnements.

------------------------------------------------------------------------

# 21. Docker

Pour le développement :

``` text
docker-compose.yml

services:
  mysql:
    image: mysql

  backend:
    build: ./backend

  frontend:
    build: ./frontend
```

Les versions exactes seront fixées dans le repository.

------------------------------------------------------------------------

# 22. Observabilité

Prévoir dès l'architecture :

-   logs structurés ;
-   correlation/request ID ;
-   erreurs backend ;
-   métriques ;
-   monitoring ;
-   alertes.

Attention à ne jamais écrire dans les logs :

-   mots de passe ;
-   tokens ;
-   documents sensibles ;
-   choix électoraux nominatifs ;
-   données personnelles inutiles.

------------------------------------------------------------------------

# 23. Tests

## Backend

``` text
Unit tests
Integration tests
E2E tests
```

Priorité élevée pour :

``` text
Authentication
Authorization
Eligibility
Voting
Duplicate vote
Election state
Results
```

## Frontend

Tester principalement :

``` text
Guards
Forms
Services
Critical components
Voting flow
```

------------------------------------------------------------------------

# 24. Principes de développement

1.  Le backend est toujours la source d'autorisation.
2.  Le frontend ne doit jamais être considéré comme une frontière de
    sécurité.
3.  Les règles d'éligibilité sont configurables.
4.  L'identité du votant et son choix sont séparés.
5.  Les opérations critiques utilisent des transactions.
6.  Les contraintes de base de données complètent les contrôles
    applicatifs.
7.  Aucun secret dans le frontend.
8.  Les documents sensibles restent privés.
9.  Les opérations administratives sensibles sont auditées.
10. Chaque fonctionnalité critique doit avoir des tests.
11. Les changements de schéma passent par des migrations Prisma.
12. Toute évolution du protocole de vote doit faire l'objet d'une revue
    de sécurité.

------------------------------------------------------------------------

# 25. Roadmap technique

## Phase 1 --- Architecture

-   [x] Choix de la stack
-   [ ] Architecture
-   [ ] Database schema
-   [ ] Roles & permissions
-   [ ] Election flow
-   [ ] Voting security design
-   [ ] API specification

## Phase 2 --- MVP

-   [ ] Docker
-   [ ] Angular project
-   [ ] NestJS project
-   [ ] MySQL
-   [ ] Prisma
-   [ ] Authentication
-   [ ] Students
-   [ ] Institutions
-   [ ] Verification
-   [ ] Elections
-   [ ] Eligibility
-   [ ] Candidates
-   [ ] Voting
-   [ ] Results
-   [ ] Dashboard

## Phase 3 --- Advanced

-   [ ] OCR
-   [ ] 2FA
-   [ ] Audit avancé
-   [ ] PDF
-   [ ] QR verification
-   [ ] Notifications
-   [ ] University API integration

## Phase 4 --- Scale

-   [ ] Multi-institution avancé
-   [ ] Mobile Android/iOS
-   [ ] Analytics
-   [ ] Advanced monitoring
-   [ ] Advanced election audit

------------------------------------------------------------------------

# 26. Prochaine étape obligatoire

Ne pas commencer le développement avant d'avoir validé les quatre
documents suivants :

``` text
01-ARCHITECTURE.md
02-DATABASE.md
03-ROLES-PERMISSIONS.md
04-ELECTION-VOTING-FLOW.md
```

Puis :

``` text
05-API.md
06-SECURITY.md
07-MVP-ROADMAP.md
```

**Prochaine étape immédiate : `02-DATABASE.md`.**

Il faudra concevoir l'ERD complet, les tables MySQL, les relations, les
clés étrangères, les contraintes uniques et surtout le modèle permettant
de garantir le vote unique et la séparation entre l'identité du votant
et son bulletin.
