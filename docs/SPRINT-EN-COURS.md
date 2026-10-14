# Sprint en cours — Sprint 4 (Élections, éligibilité, candidatures), SANS le vote

Branche : `feat/sprint-4-elections`. **Ne rien fusionner.** Mis à jour à chaque étape : une nouvelle session reprend ici.
`docs/04-ELECTION-VOTING-FLOW.md` n'est **pas** à rédiger : il sera fourni. (Le 15/10 il était annoncé ajouté mais ABSENT du dépôt et du disque : §10.5 n'a pas pu être lu, les règles 4 et 5 viennent de la consigne directe.)

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
| 3d | Point d'étape backend : lint, tests, build, résumé | fait — **en attente de feu vert avant le frontend** ; `test:db` (nouveau `test/db/elections-flow.db-spec.ts`) écrit mais JAMAIS exécuté (pas de Docker) |
| 3e | Frontend : section « Élections » du menu latéral | à faire |

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

## Reste à faire / notes de reprise

- **3e Frontend « Élections »** : section dans le menu latéral admin (même style que la structure académique) ; pages : liste, création (formulaire en étapes : infos/dates → postes → règles → comité), détail avec états (ouvrir/fermer/annuler 🔐), écran de validation des candidatures du comité ; côté étudiant : « Mes élections », détail, dépôt/retrait de candidature, photo/programme. Clés `ar.json` ET `fr.json` (dont `notifications.types.CANDIDACY_*`), CSS en propriétés logiques, Reactive Forms.
- Lancer `npm run test:db` sur une machine avec Docker (jamais exécuté pour D-24 ni Sprint 4).
- Mettre à jour `docs/03-ROLES-PERMISSIONS.md` / `docs/07-MVP-ROADMAP.md` (cases du Sprint 4) une fois le frontend fini.
- `docs/04-ELECTION-VOTING-FLOW.md` : sera fourni, ne pas le rédiger.
