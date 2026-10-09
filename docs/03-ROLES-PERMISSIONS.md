# 03 — Rôles et permissions

## Plateforme de gestion des élections étudiantes

**Version :** 1.0
**Date :** 08/10/2026
**Statut :** Proposition — à valider avant développement
**Dépend de :** `01-ARCHITECTURE.md`, `02-DATABASE.md` (table `role_assignments`)

---

## 1. Objectif

Ce document définit **qui peut faire quoi, sur quelles données**. Il sert de référence pour :

- les guards et policies NestJS ;
- les tests d'autorisation ;
- les écrans affichés à chaque rôle dans Angular (simple confort : la vraie protection reste le backend).

---

## 2. Principes

1. **Refus par défaut.** Toute action non explicitement autorisée est refusée.
2. **Le backend décide.** Angular masque des boutons, il ne protège rien.
3. **Rôle + portée.** Un rôle n'a de sens qu'avec sa portée (institution, élection). « INSTITUTION_ADMIN » seul ne donne aucun droit.
4. **Moindre privilège.** Chaque rôle a uniquement ce qu'il faut pour sa mission.
5. **Séparation des tâches.** Personne ne valide sa propre demande (inscription, candidature, rôle).
6. **Personne ne voit un vote.** Aucun rôle, y compris SUPER_ADMIN, n'a de permission permettant de relier un bulletin à un étudiant. Cette permission n'existe pas dans le système.
7. **Actions sensibles = 2FA + audit.** Les opérations qui changent le résultat ou le corps électoral exigent une 2FA récente et sont tracées dans `audit_logs`.

---

## 3. Les rôles

| Rôle | Mission | Portée | 2FA |
|---|---|---|---|
| **SUPER_ADMIN** | Exploite la plateforme : institutions, admins d'institution, supervision technique | Toute la plateforme | Obligatoire |
| **INSTITUTION_ADMIN** | Administre son institution : structure académique, personnel, élections | Une institution | Obligatoire |
| **VERIFICATION_OFFICER** | Vérifie les attestations et valide les inscriptions | Une institution | Obligatoire |
| **ELECTION_COMMITTEE** | Conduit une élection précise : candidatures, ouverture, clôture, résultats | Une élection | Obligatoire |
| **STUDENT** | Gère son profil, se porte candidat, vote | Lui-même, dans son institution | Optionnelle |

### Cumul de rôles

Un utilisateur peut avoir plusieurs rôles (`role_assignments`). Exemples courants :

- un étudiant membre du comité d'une élection : `STUDENT` + `ELECTION_COMMITTEE (élection X)` ;
- un agent administratif à la fois admin et vérificateur.

Les permissions s'additionnent, **sauf** les interdictions de conflit d'intérêts du §6, qui l'emportent toujours.

---

## 4. Portée : comment elle est vérifiée

Pour chaque requête, le backend détermine l'institution et, si besoin, l'élection **à partir de la ressource en base**, jamais à partir d'un paramètre envoyé par le client.

```text
Requête : POST /elections/:id/open
   │
   ▼
1. Authentifié ?                          sinon 401
2. Charger l'élection :id                 sinon 404
3. Rôle + portée correspondante ?
     SUPER_ADMIN                          → non (voir matrice)
     INSTITUTION_ADMIN de election.institutionId
     ELECTION_COMMITTEE de election.id
                                          sinon 403
4. Conflit d'intérêts ?                   sinon 403
5. 2FA récente (action sensible) ?        sinon 401 + demande 2FA
6. État de la ressource compatible ?      sinon 409
   (ex. statut CANDIDACY_CLOSED)
7. Exécuter + écrire audit_logs
```

**Règle anti-fuite :** une ressource d'une autre institution renvoie **404**, pas 403, pour ne pas révéler son existence.

---

## 5. Matrice des permissions

Légende :

| Symbole | Signification |
|---|---|
| ✅ | Autorisé dans sa portée |
| 👤 | Autorisé uniquement sur ses propres données |
| 🔐 | Autorisé, avec 2FA récente et audit |
| — | Interdit |

Colonnes : **SA** = SUPER_ADMIN, **IA** = INSTITUTION_ADMIN, **VO** = VERIFICATION_OFFICER, **EC** = ELECTION_COMMITTEE, **ST** = STUDENT.

