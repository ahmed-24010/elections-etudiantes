# Sprint en cours — Sprint 5 (Vote)

Branche : `feat/sprint-5-voting` (PR #7, brouillon). **Ne rien fusionner.** Le Sprint 4 (ci-dessous) est fusionné ; son suivi est conservé pour l'historique.

## État du Sprint 5 (15/10/2026)

| Étape | État |
|---|---|
| Rebase sur `main` (PR #8 fusionnée) | fait |
| `test:db` sur une base **séparée** `elections_test` (garde dans `setup-env-db.ts`, script `docker/mysql/init/02-test-db.sh`, CI) | fait |
| Données `zlalr3-*` supprimées de la base de dev (`audit_logs` conservé : le hash de la chaîne inclut acteur et institution) | fait ; **20 institutions de tests plus anciennes** y restent (`V…`, `O…`), non touchées |
| Backend : ouverture (gel de `voter_roll`), transaction de vote 04 §6.2, mot de passe avant la transaction (D-30), clôture + décompte, tâche planifiée, participation par tranches de 15 min (D-31), notification (D-36) | fait |
| Tests `test:db` : les 16 tests de 04 §11 (29 cas) + 21 tests ajoutés (mot de passe et blocage, tâche planifiée, bulletin, statut, notification, participation) | **73 / 73 verts** (toute la suite `test:db`) |
| Frontend : bulletin mobile d'abord (D-37), Playwright iPhone + Android sur tout le parcours, ar + fr | fait ; captures dans `docs/captures/sprint-5/` |

## Décisions prises en cours de route (absentes de `docs/`, à valider)

- **Décompte, égalité et publication faits au Sprint 5** (les tests 14 à 16 de 04 §11 l'exigent) : `results` calcule le décompte à la clôture, détecte l'égalité du dernier siège, masque le détail sous 3 votants, pré-remplit le second tour (`GET /results/:id/second-round`) et publie (`POST /elections/:id/results/publish`). **Reste au Sprint 6** : procès-verbal PDF, création effective du second tour, tableau de bord.
- Qui lit les résultats : le personnel (`results:read`) dès `VOTING_CLOSED` ; tous les autres, électeurs de la liste compris, seulement après `RESULTS_PUBLISHED`. Le seuil de 3 votants s'applique à tout le monde, personnel compris.
- Égalité : les candidats strictement devant restent élus (poste à plusieurs sièges) ; seul le dernier siège est disputé. Un candidat sans voix n'est jamais élu.
- Ouverture manuelle du vote : la condition « heure de la base ≥ `votingStartsAt` » s'applique aussi à l'ouverture manuelle (04 §4.3 ne distingue pas).
- Annulation (04 §4.6) étendue à `VOTING_OPEN` et `VOTING_CLOSED` : l'urne et la participation restent en base.
- Après le gel (04 §5.1), la liste électorale fait foi : « Mes élections » et le détail d'une élection restent visibles pour un inscrit dont l'inscription a changé. `GET /elections/mine` renvoie `myVote` (`NOT_ON_ROLL` / `NOT_VOTED` / `VOTED` / `null` avant le gel), jamais le contenu du vote.
- Échecs de mot de passe au vote : même compteur que la connexion (`LoginAttemptLimiter`, en mémoire, par processus) ; le 429 s'applique même avec le bon mot de passe. Ils ne sont **pas** écrits dans `audit_logs` (pas d'identité à côté d'une mention du vote, 04 §7.2).
- Notification de vote : créée **après** le COMMIT, sans jamais faire échouer un vote enregistré ; `body` = titre de l'élection, aucun choix.
- Tâche planifiée : chaque minute, à l'heure de la **base** ; clôture des candidatures, ouverture, clôture, et rattrapage d'un décompte manquant. Inactive si `NODE_ENV=test` ou `SCHEDULER_ENABLED=false`. Si l'ouverture automatique est bloquée, le comité reçoit une notification `VOTING_OPEN_BLOCKED` (une seule par motif) ; **aucun écran** n'affiche encore les notifications des membres du comité.
- Bulletin (`GET /voting/:id/ballot`) : ordre aléatoire tiré à chaque appel (D-35) ; photo et programme se lisent par l'URL signée existante, à la demande (une URL émise avec le bulletin expirerait en 5 min).
- Interface : un 401 `INVALID_PASSWORD` n'est pas rejoué par l'intercepteur (sinon deux échecs comptés) ; après un envoi, les choix et le mot de passe sont effacés de la page ; après une panne réseau, l'interface interroge `GET /voting/:id/status` avant de proposer de réessayer.
- Tests existants modifiés **avec accord du propriétaire** : `voting-world.ts` (hash argon2 bon marché : 2 000 votes avec les paramètres de production dépassent 60 s de CPU) et `voting-secret.db-spec.ts` (replacer `BigInt` dans un `JSON.stringify`).
- `app.module.ts` lit `LOG_LEVEL` dans l'environnement au démarrage du logger : `ConfigService` fige les valeurs à l'import, trop tôt pour le test 8.

## Non fait (volontairement)

- Prolongation du vote après une panne (D-33), ajout exceptionnel à la liste (`voter_roll:add`, 04 §5.2), écrans de résultats et du comité (participation, ouverture/clôture manuelles) : hors de la demande de ce sprint. Les routes serveur de participation, d'ouverture et de clôture existent.
- Procès-verbal PDF, second tour effectif, tableau de bord : Sprint 6.

---

# Sprint 4 (fusionné) — Élections, éligibilité, candidatures, SANS le vote

Branche : `feat/sprint-4-elections`. **Ne rien fusionner.** Mis à jour à chaque étape : une nouvelle session reprend ici.
`docs/04-ELECTION-VOTING-FLOW.md` n'est **pas** à rédiger : il sera fourni. (Ajouté au dépôt le 15/10 : `docs/04-ELECTION-VOTING-FLOW.md`, statut « proposition », référence pour les règles. Contrôle du Sprint 4 contre ce document : voir la section « Conformité à 04 » ci-dessous.)

## Décisions déjà prises (hors `docs/00-DECISIONS.md`)

- Une élection est visible par l'étudiant à partir de `CANDIDACY_OPEN`.
- Zéro règle d'éligibilité = **personne** n'est éligible ; « toute l'institution » est un choix explicite (règle vide créée volontairement).
- **3 membres du comité** exigés dès `CANDIDACY_OPEN`.
- Règles génériques ; institution pilote = FSJP.
- États du sprint : `DRAFT → CANDIDACY_OPEN → CANDIDACY_CLOSED`, plus `CANCELLED` (IA 🔐). **Jamais** `VOTING_OPEN`.
- Comité = `RoleAssignment ELECTION_COMMITTEE` (institution + élection).

## Plan et avancement

| # | Étape | État |
|---|---|---|
| 0 | Créer ce fichier | fait |
| 1 | Références de D-24 / D-25 : « 02 §13 » → « 02 §4.2 » | fait |
| 2 | D-24 / D-25 : schéma (`program_levels`) + migration `20261014000000_program_levels` | fait |
| 2 | Écran admin des niveaux autorisés par filière (cases à cocher dans la fiche filière) | fait |
| 2 | Grille des groupes sans case pour une filière absente du niveau (+ formulaire d'inscription filtré par niveau) | fait |
| 2 | Contrôle serveur (inscription `program_not_available_for_level`, création de groupe `level_not_allowed_for_program`) | fait |
| 2 | Seed : tronc commun « Droit » L1-L2, groupes A/B (D-25 corrigé) | fait |
| 2 | Seed : élection de démo « Bureau du groupe A — L3 Droit public » | fait avec 3b (brouillon, règle sur le groupe A de Droit public L3, 3 postes) |
| 2 | Textes ar/fr, tests verts (backend unit + e2e, frontend lint/tests/build), commit séparé | fait (`test:db` non lancé : pas de Docker/MySQL sur ce poste) |
| 3a | `eligibility` : requête 02 §5 + 5 exemples + cas limites | fait (`src/eligibility/eligibility.spec.ts`, 16 tests) |
| 3b | `elections` : brouillon, postes, règles, calendrier, états, comité, `GET /elections/mine`, `GET /elections/:id/eligible-count` | fait (`test/elections.e2e-spec.ts`) |
| 3c | `candidates` : dépôt (photo, programme S3), retrait, validation/rejet 🔐, unicité, comité ≠ candidat | fait (même fichier de test) |
| 3d | Point d'étape backend : lint, tests, build, résumé | fait ; `test:db` (`test/db/elections-flow.db-spec.ts`) exécuté par la CI de la PR #6 : vert (migration `program_levels`, droits, unicité sous concurrence) |
| 3e | Frontend : section « Élections » du menu latéral | fait (liste, création en 5 étapes, détail, validation du comité, « mes élections », candidature) ; captures ar/fr dans `docs/captures/sprint-4/` |
| 4 | PR brouillon #6 ouverte (`feat/sprint-4-elections` → `main`), CI verte | fait ; **ne rien fusionner** |

## Décisions prises en cours de route (à reporter dans `docs/` si elles tiennent)

- **D-24, masters** : M1/M2 avec Droit privé / Droit public — confirmé « OK pour l'instant » (D-28).
- **D-24, migration** : les filières existantes reçoivent TOUS les niveaux de leur institution (pas de changement de comportement tant que l'admin ne restreint pas). Le seed n'enlève jamais un lien existant : une base de dev déjà semée avant le 15/10 garde Droit privé / public en L1-L2 et d'éventuels groupes 1/2/3, à nettoyer à la main (ou `docker compose down -v`).
- **D-24, API** : `levelIds` (tableau d'UUID, peut être vide côté serveur ; l'écran exige au moins un niveau) à la création/modification d'une filière ; la vue `GET /institutions/:id/academic` renvoie `levelIds` par filière. On ne retire pas un niveau qui a déjà des groupes ou des inscriptions (409 `in_use`).

- **Sprint 4, ouverture des candidatures (DRAFT → CANDIDACY_OPEN)** exige : dates de candidature, ≥ 1 poste, ≥ 1 règle (une règle vide « toute l'institution » compte, elle se choisit avec `wholeInstitution: true`), ≥ 3 membres de comité actifs. Codes 409 : `candidacy_dates_required`, `positions_required`, `rules_required`, `committee_incomplete`.
- **Éditions** : brouillon = tout modifiable ; CANDIDACY_OPEN / CLOSED = dates seulement ; règles et postes = brouillon seulement (changer les règles invaliderait des candidatures déjà déposées).
- **Fermeture des candidatures** : le comité peut encore valider/rejeter ; plus de dépôt, de correction, de retrait ni de redépôt. Pas de réouverture.
- **Candidature** : fenêtre `candidacyStartsAt`–`candidacyEndsAt` contrôlée à l'heure du serveur (`candidacy_window_closed`) en plus du statut. Correction (texte, poste, photo, programme) seulement tant que PENDING. Retrait possible PENDING/APPROVED tant que l'élection est en CANDIDACY_OPEN/CLOSED ; une candidature RETIRÉE peut être redéposée tant que CANDIDACY_OPEN (même ligne, repart de zéro, anciens fichiers supprimés). **D-27 (15/10)** : retrait seulement en CANDIDACY_OPEN (`candidacy_locked` après fermeture) ; une candidature REJETÉE se corrige (PATCH, photo, programme) puis se redépose par `POST …/candidates/me/resubmit` (→ PENDING) ; `POST …/candidates` sur une rejetée reste `candidacy_rejected`.
- **Éligibilité** : contrôlée au dépôt ET à l'approbation (`candidate_not_eligible`). Un étudiant non éligible (ou sans inscription VERIFIED) reçoit 404 sur l'élection et ses candidats.
- **Conflits d'intérêts** (03 §6) : membre du comité ≠ candidat dans les deux sens (dépôt → 409 `committee_member_cannot_apply` ; nomination au comité d'un candidat PENDING/APPROVED → 409 `candidate_cannot_be_committee`, dans `RolesService.assign`) ; un comité ne décide jamais de sa propre candidature (403).
- **Photo / programme** : photo = JPEG/PNG ; programme = PDF/JPEG/PNG ; 5 Mo ; type réel (D-23) ; clé S3 `candidates/{institution}/{élection}/{uuid}.{ext}` ; servis par l'URL signée existante `/files/:fileId` (`POST /elections/:id/candidates/:cid/files/:photo|program/access`), lisibles par le candidat, le personnel de l'élection, et les étudiants éligibles pour un candidat validé (`candidate-access.ts`).
- **Notifications** : nouveaux types `CANDIDACY_APPROVED` / `CANDIDACY_REJECTED` (le motif de rejet est dans `body`). Les clés de traduction côté frontend restent à ajouter (3e).
- **Non fait volontairement** : `candidate:add` (saisie directe par le comité) ; liste nominative des électeurs (D-02) ; tout état VOTING_* ; gel de `voter_roll`. Aucune modification du module `voting` ni des tables `ballots` / `ballot_choices` / `voting_participations`.

## Conformité à 04 (contrôle du 15/10)

Conforme : états jusqu'à `CANDIDACY_CLOSED` et `CANCELLED` (§2) ; conditions d'ouverture des candidatures (§4.1) — postes, règle explicite, 3 membres actifs, calendrier cohérent, **éligibles > 0** ; refus 409 `conditions_not_met` avec **la liste de toutes les conditions manquantes** ; annulation IA 🔐 avec **motif obligatoire** (§4.6, motif dans `audit_logs`) ; chaque transition atomique et auditée ; retrait impossible après `CANDIDACY_CLOSED` (§10.5) ; un étudiant = un seul poste (D-05) ; comité ≠ candidat ; aucune liste nominative (D-02).
Écarts connus, reportés :
- §4.2 : la fermeture **automatique** des candidatures à `candidacyEndsAt` n'existe pas (pas de tâche planifiée ; `@nestjs/schedule` arrive au Sprint 5 avec l'ouverture/clôture automatiques du vote). Fermeture manuelle seulement.
- §4.6 : l'annulation « depuis tout état sauf `RESULTS_PUBLISHED` » ne couvre que DRAFT, CANDIDACY_OPEN, CANDIDACY_CLOSED (les autres états n'existent pas encore).
- §4.1 : la condition « verrou sur la ligne » est réalisée par une mise à jour conditionnelle à l'état lu (équivalent), pas par `SELECT … FOR UPDATE`.
Incohérences du document 04 à trancher : (1) l'exemple §3 dit « groupe 1 » alors que D-25 corrigé = groupes A/B ; (2) §12 dit que les décisions iront en « D-24 et suivantes » : D-24 à D-29 sont pris, la suite est **D-30** ; (3) A-06 à A-12 sont à valider avant le Sprint 5.

## Reste à faire / notes de reprise

- **Frontend Élections (fait)** : `frontend/src/app/features/elections/` (6 pages), clients `core/api/elections.api.ts` et `candidates.api.ts`, route `/admin/elections…` (IA et comité) et `/student/elections…`, menu « Élections », lien « Mes élections » sur l'accueil étudiant (si inscription vérifiée), section « Points à contrôler » dans l'examen d'une inscription (aide « المجموعة الأولى = A ، المجموعة الثانية = B »). Dates saisies en texte « AAAA-MM-JJ HH:mm » (comme les années, pas de champ natif).
- **À faire / à décider** : (1) `docs/04-ELECTION-VOTING-FLOW.md` absent du dépôt le 15/10 : relire §10.5 quand il sera là ; (2) pas de fenêtre « modifier le titre » après ouverture (volontaire) ; (3) pas de liste des membres du comité hors de l'écran de création (le détail ne donne que le compte) ; (4) prochaine étape métier : Sprint 5 (vote), à ne pas commencer sans 04.
- `docs/04-ELECTION-VOTING-FLOW.md` : sera fourni, ne pas le rédiger.
