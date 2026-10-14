# Sprint en cours — Sprint 4 (Élections, éligibilité, candidatures), SANS le vote

Branche : `feat/sprint-4-elections`. **Ne rien fusionner.** Mis à jour à chaque étape : une nouvelle session reprend ici.
`docs/04-ELECTION-VOTING-FLOW.md` n'est **pas** à rédiger : il sera fourni.

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
| 2 | Seed : tronc commun « Droit » L1-L2, groupes 1/2/3 | fait |
| 2 | Seed : élection de démo « Bureau du groupe 1 — L3 Droit public » | **reportée à 3b** (dépend du module `elections`) |
| 2 | Textes ar/fr, tests verts (backend unit + e2e, frontend lint/tests/build), commit séparé | fait (`test:db` non lancé : pas de Docker/MySQL sur ce poste) |
| 3a | `eligibility` : requête 02 §5 + 5 exemples + cas limites | à faire |
| 3b | `elections` : brouillon, postes, règles, calendrier, états, comité, `GET /elections/mine`, `GET /elections/:id/eligible-count` | à faire |
| 3c | `candidates` : dépôt (photo, programme S3), retrait, validation/rejet 🔐, unicité, comité ≠ candidat | à faire |
| 3d | Point d'étape backend : lint, tests, build, résumé | à faire |
| 3e | Frontend : section « Élections » du menu latéral | à faire |

## Décisions prises en cours de route (à reporter dans `docs/` si elles tiennent)

- **D-24, masters** : le seed met M1/M2 avec Droit privé / Droit public (la scolarité n'a parlé que de L1-L2 / L3). À confirmer.
- **D-24, migration** : les filières existantes reçoivent TOUS les niveaux de leur institution (pas de changement de comportement tant que l'admin ne restreint pas). Le seed n'enlève jamais un lien existant : une base de dev déjà semée garde Droit privé / public en L1-L2 et ses groupes A/B, à nettoyer à la main (ou `docker compose down -v`).
- **D-24, API** : `levelIds` (tableau d'UUID, peut être vide côté serveur ; l'écran exige au moins un niveau) à la création/modification d'une filière ; la vue `GET /institutions/:id/academic` renvoie `levelIds` par filière. On ne retire pas un niveau qui a déjà des groupes ou des inscriptions (409 `in_use`).

## Reste à faire / notes de reprise

_(voir le tableau)_