### 5.1 Plateforme et institutions

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `institution:create` | 🔐 | — | — | — | — |
| `institution:update` | 🔐 | ✅ | — | — | — |
| `institution:deactivate` | 🔐 | — | — | — | — |
| `institution:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `academic:manage` (facultés, filières, niveaux, années, groupes) | — | ✅ | — | — | — |
| `academic:read` | ✅ | ✅ | ✅ | ✅ | ✅ |

**Pourquoi SA ne gère pas la structure académique :** c'est la responsabilité de l'institution. SA crée l'institution et son premier admin, puis n'intervient plus sur le contenu.

### 5.2 Utilisateurs et rôles

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `role:assign:INSTITUTION_ADMIN` | 🔐 | — | — | — | — |
| `role:assign:VERIFICATION_OFFICER` | — | 🔐 | — | — | — |
| `role:assign:ELECTION_COMMITTEE` | — | 🔐 | — | — | — |
| `role:revoke` (rôles qu'il peut attribuer) | 🔐 | 🔐 | — | — | — |
| `user:read` (liste du personnel) | ✅ | ✅ | — | — | — |
| `user:suspend` | 🔐 | 🔐 | — | — | — |
| `user:update:self` (mot de passe, téléphone, 2FA) | 👤 | 👤 | 👤 | 👤 | 👤 |

Règles :

- personne ne s'attribue un rôle à lui-même ;
- personne ne révoque son propre rôle d'admin si c'est le dernier admin de l'institution ;
- SA ne peut pas suspendre le dernier SA.

### 5.3 Étudiants et vérification

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `student:register` (créer son compte) | — | — | — | — | 👤 |
| `student:read` (profil complet) | — | ✅ | ✅ | — | 👤 |
| `student:read:minimal` (nom, filière) | — | ✅ | ✅ | ✅ | — |
| `enrollment:create` (déclarer son inscription de l'année) | — | — | — | — | 👤 |
| `document:upload` | — | — | — | — | 👤 |
| `document:read` (attestation) | — | — | ✅ | — | 👤 |
| `enrollment:review` (valider / rejeter) | — | — | 🔐 | — | — |
| `enrollment:expire` (fin d'année, en masse) | — | 🔐 | — | — | — |
| `student:import` (fichier officiel, Phase 2) | — | 🔐 | — | — | — |

Règles :

- **IA ne valide pas les inscriptions** et ne lit pas les attestations : c'est le travail du vérificateur. Cela limite le nombre de personnes qui voient les documents personnels.
- Le comité voit seulement le minimum nécessaire (candidats, liste électorale nominative si la loi locale l'exige — décision ouverte §9).
- Une inscription `VERIFIED` ne peut plus être modifiée par l'étudiant. Une correction passe par un nouveau dépôt et une nouvelle vérification.

### 5.4 Élections

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `election:create` | — | ✅ | — | — | — |
| `election:update` (en `DRAFT`) | — | ✅ | — | ✅ | — |
| `election:rules:manage` (éligibilité, positions) | — | ✅ | — | ✅ | — |
| `election:candidacy:open` / `close` | — | ✅ | — | ✅ | — |
| `election:voting:open` (gèle la liste électorale) | — | 🔐 | — | 🔐 | — |
| `election:voting:close` (manuel, anticipé) | — | 🔐 | — | 🔐 | — |
| `election:cancel` | — | 🔐 | — | — | — |
| `election:read` (détails) | ✅ | ✅ | — | ✅ | ✅ * |
| `election:list:mine` (« mes élections ») | — | — | — | — | 👤 |
| `voter_roll:add` (ajout exceptionnel après gel) | — | — | — | 🔐 | — |
| `voter_roll:read:count` | ✅ | ✅ | — | ✅ | ✅ * |
| `turnout:read` (taux de participation en cours) | — | ✅ | — | ✅ | — |

\* Un étudiant ne voit que les élections pour lesquelles il est sur la liste électorale, ou éligible si la liste n'est pas encore gelée.

Règles :

- La clôture **automatique** à `votingEndsAt` est faite par le système, sans utilisateur. Elle est auditée avec `actorId = null` et `action = ELECTION_AUTO_CLOSED`.
- Après `VOTING_OPEN`, les règles, positions et candidats sont figés pour tout le monde, y compris IA.
- `election:cancel` est réservé à IA : le comité ne peut pas annuler sa propre élection.

### 5.5 Candidatures

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `candidate:apply` | — | — | — | — | 👤 |
| `candidate:withdraw` (avant le vote) | — | — | — | — | 👤 |
| `candidate:update` (programme, photo, avant validation) | — | — | — | — | 👤 |
| `candidate:review` (valider / rejeter) | — | — | — | 🔐 | — |
| `candidate:add` (saisie directe par le comité) | — | — | — | 🔐 | — |
| `candidate:read:approved` (liste publique) | ✅ | ✅ | ✅ | ✅ | ✅ * |
| `candidate:read:all` (y compris rejetés, motifs) | — | ✅ | — | ✅ | 👤 |

\* Pour les élections qu'il peut voir.

Conditions pour `candidate:apply` : élection en `CANDIDACY_OPEN`, étudiant éligible à cette élection, inscription `VERIFIED`.

### 5.6 Vote

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `ballot:cast` | — | — | — | — | 👤 |
| `participation:read:self` (« j'ai voté ») | — | — | — | — | 👤 |
| `participation:read:list` (qui a voté, nominatif) | — | — | — | — | — |
| `ballot:read` (contenu d'un bulletin) | — | — | — | — | — |

Les deux dernières lignes sont **interdites à tous** et n'ont pas d'endpoint.

- **Qui a voté, nominativement** : non exposé au MVP. Ce serait une pression sur les électeurs (« tu n'as pas voté »). Le comité ne voit que des **chiffres**. Si un règlement local impose une liste d'émargement, cela se décidera explicitement (§9).
- **`ballot:cast`** suppose : être sur `voter_roll`, élection `VOTING_OPEN`, dans la fenêtre horaire, pas encore voté. Le contrôle est fait dans la transaction décrite dans `02-DATABASE.md` §6.3.

Un membre du comité qui est aussi étudiant inscrit **vote normalement** avec son rôle STUDENT.

### 5.7 Résultats et procès-verbaux

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `results:compute` (décompte après clôture) | — | — | — | 🔐 | — |
| `results:read` (avant publication) | — | ✅ | — | ✅ | — |
| `results:publish` | — | 🔐 | — | 🔐 | — |
| `results:read:published` | ✅ | ✅ | ✅ | ✅ | ✅ * |
| `report:generate` (PDF + QR) | — | 🔐 | — | 🔐 | — |
| `report:revoke` | — | 🔐 | — | — | — |
| `report:verify` (page publique du QR) | Public, sans compte | | | | |

\* Pour les élections qu'il peut voir.

Il n'existe **aucune** permission pour modifier des résultats. En cas d'erreur, la seule voie est `election:cancel` suivie d'une nouvelle élection.

### 5.8 Audit et supervision

| Permission | SA | IA | VO | EC | ST |
|---|:-:|:-:|:-:|:-:|:-:|
| `audit:read` (son institution) | — | ✅ | — | — | — |
| `audit:read:election` (son élection) | — | ✅ | — | ✅ | — |
| `audit:read:platform` | ✅ | — | — | — | — |
| `audit:verify_chain` (contrôle d'intégrité) | ✅ | ✅ | — | — | — |
| `audit:write` / `update` / `delete` | — | — | — | — | — |

L'écriture dans le journal est faite uniquement par le système.

---

## 6. Conflits d'intérêts

Ces règles s'appliquent **en plus** de la matrice, et l'emportent sur tout cumul de rôles.

| Situation | Règle |
|---|---|
| Vérificateur qui est aussi étudiant | Ne peut pas valider **sa propre** inscription |
| Membre du comité qui se porte candidat | **Interdit** dans la même élection. Il doit d'abord quitter le comité (révocation auditée) |
| Candidat qui est membre du comité d'une autre élection | Autorisé |
| Membre du comité | Ne peut pas valider ou rejeter la candidature d'un proche déclaré (déclaration manuelle, Phase 2) |
| Admin d'institution | Ne peut pas s'attribuer lui-même un rôle |
| Toute personne | Ne peut pas valider une demande qu'elle a créée |

Recommandation : un comité d'au moins **3 membres** par élection, pour qu'une personne absente ou en conflit ne bloque pas le processus.

---

## 7. Implémentation NestJS

### 7.1 Permissions déclarées dans le code, rôles en base

Les **rôles et portées** sont en base (`role_assignments`). La **correspondance rôle → permissions** est dans le code, dans un fichier unique et testé. Elle change rarement et doit passer par une revue de code, pas par un écran d'administration.

```ts
// src/common/authz/permissions.ts
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ['institution:create', 'institution:update', /* … */],
  INSTITUTION_ADMIN: ['academic:manage', 'election:create', /* … */],
  VERIFICATION_OFFICER: ['document:read', 'enrollment:review', /* … */],
  ELECTION_COMMITTEE: ['candidate:review', 'election:voting:open', /* … */],
  STUDENT: ['enrollment:create', 'candidate:apply', 'ballot:cast', /* … */],
};

