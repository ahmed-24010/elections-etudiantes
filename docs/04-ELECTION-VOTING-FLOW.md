# 04 — Déroulé d'une élection et vote secret

## Plateforme de gestion des élections étudiantes

**Version :** 1.0
**Date :** 11/10/2026
**Statut :** Validé (15/10/2026) — décisions A-06 à A-12 enregistrées comme D-30 à D-36
**Dépend de :** `00-DECISIONS.md`, `02-DATABASE.md` (§5, §6, §7, §8), `03-ROLES-PERMISSIONS.md` (§5.4 à §5.7)

---

## 1. Objectif

Ce document décrit, étape par étape, la vie d'une élection : de sa création jusqu'à la publication des résultats. Il fixe aussi :

- les **conditions** à remplir avant chaque changement d'état ;
- le **déroulé exact du vote** côté étudiant et côté serveur ;
- les **mesures qui protègent le secret du vote**, et leurs limites ;
- la **conduite à tenir en cas d'incident** ;
- les **tests obligatoires** du Sprint 5.

Ce document est validé : le Sprint 5 peut commencer.

---

## 2. Vue d'ensemble

```text
DRAFT ──► CANDIDACY_OPEN ──► CANDIDACY_CLOSED ──► VOTING_OPEN ──► VOTING_CLOSED ──► RESULTS_PUBLISHED
  │             │                   │                  │                │
  └─────────────┴───────────────────┴──────────────────┴────────────────┴──► CANCELLED
```

| État | Ce qui se passe | Qui agit |
|---|---|---|
| `DRAFT` | L'élection est préparée : postes, règles d'éligibilité, calendrier, comité | Admin d'institution, comité |
| `CANDIDACY_OPEN` | Les étudiants éligibles déposent leur candidature | Étudiants, comité |
| `CANDIDACY_CLOSED` | Le comité termine l'examen des candidatures | Comité |
| `VOTING_OPEN` | La liste électorale est figée, les électeurs votent | Étudiants |
| `VOTING_CLOSED` | Plus aucun vote. Décompte et contrôle d'intégrité | Système, comité |
| `RESULTS_PUBLISHED` | Résultats visibles, procès-verbal généré | Comité |
| `CANCELLED` | Élection annulée, avec motif obligatoire | Admin d'institution uniquement |

Aucun retour en arrière n'est possible, sauf l'annulation.

---

## 3. Exemple concret

> **Bureau du groupe 1 — L3 Droit public — FSJP — 2026-2027**
> Postes : Président (1 siège), Vice-président (1 siège).
> Règle d'éligibilité : filière Droit public, niveau L3, groupe 1.

| Date | Événement |
|---|---|
| 1er octobre | L'admin crée l'élection (`DRAFT`) et nomme 3 membres du comité |
| 3 octobre | Ouverture des candidatures (`CANDIDACY_OPEN`) |
| 10 octobre, 23 h 59 | Clôture des candidatures (`CANDIDACY_CLOSED`) |
| 11 au 13 octobre | Le comité examine les candidatures |
| 15 octobre, 8 h 00 | Ouverture automatique du vote (`VOTING_OPEN`), gel de la liste électorale |
| 15 octobre, 18 h 00 | Clôture automatique (`VOTING_CLOSED`) et décompte |
| 15 octobre, 18 h 30 | Le comité publie les résultats (`RESULTS_PUBLISHED`) |

---

## 4. Les transitions et leurs conditions

Chaque transition est faite dans une **transaction**, vérifie l'état de départ (verrou sur la ligne de l'élection) et écrit une ligne dans `audit_logs`. Si une condition manque, la transition est refusée (HTTP 409) avec la liste des conditions non remplies.

### 4.1 `DRAFT` → `CANDIDACY_OPEN`

Qui : admin d'institution ou comité.

Conditions :

1. au moins **un poste** ;
2. au moins **une règle d'éligibilité** (« toute l'institution » est une règle explicite, jamais un oubli) ;
3. **3 membres du comité minimum** (D-03), actifs ;
4. calendrier cohérent : `candidacyStartsAt < candidacyEndsAt ≤ votingStartsAt < votingEndsAt` ;
5. nombre d'éligibles calculé > 0 (sinon l'élection ne concerne personne).

Effet : les étudiants éligibles voient l'élection dans « Mes élections » et peuvent se porter candidats.

### 4.2 `CANDIDACY_OPEN` → `CANDIDACY_CLOSED`