export const SENSITIVE: Permission[] = [
  'enrollment:review', 'election:voting:open', 'results:publish', /* … */
];
```

### 7.2 Utilisation dans un controller

```ts
@Post(':id/open')
@RequirePermission('election:voting:open')
@ScopeFrom('election', 'id') // la portée vient de l'élection en base
open(@Param('id') id: string, @CurrentUser() user: AuthUser) {
  return this.elections.openVoting(id, user);
}
```

### 7.3 Composants

| Composant | Rôle |
|---|---|
| `JwtAuthGuard` | Vérifie le token, charge l'utilisateur et ses rôles actifs |
| `PermissionGuard` | Lit `@RequirePermission`, charge la ressource, vérifie rôle + portée |
| `ConflictPolicy` | Applique les règles du §6 |
| `StepUpGuard` | Exige une 2FA de moins de 10 minutes pour les permissions sensibles |
| `AuditInterceptor` | Écrit `audit_logs` pour les permissions sensibles, en succès comme en refus |

Les contrôles d'**état** (statut de l'élection, fenêtre horaire) restent dans les services métier, pas dans les guards.

### 7.4 Contenu du JWT

Le token d'accès contient seulement `sub` (userId) et une version de session. Les rôles sont relus à chaque requête (ou mis en cache quelques secondes). Ainsi, **une révocation de rôle est effective immédiatement**, sans attendre l'expiration du token.

---

## 8. Tests d'autorisation obligatoires

Ces tests sont écrits avant ou avec chaque module, et bloquent la CI s'ils échouent.

1. Chaque endpoint protégé renvoie 401 sans token.
2. Un INSTITUTION_ADMIN de A reçoit **404** sur toute ressource de B.
3. Un membre du comité de l'élection X reçoit 403 sur l'élection Y.
4. Un étudiant ne voit pas une élection pour laquelle il n'est pas éligible.
5. Un vérificateur ne peut pas valider sa propre inscription.
6. Un membre du comité ne peut pas candidater dans son élection.
7. Une action sensible sans 2FA récente est refusée.
8. Une révocation de rôle prend effet à la requête suivante.
9. Aucun endpoint ne renvoie `studentId` avec un choix de vote (test sur toutes les réponses de `/voting` et `/results`).
10. Un **test de couverture** vérifie que chaque route du controller porte un `@RequirePermission` ou un `@Public` explicite. Une route sans décorateur fait échouer la CI.

---

## 9. Décisions prises (voir 00-DECISIONS.md)

| Réf. | Décision | Effet |
|---|---|---|
| D-02 | Le comité voit **uniquement des chiffres** : ni liste électorale nominative, ni liste d'émargement | Pas d'endpoint nominatif. Un étudiant qui conteste son absence de la liste s'adresse au vérificateur, qui contrôle son inscription. |
| D-03 | **3 membres minimum** dans le comité pour ouvrir le vote | Contrôle bloquant dans `election:voting:open` (HTTP 409 sinon) |
| D-09 | Pas de rôle OBSERVER au MVP | Ajout possible plus tard sans changer le modèle |
| D-10 | 2FA optionnelle pour les étudiants, obligatoire pour tous les rôles administratifs | `StepUpGuard` |
| D-11 | Aucune connexion « en tant que » un autre utilisateur | Fonction jamais développée |

Conséquence de D-02 : dans la matrice §5.3, `student:read:minimal` pour le comité se limite aux **candidats** de son élection.

---

## 10. Prochaine étape

`04-ELECTION-VOTING-FLOW.md` : déroulé complet d'une élection, de sa création au procès-verbal, avec la revue de sécurité du vote et les scénarios d'incident (panne pendant le vote, erreur de liste électorale, égalité de voix).