Qui : automatique à `candidacyEndsAt`, ou manuel par le comité.

Effet : plus de nouveau dépôt ni de retrait. Le comité termine l'examen.

### 4.3 `CANDIDACY_CLOSED` → `VOTING_OPEN` (étape sensible)

Qui : **automatique** à `votingStartsAt`, ou manuel par le comité (🔐 2FA récente).

Conditions :

1. **aucune candidature en attente** (`PENDING`) : toutes sont validées ou rejetées ;
2. chaque poste a **au moins un candidat validé**. Un poste sans candidat bloque l'ouverture : le comité doit supprimer le poste ou rouvrir un nouveau scrutin ;
3. **3 membres du comité** toujours actifs (D-03) ;
4. heure actuelle (heure de la **base**) ≥ `votingStartsAt`.

Si une condition manque à l'heure prévue, l'ouverture automatique **n'a pas lieu**, et le comité est notifié.

Effet, dans **une seule transaction** :

1. calcul de la liste des éligibles (requête de `02-DATABASE.md` §5) ;
2. copie dans `voter_roll` ;
3. `elections.voterRollFrozenAt = NOW()` ;
4. statut `VOTING_OPEN` ;
5. **verrouillage** des règles, des postes et des candidats : plus aucune modification possible.

### 4.4 `VOTING_OPEN` → `VOTING_CLOSED`

Qui : **automatique** à `votingEndsAt` (tâche planifiée), ou manuel anticipé par le comité (🔐) avec motif obligatoire.

Effet : à partir de cet instant, toute transaction de vote échoue (le contrôle d'état se fait **dans** la transaction de vote, voir §6.2). Le décompte (§8) est lancé immédiatement.

### 4.5 `VOTING_CLOSED` → `RESULTS_PUBLISHED`

Qui : **comité seulement** (🔐, D-41). L'administrateur d'institution lit les résultats et peut regénérer le procès-verbal, mais ne publie pas.

Conditions : le décompte existe, `election_tallies.integrityOk = true` (votants = bulletins, votants ≤ inscrits) et la chaîne d'audit est intègre. Sinon la publication est refusée (409) avec la liste des conditions manquantes.

Effet : résultats visibles par tous les éligibles ; génération du procès-verbal en **deux versions, arabe et français** (D-42).

### 4.6 Annulation

Qui : admin d'institution uniquement (🔐), motif obligatoire.

Possible depuis n'importe quel état sauf `RESULTS_PUBLISHED`. Après publication, une élection ne s'annule pas : elle se conteste par une nouvelle élection, décidée hors plateforme.

En `VOTING_OPEN` ou `VOTING_CLOSED`, l'annulation **ne supprime rien** : l'urne et la participation restent en base, figées, pour l'audit.

---

## 5. La liste électorale

### 5.1 Gel à l'ouverture du vote

La liste est **calculée une seule fois**, à l'ouverture (§4.3). Après le gel :

- un étudiant vérifié **après** l'ouverture **ne peut pas** voter à cette élection ;
- un étudiant dont l'inscription est modifiée après le gel garde son droit de vote, car le gel protège contre un retrait silencieux.

Avant l'ouverture, l'interface prévient les étudiants : « Faites vérifier votre inscription avant le 15 octobre à 8 h pour pouvoir voter. »

### 5.2 Ajout exceptionnel après le gel

Cas : un étudiant éligible a été oublié (par exemple, vérification faite en retard par erreur de la scolarité).

- Permission `voter_roll:add`, comité uniquement, 🔐.
- Le comité désigne l'étudiant par son **matricule** ; la confirmation montre faculté, filière, niveau et groupe, jamais le nom. Le compte doit être actif, l'inscription `VERIFIED` et l'étudiant éligible ; tout refus est identique pour ne pas révéler si le matricule existe (D-39).
- Motif obligatoire, écrit dans `audit_logs`.
- Possible seulement pendant `VOTING_OPEN`.
- Le nombre d'électeurs du procès-verbal inclut ces ajouts, et le procès-verbal indique leur nombre.

### 5.3 Pas de retrait après le gel

On ne retire **jamais** un électeur de la liste après le gel. S'il a déjà voté, son bulletin est anonyme et ne peut pas être retiré de l'urne. Voir l'incident §10.3.

---

## 6. Le vote

### 6.1 Côté étudiant

1. Dans « Mes élections », l'élection affiche **« Voter »** (seulement si `VOTING_OPEN`, s'il est sur la liste et s'il n'a pas encore voté).
2. **Bulletin**, un poste par étape :
   - les candidats validés, avec photo et lien vers le programme ;
   - l'ordre des candidats est **aléatoire pour chaque électeur**, pour ne favoriser personne ;
   - l'option **« Vote blanc »** si le poste l'autorise ;
   - si `maxChoices > 1`, cases à cocher avec le nombre maximal affiché.
3. **Récapitulatif** : tous les choix, avec « Modifier » pour revenir à un poste.
4. **Confirmation** : « Votre vote est définitif. Vous ne pourrez plus le modifier. » L'étudiant **ressaisit son mot de passe** (voir décision §12, A-06).
5. Envoi.
6. Écran final : **« Votre vote a bien été enregistré. »**, avec l'heure. Aucun numéro de bulletin, aucun rappel des choix.

Pourquoi aucun reçu montrant les choix ? Un reçu permettrait à quelqu'un de **forcer ou d'acheter** un vote (« montre-moi ton reçu »). L'étudiant peut seulement prouver **qu'il a voté**, jamais **pour qui**.

Après le vote, l'élection affiche « Vous avez voté » pour cet étudiant, et plus jamais le bulletin.

### 6.2 Côté serveur : la transaction de vote

Endpoint : `POST /api/v1/voting/:electionId/ballot`. Permission `ballot:cast`.

Le corps contient : `{ choices: [{ positionId, candidateIds[] }], password }`. `candidateIds` vide = vote blanc. `password` est le mot de passe de l'étudiant, ressaisi à la confirmation (D-30).

**Avant la transaction** (donc avant toute écriture dans l'urne) :

- le mot de passe est vérifié ; un échec renvoie `401 INVALID_PASSWORD` ;
- chaque échec compte dans le blocage du compte (5 échecs en 15 minutes, comme à la connexion) ; compte bloqué : `429` ;
- le mot de passe n'est **jamais** journalisé, comme le reste du corps (CLAUDE.md, règle 5).

Les erreurs gardent la convention actuelle : le code (`ELECTION_NOT_OPEN`, `ALREADY_VOTED`…) est dans le champ `message`.

Routes associées : `POST /elections/:id/voting/open` et `/close` (comité, 🔐), `GET /voting/:id/status` (état de l'étudiant lui-même), `GET /results/:id`, `GET /results/:id/second-round`, `POST /elections/:id/results/publish` (🔐). Le décompte (§8) est **automatique** à la clôture ; `POST /results/:id/compute` sert seulement à le **relancer** (idempotent, comité, 🔐).

```text
BEGIN (isolation READ COMMITTED)
 1. SELECT l'élection FOR SHARE
      - status = 'VOTING_OPEN'
      - NOW() de la base entre votingStartsAt et votingEndsAt
      sinon → ROLLBACK, 409 ELECTION_NOT_OPEN
 2. Vérifier voter_roll (electionId, studentId)
      sinon → ROLLBACK, 403 NOT_ON_VOTER_ROLL
 3. Valider le bulletin AVANT toute écriture :
      - chaque poste de l'élection apparaît exactement une fois
      - chaque candidat est APPROVED et appartient à ce poste
      - 0 ≤ nombre de choix ≤ maxChoices, sans doublon
      - 0 choix seulement si allowBlank
      sinon → ROLLBACK, 422 INVALID_BALLOT
 4. INSERT voting_participations (electionId, studentId)
      clé primaire déjà prise → ROLLBACK, 409 ALREADY_VOTED
 5. INSERT ballots (id = UUID v4 aléatoire, electionId)
 6. INSERT ballot_choices (id = UUID v4, ballotId, positionId, candidateId | NULL)
COMMIT → 201 { "status": "recorded" }
```

Points essentiels :

- **Le vote unique** repose sur la clé primaire de `voting_participations`, pas sur une vérification préalable.
- **Tout ou rien** : si une étape échoue, ni participation ni bulletin.
- **La réponse ne contient aucun identifiant** de bulletin.
- L'heure de référence est **toujours celle de la base**, jamais celle du serveur ou du navigateur.
- Un vote blanc s'enregistre comme une ligne `ballot_choices` avec `candidateId = NULL`.

### 6.3 Double clic et requêtes simultanées

Le bouton d'envoi est désactivé après le premier clic. Mais la vraie protection est en base : 50 requêtes simultanées du même étudiant produisent **exactement une** participation et **un** bulletin. Les 49 autres reçoivent `409 ALREADY_VOTED`. L'interface traite ce 409 comme « Votre vote a déjà été enregistré ».

---

## 7. Protection du secret du vote

### 7.1 Règles techniques (rappel de 02 §6.2 et de CLAUDE.md)

| Règle | Raison |
|---|---|
| `ballots` et `ballot_choices` : aucune colonne d'identité, aucune date | Rien à relier |
| Identifiants UUID v4 aléatoires | L'ordre d'insertion ne se devine pas |
| Aucune relation entre `voting_participations` et `ballots` | Pas de jointure possible |
| Le corps de `POST /voting/.../ballot` n'est **jamais** journalisé | Les logs ne relient pas l'utilisateur et ses choix |
| Aucun choix de vote dans `audit_logs` | Idem |
| `app_readonly` n'a pas accès aux tables de l'urne | Les rapports et le support ne voient pas l'urne |
| `app_runtime` : seulement `INSERT` et `SELECT` sur l'urne | Personne ne modifie ni ne supprime un bulletin via l'application |

### 7.2 Règles pendant le vote

1. **Aucun résultat partiel**, pour personne, y compris le super-admin. Les endpoints de résultats refusent tant que l'élection n'est pas `VOTING_CLOSED`. Il n'existe aucune requête applicative qui compte les bulletins par candidat avant la clôture.
2. **Participation** : le comité voit seulement « X votants sur Y inscrits » (D-02).
   - Pour les élections de **moins de 50 électeurs**, ce chiffre est mis à jour **par tranches de 15 minutes**, pour qu'on ne puisse pas déduire « Ahmed vient d'entrer dans la salle, le compteur a bougé ».
3. **Pas de liste nominative** de votants (D-02).
4. Le journal applicatif ne contient, pour un vote, que : l'élection, le résultat (succès ou code d'erreur), le request-id. **Pas** l'identifiant de l'étudiant dans la même ligne que la mention du vote. L'identifiant de l'étudiant est déjà connu par `voting_participations`, il est inutile de le répéter dans les logs.

### 7.3 Règles après le vote

1. Résultats publiés **par poste uniquement** (D-12). Jamais de ventilation par groupe, niveau ou filière à l'intérieur d'une élection.
2. Si un poste a **moins de 3 votants**, les résultats de ce poste ne sont pas publiés en détail : seuls l'élu et la mention « effectif trop faible pour publier le détail » apparaissent. Avec 2 votants, chacun saurait pour qui l'autre a voté.

### 7.4 Modèle de menace

| Qui | Peut-il savoir pour qui X a voté ? | Protection |
|---|---|---|
| Comité, admin, vérificateur, super-admin (via l'application) | **Non** | Aucune fonction ne relie identité et bulletin |
| Personne qui lit les tables de production | **Non** | Pas de colonne ni de lien (§7.1) |
| Administrateur MySQL avec accès au **binlog** ou aux journaux de requêtes | **Potentiellement oui** | Limite connue (D-13) : general_log désactivé, binlog à rétention courte, accès SQL nominatif limité à 2 personnes et tracé |
| Opérateur du serveur pendant le vote (mémoire, trafic interne) | **Potentiellement oui** | Même limite. Un protocole cryptographique supprimerait ce risque : prévu après le MVP |
| Attaquant sur le réseau | **Non** | HTTPS obligatoire |
| Quelqu'un qui force l'étudiant à montrer son vote | **Non** | Aucun reçu des choix (§6.1) |

### 7.5 Vol de compte

Le risque le plus réaliste n'est pas technique : c'est quelqu'un qui connaît le mot de passe d'un étudiant et **vote à sa place**.

Protections :

- ressaisie du mot de passe à la confirmation du vote (décision A-06, §12) ;
- limitation des tentatives de connexion (Sprint 2) ;
- après le vote, notification à l'étudiant : « Un vote a été enregistré pour vous dans l'élection X. Si ce n'est pas vous, contactez le comité. » ;
- 2FA proposée aux étudiants (D-10), recommandée aux candidats.

Si un étudiant signale un vote frauduleux : son bulletin **ne peut pas être retrouvé ni retiré**, par conception. Le comité consigne l'incident. Si plusieurs cas sont signalés, le comité peut demander l'annulation (§10.4).

---

## 8. Clôture et décompte

Lancé automatiquement à la clôture, dans une transaction :

1. compter `voter_roll` (inscrits), `voting_participations` (votants) et `ballots` (bulletins) ;
2. **contrôle d'intégrité** : votants = bulletins, et votants ≤ inscrits ;
3. calculer l'**empreinte** SHA-256 de l'urne : liste triée de tous les bulletins avec leurs choix ;
4. compter les voix par poste et par candidat, plus les blancs ;
5. classer et désigner les élus selon `seats` ;
6. détecter les **égalités** pour le dernier siège ;
7. écrire `election_tallies` et `position_results`.

Le décompte est **idempotent** : s'il est relancé, il recalcule à l'identique et ne crée pas de doublon.

Si l'intégrité échoue : `integrityOk = false`, **aucune publication possible**, alerte au comité et à l'admin (§10.2).

### Égalité

Si deux candidats ou plus sont à égalité pour le dernier siège d'un poste (D-01) :

- les autres postes peuvent être publiés normalement ;
- pour ce poste, le résultat indique « égalité » ;
- le comité crée un **second tour** (D-46) : nouvelle élection liée (`parentElectionId`, `round = 2`), même liste électorale (copiée à l'ouverture du vote, ajouts exceptionnels compris), seulement les candidats à égalité sur les seuls postes en égalité, mêmes règles et même comité, photos et programmes copiés. L'élection est créée directement en `CANDIDACY_CLOSED` (pas de nouvelle phase de candidatures) ; le comité confirme seulement les nouvelles dates du vote, puis le vote s'ouvre comme pour toute élection (à l'heure prévue ou à la main). Un seul second tour actif par élection ; s'il y a encore égalité, un troisième tour se crée depuis le second.

---

## 9. Résultats et procès-verbal

Affichage public (pour les éligibles de l'élection) :

```text
Président — Bureau du groupe 1, L3 Droit public
Inscrits : 30 · Votants : 22 · Participation : 73,3 %
──────────────────────────────────────────────
Ahmed       12 voix   ✔ Élu
Mokhtar      8 voix
Blancs       2
```

Procès-verbal PDF, **un par langue** (arabe et français, créés ensemble à la publication : mêmes chiffres, même identifiant de rapport et même code de vérification, un SHA-256 chacun, D-42) : institution, élection, dates, inscrits (dont ajouts exceptionnels), votants, bulletins, participation, panne et prolongation, résultats par poste (D-32 respecté), élus, égalités (avec la proposition de second tour), empreinte de l'urne, identifiant et code du rapport, et une case Nom / Signature par membre du comité (vide, à remplir à la main) plus une case Observations. Le téléchargement donne la version de la langue du site. QR de vérification en Phase 3.

---

## 10. Incidents

### 10.1 Panne pendant le vote

Exemple : le serveur est indisponible de 10 h à 11 h.

- Les votes enregistrés avant la panne restent valides (transactions validées).
- Un vote interrompu en plein envoi : soit la transaction est validée (l'étudiant le verra en se reconnectant : « Vous avez voté »), soit rien n'est enregistré. Jamais d'état intermédiaire.
- Le comité peut **prolonger** le vote (🔐, motif obligatoire, audité), **une seule fois**, d'une durée au plus égale à la panne (qu'il déclare : début et fin) et **au plus 24 h**. Jamais raccourcir. Possible seulement en `VOTING_OPEN` et **avant l'heure de fin** : après la clôture, on ne rouvre pas (D-38, D-40).
- **Ne jamais restaurer une sauvegarde pendant un vote ouvert** : une restauration effacerait des participations et permettrait de revoter. Si la base est perdue, l'élection est annulée et refaite.

### 10.2 Échec du contrôle d'intégrité

Votants ≠ bulletins : cela ne devrait jamais arriver, puisque tout se fait en une transaction.

- Aucune publication.
- Le comité et l'admin sont alertés.
- Investigation technique (journaux, binlog).
- Si l'écart n'est pas expliqué : annulation et nouvelle élection.

### 10.3 Erreur sur la liste électorale

- **Un éligible oublié** : ajout exceptionnel (§5.2).
- **Un non-éligible inscrit par erreur** : on ne le retire pas. S'il n'a pas voté, le comité le note dans le procès-verbal. S'il a voté, son bulletin est indiscernable : le comité évalue si l'écart peut changer le résultat. Si oui, annulation.

### 10.4 Fraude signalée

Votes frauduleux (§7.5) ou pression sur des électeurs : le comité consigne. L'annulation est une décision humaine de l'admin d'institution, motivée et auditée.

### 10.5 Candidat qui se retire ou est disqualifié

- Retrait impossible après `CANDIDACY_CLOSED`.
- Disqualification après l'ouverture du vote : impossible dans la plateforme. Le comité publie, puis décide hors plateforme d'un nouveau scrutin si nécessaire.

### 10.6 « Je n'ai pas pu voter »

L'étudiant voit lui-même son statut : non inscrit sur la liste, pas encore voté, ou déjà voté. Le comité ne voit pas les noms (D-02). Le vérificateur peut contrôler son inscription.

---

## 11. Tests obligatoires du Sprint 5

À écrire **avant** le code du module `voting`, contre un vrai MySQL.

### Vote unique et concurrence

1. 50 requêtes simultanées du même étudiant → exactement 1 participation, 1 bulletin, 49 réponses 409.
2. 2 000 votes de 1 000 étudiants différents en parallèle (chacun 2 fois) → 1 000 participations, 1 000 bulletins.
3. Erreur forcée entre l'insertion de la participation et celle du bulletin → ni participation ni bulletin.

### Conditions de vote

4. Vote avant `votingStartsAt`, après `votingEndsAt`, en `CANDIDACY_CLOSED`, en `CANCELLED` → refusé, rien d'écrit.
5. Étudiant absent de `voter_roll` → 403, rien d'écrit.
6. Candidat `REJECTED`, candidat d'un autre poste, poste d'une autre élection, poste manquant, poste en double, trop de choix, blanc interdit → 422, rien d'écrit.

### Secret

7. Aucune réponse de l'API (toutes routes `/voting` et `/results`) ne contient à la fois un identifiant d'étudiant et un choix.
8. Aucune ligne de log produite pendant un vote ne contient le corps de la requête.
9. Le schéma `ballots` et `ballot_choices` ne contient aucune colonne de date ou d'identité (test sur le schéma réel de la base).
10. Avant la clôture, toute route de résultats renvoie un refus, pour tous les rôles.
11. `app_readonly` ne peut pas lire `ballots` ; `app_runtime` ne peut ni modifier ni supprimer un bulletin.

### Cycle de vie et décompte

12. Ouverture refusée si une candidature est en attente, si un poste n'a pas de candidat, si le comité a moins de 3 membres.
13. Gel de la liste : un étudiant vérifié après l'ouverture ne peut pas voter.
14. Décompte : invariant votants = bulletins après 1 000 votes simulés ; décompte relancé = résultat identique.
15. Égalité détectée sur le dernier siège ; second tour pré-rempli avec seulement les ex-aequo.
16. Effectif inférieur à 3 sur un poste → détail non publié.

---

## 12. Décisions (validées le 15/10/2026)

| Réf. | Question | Proposition |
|---|---|---|
| A-06 | Ressaisie du mot de passe au moment de voter ? | **Oui** : simple et efficace contre le vol de session (ordinateur laissé ouvert) |
| A-07 | Participation par tranches de 15 minutes pour les petites élections ? | **Oui**, sous 50 électeurs |
| A-08 | Seuil de publication du détail par poste | **3 votants minimum** |
| A-09 | Prolongation du vote après une panne | **Une seule fois**, au plus la durée de la panne, comité 🔐 |
| A-10 | Poste sans candidat validé à l'ouverture | **Bloque l'ouverture** |
| A-11 | Ordre des candidats sur le bulletin | **Aléatoire pour chaque électeur** |
| A-12 | Notification « un vote a été enregistré pour vous » | **Oui**, dans l'application |

Ces décisions sont enregistrées dans `00-DECISIONS.md` : A-06 = D-30, A-07 = D-31, A-08 = D-32, A-09 = D-33, A-10 = D-34, A-11 = D-35, A-12 = D-36. S'y ajoute D-37 (mobile d'abord).

---

## 13. Ce qui n'est PAS dans le MVP

- Protocole cryptographique (jetons à signature aveugle, urne séparée) : supprime la confiance envers l'administrateur de la base. Revue de sécurité dédiée après le MVP.
- Vote par procuration.
- Vote préférentiel ou à plusieurs tours automatiques.
- Modification d'un vote après envoi.
- Observateurs (D-09).
